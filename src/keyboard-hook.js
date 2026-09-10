/**
 * @file KeyboardHook – fallback input source using a global keyboard hook (uiohook-napi).
 *
 * Sees every keyboard on the system and therefore cannot tell devices apart, but needs no
 * device access at all. Requirements: macOS "Bedienungshilfen" (Accessibility) permission for
 * Companion, Linux X11 session, Windows user session (no service).
 * Emits the same 'key' / 'status' events as HidWatcher.
 */
const { EventEmitter } = require('node:events')
const { installNodeGypBuildGuard } = require('./native-loader.js')

/** uiohook key names → canonical names used by the HID sources (see keycodes.js). */
const NAME_MAP = {
	ArrowLeft: 'Left',
	ArrowRight: 'Right',
	ArrowUp: 'Up',
	ArrowDown: 'Down',
	Period: '.',
	Comma: ',',
	Minus: '-',
	Equal: '=',
	Slash: '/',
	Backslash: '\\',
	Semicolon: ';',
	Quote: "'",
	Backquote: '`',
	BracketLeft: '[',
	BracketRight: ']',
	Ctrl: 'LeftCtrl',
	CtrlRight: 'RightCtrl',
	Alt: 'LeftAlt',
	AltRight: 'RightAlt',
	Shift: 'LeftShift',
	ShiftRight: 'RightShift',
	Meta: 'LeftGui',
	MetaRight: 'RightGui',
	NumpadMultiply: 'Numpad*',
	NumpadAdd: 'Numpad+',
	NumpadSubtract: 'Numpad-',
	NumpadDivide: 'Numpad/',
	NumpadDecimal: 'Numpad.',
	NumpadEnter: 'NumpadEnter',
}

class KeyboardHook extends EventEmitter {
	constructor(opts) {
		super()
		this.log = opts?.log || (() => {})
		this.lib = null
		this.codeToName = new Map()
		this.pressed = new Set()
		this.onDown = null
		this.onUp = null
	}

	static isAvailable() {
		try {
			require.resolve('uiohook-napi')
			return true
		} catch {
			return false
		}
	}

	start() {
		let lib
		try {
			installNodeGypBuildGuard()

			lib = require('uiohook-napi')
		} catch (e) {
			throw new Error(
				`uiohook-napi could not be loaded (${process.platform}-${process.arch}, node ${process.version}): ${e.message || e}`,
				{ cause: e },
			)
		}
		if (!lib?.uIOhook || typeof lib.uIOhook.start !== 'function')
			throw new Error('uiohook-napi loaded, but uIOhook.start is missing')
		this.lib = lib
		for (const [name, code] of Object.entries(lib.UiohookKey || {})) {
			if (typeof code !== 'number') continue
			if (!this.codeToName.has(code)) this.codeToName.set(code, NAME_MAP[name] || name)
		}
		this.onDown = (e) => {
			const name = this.codeToName.get(e.keycode) || `Key${e.keycode}`
			if (!this.gotEvent) {
				this.gotEvent = true
				this.emit('status', { connected: true, message: 'Global keyboard hook active (all keyboards)' })
			}
			if (this.pressed.has(name)) return // key repeat
			this.pressed.add(name)
			this.emit('key', { type: 'press', key: name, iface: 'hook', kind: 'hook', raw: String(e.keycode) })
		}
		this.onUp = (e) => {
			const name = this.codeToName.get(e.keycode) || `Key${e.keycode}`
			this.pressed.delete(name)
			this.emit('key', { type: 'release', key: name, iface: 'hook', kind: 'hook', raw: String(e.keycode) })
		}
		lib.uIOhook.on('keydown', this.onDown)
		lib.uIOhook.on('keyup', this.onUp)
		try {
			lib.uIOhook.start()
		} catch (e) {
			throw new Error(`uIOhook.start() failed: ${e.message || e}`, { cause: e })
		}
		this.log('info', `Keyboard hook started (${this.codeToName.size} key codes known)`)
		this.emit('status', {
			connected: true,
			message: 'Global keyboard hook active (all keyboards) – no key received yet',
		})
		this.gotEvent = false
	}

	async stop() {
		if (!this.lib) return
		try {
			if (this.onDown) this.lib.uIOhook.off('keydown', this.onDown)
			if (this.onUp) this.lib.uIOhook.off('keyup', this.onUp)
			this.lib.uIOhook.stop()
		} catch (e) {
			this.log('debug', `Hook stop: ${e.message || e}`)
		}
		for (const k of this.pressed) this.emit('key', { type: 'release', key: k, iface: 'hook', kind: 'close', raw: '' })
		this.pressed.clear()
		this.lib = null
	}
}

module.exports = { KeyboardHook }
