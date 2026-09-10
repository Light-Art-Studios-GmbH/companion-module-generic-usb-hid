/**
 * Windows-only input source using the Raw Input API via a PowerShell helper
 * (scripts/win-rawinput.ps1). Windows refuses to hand HID keyboard / mouse
 * collections to applications, but Raw Input delivers their key events
 * together with the originating device path — so a presenter can still be
 * watched device-specifically without exclusive access.
 *
 * Emits the same 'key' / 'report' / 'status' events as HidWatcher.
 */
const { EventEmitter } = require('node:events')
const { spawn } = require('node:child_process')
const path = require('node:path')
const readline = require('node:readline')
const { vkToName, mouseFlagsToEvents, parseWinDeviceName } = require('./vkeys.js')
const { MOUSE_BUTTON_NAMES } = require('./keycodes.js')
const { parseReport } = require('./report-parser.js')

/**
 * Location of the PowerShell helper. In the source tree it lives in ../scripts/, in a package
 * built with companion-module-build (esbuild bundle) it is copied next to main.js.
 */
const SCRIPT =
	[path.join(__dirname, '..', 'scripts', 'win-rawinput.ps1'), path.join(__dirname, 'win-rawinput.ps1')].find((p) => {
		try {
			return require('node:fs').existsSync(p)
		} catch {
			return false
		}
	}) || path.join(__dirname, '..', 'scripts', 'win-rawinput.ps1')

/** HID usages (usagePage, usage) that Windows refuses to open and Raw Input handles instead. */
const COVERED_USAGES = [
	[1, 6], // keyboard
	[1, 2], // mouse
]

class WinRawInput extends EventEmitter {
	/**
	 * @param {object} opts
	 * @param {{vendorId:number, productId:number}|null} opts.selection  null = all devices
	 * @param {string} [opts.usages] e.g. "1:6,1:2" (keyboard + mouse)
	 * @param {(level:string, msg:string)=>void} opts.log
	 */
	constructor(opts) {
		super()
		this.opts = opts
		this.log = opts.log || (() => {})
		this.child = null
		this.stopped = false
		this.ready = false
		this.pressed = new Map() // device -> Set(key)
		this.hidState = new Map() // device -> Set(key) for hid reports
		this.restartTimer = null
		this.restarts = 0
		this.devices = []
	}

	/** Raw Input exists on Windows only. */
	static isSupported() {
		return process.platform === 'win32'
	}

	/** @see COVERED_USAGES */
	static get COVERED_USAGES() {
		return COVERED_USAGES
	}

	/** Full path of Windows PowerShell 5.1 (always present on supported Windows versions). */

	static powershellPath() {
		const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
		return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
	}

	start() {
		this.stopped = false
		this.spawnHelper()
	}

	spawnHelper() {
		if (this.stopped) return
		const args = [
			'-NoProfile',
			'-NonInteractive',
			'-NoLogo',
			'-ExecutionPolicy',
			'Bypass',
			'-STA',
			'-File',
			SCRIPT,
			'-ParentPid',
			String(process.pid),
			'-Usages',
			this.opts.usages || '1:6,1:2',
		]
		let child
		try {
			child = spawn(WinRawInput.powershellPath(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
		} catch (e) {
			this.emit('status', {
				connected: false,
				message: `Raw Input helper could not be started: ${e.message || e}`,
				error: String(e.message || e),
			})
			this.scheduleRestart()
			return
		}
		this.child = child
		this.ready = false
		this.log('info', `Raw Input helper started (PID ${child.pid})`)

		const rl = readline.createInterface({ input: child.stdout })
		rl.on('line', (line) => this.onLine(line))
		let stderr = ''
		child.stderr.on('data', (d) => {
			stderr += d.toString()
			if (stderr.length > 4000) stderr = stderr.slice(-4000)
		})
		child.on('error', (e) => {
			this.log('error', `Raw Input helper error: ${e.message || e}`)
			this.emit('status', {
				connected: false,
				message: `Raw Input helper error: ${e.message || e}`,
				error: String(e.message || e),
			})
		})
		child.on('exit', (code, signal) => {
			if (this.child !== child) return
			this.child = null
			this.releaseAll()
			if (this.stopped) return
			const detail = stderr.trim().split(/\r?\n/).slice(-3).join(' | ')
			const msg = `Raw Input helper exited (code ${code ?? signal})${detail ? ': ' + detail : ''}`
			this.log('warn', msg)
			this.emit('status', { connected: false, message: msg, error: msg })
			this.scheduleRestart()
		})
	}

	scheduleRestart() {
		if (this.stopped) return
		const delay = Math.min(30000, 2000 * 2 ** Math.min(this.restarts++, 4))
		if (this.restartTimer) clearTimeout(this.restartTimer)
		this.restartTimer = setTimeout(() => this.spawnHelper(), delay)
	}

	async stop() {
		this.stopped = true
		if (this.restartTimer) clearTimeout(this.restartTimer)
		this.restartTimer = null
		const child = this.child
		this.child = null
		if (child) {
			try {
				child.kill()
			} catch {
				// ignore
			}
		}
		this.releaseAll()
	}

	releaseAll() {
		for (const [dev, set] of this.pressed) {
			for (const k of set) this.emit('key', { type: 'release', key: k, iface: 'rawinput', kind: 'close', raw: dev })
		}
		this.pressed.clear()
		this.hidState.clear()
	}

	matches(dev, info) {
		const sel = this.opts.selection
		if (!sel) return true
		const ids = info && info.vid !== undefined ? { vendorId: info.vid, productId: info.pid } : parseWinDeviceName(dev)
		if (!ids) return sel.vendorId === 0 && sel.productId === 0 // internal devices without VID/PID
		return ids.vendorId === sel.vendorId && ids.productId === sel.productId
	}

	/**
	 * Handles one JSON line from the helper. Public for unit tests.
	 * @param {string} line
	 */
	onLine(line) {
		if (this.stopped) return
		let msg
		try {
			msg = JSON.parse(line)
		} catch {
			this.log('debug', `Raw-Input: ${line}`)
			return
		}
		switch (msg.t) {
			case 'ready':
				this.ready = true
				this.restarts = 0
				this.emit('status', { connected: true, message: `Windows Raw Input active (${msg.usages})` })
				return
			case 'devices':
				this.devices = msg.list || []
				this.log('info', `Raw Input devices: ${this.devices.map((d) => d.name).join(' ; ')}`)
				return
			case 'fatal':
			case 'error':
				this.log(msg.t === 'fatal' ? 'error' : 'warn', `Raw-Input: ${msg.msg}`)
				if (msg.t === 'fatal')
					this.emit('status', { connected: false, message: `Raw Input: ${msg.msg}`, error: msg.msg })
				return
			case 'key': {
				if (!this.matches(msg.dev)) return
				const name = vkToName(msg.vk, msg.sc, msg.e0)
				this.keyEvent(
					msg.dev,
					name,
					msg.down,
					`vk=0x${Number(msg.vk).toString(16)} sc=0x${Number(msg.sc).toString(16)}${msg.e0 ? ' e0' : ''}`,
				)
				return
			}
			case 'mouse': {
				if (!this.matches(msg.dev)) return
				for (const ev of mouseFlagsToEvents(msg.flags))
					this.keyEvent(msg.dev, MOUSE_BUTTON_NAMES[ev.button - 1], ev.down, `flags=${msg.flags}`)
				return
			}
			case 'hid': {
				if (!this.matches(msg.dev, msg)) return
				const buf = Buffer.from(msg.data || '', 'hex')
				const per = Number(msg.size) || buf.length
				for (let off = 0; off + per <= buf.length && per > 0; off += per) {
					const report = buf.subarray(off, off + per)
					const { keys, kind } = parseReport(report, { usagePage: msg.up, usage: msg.u })
					const hex = report.toString('hex')
					this.emit('report', { hex, iface: 'rawinput', kind, keys: [...keys] })
					const prev = this.hidState.get(msg.dev) || new Set()
					for (const k of keys) if (!prev.has(k)) this.keyEvent(msg.dev, k, true, hex)
					for (const k of prev) if (!keys.has(k)) this.keyEvent(msg.dev, k, false, hex)
					this.hidState.set(msg.dev, keys)
				}
				return
			}
			default:
				return
		}
	}

	keyEvent(dev, name, down, raw) {
		let set = this.pressed.get(dev)
		if (!set) this.pressed.set(dev, (set = new Set()))
		if (down) {
			if (set.has(name)) return // auto-repeat
			set.add(name)
			this.emit('key', { type: 'press', key: name, iface: 'rawinput', kind: 'rawinput', raw })
		} else {
			if (!set.has(name)) return
			set.delete(name)
			this.emit('key', { type: 'release', key: name, iface: 'rawinput', kind: 'rawinput', raw })
		}
	}
}

module.exports = { WinRawInput, SCRIPT, COVERED_USAGES }
