/**
 * @file HidWatcher – keeps the selected USB HID device open and turns its input reports
 * into key press/release events.
 *
 * How it works
 * ────────────
 * • A periodic *tick* (every `pollInterval` seconds) enumerates HID interfaces that belong to
 *   the selected device (vendor/product id, optional serial or product name).
 * • Every matching interface that is not open yet is opened with `HIDAsync` (node-hid runs the
 *   blocking reads in its own thread, the module event loop stays free).
 * • Reports are parsed by `report-parser.js`; the difference between the previous and the
 *   current set of pressed keys yields 'press' / 'release' events.
 * • Unplugging fires an 'error' on the handle → the handle is closed and the tick reconnects
 *   automatically once the device is back.
 * • `skipUsages` lets another source (Windows Raw Input) take over selected collections; the
 *   device still counts as present/connected in that case.
 *
 * Events
 * ──────
 *   'key'     { type:'press'|'release', key, iface, kind, raw }
 *   'report'  { hex, iface, kind, keys:string[] }
 *   'status'  { connected:boolean, message, error?, interfaces?, device? }   (de-duplicated)
 */
const { EventEmitter } = require('node:events')
const HID = require('node-hid')
const { parseReport } = require('./report-parser.js')
const { matchInterfaces, interfaceLabel, deviceName, hex4 } = require('./hid-devices.js')

/** Lower bound for the rescan interval; protects the USB stack from being hammered. */
const MIN_POLL_SECONDS = 0.5
/** Delay before reconnecting after a handle reported an error (device unplugged). */
const RECONNECT_DELAY_MS = 500

class HidWatcher extends EventEmitter {
	/**
	 * @param {object} opts
	 * @param {{vendorId:number, productId:number, serialNumber:string, product?:string}} opts.selection
	 * @param {boolean} opts.allInterfaces  open every collection of the device (false = keyboard only)
	 * @param {boolean} opts.exclusive      macOS: seize the device so keys do not reach other apps
	 * @param {boolean} opts.rawKeys        treat reports of unknown interfaces as raw:<hex> pseudo keys
	 * @param {number}  opts.pollInterval   seconds between rescans (hot-plug detection)
	 * @param {Array<[number,number]>} [opts.skipUsages] usagePage/usage pairs served by another source
	 * @param {(level:string, msg:string)=>void} [opts.log]
	 */
	constructor(opts) {
		super()
		this.opts = opts
		this.log = opts.log || (() => {})
		/** @type {Map<string, {handle: import('node-hid').HIDAsync, info: import('node-hid').Device, pressed:Set<string>, label:string}>} path → open interface */
		this.handles = new Map()
		this.connected = false
		this.stopped = false
		this.timer = null
		/** true while a tick is running; prevents overlapping scans */
		this.scanning = false
		/** last "not connected" message, to emit status changes only once */
		this.lastError = ''
		/** last "connected" message, same purpose */
		this.lastStatusMessage = ''
		/** last enumeration error, logged once instead of every tick */
		this.lastScanError = ''
	}

	/** Starts scanning immediately; subsequent scans follow `pollInterval`. */
	start() {
		this.stopped = false
		void this.tick()
	}

	/** Stops scanning and closes every open interface. Safe to call multiple times. */
	async stop() {
		this.stopped = true
		if (this.timer) clearTimeout(this.timer)
		this.timer = null
		await this.closeAll()
	}

	/** Schedules the next tick unless stopped. */
	scheduleTick(delayMs) {
		if (this.stopped) return
		if (this.timer) clearTimeout(this.timer)
		const ms = delayMs ?? Math.max(MIN_POLL_SECONDS, Number(this.opts.pollInterval) || 2) * 1000
		this.timer = setTimeout(() => void this.tick(), ms)
	}

	/** One scan: enumerate, close vanished interfaces, open new ones, publish status. */
	async tick() {
		if (this.stopped || this.scanning) return
		this.scanning = true
		try {
			const sel = this.opts.selection
			// Filtering by vendor/product id lets hidapi skip opening unrelated devices to read their
			// string descriptors – a big difference on Windows with many HID devices.
			const raw =
				sel.vendorId || sel.productId ? await HID.devicesAsync(sel.vendorId, sel.productId) : await HID.devicesAsync()
			if (this.stopped) return
			const all = matchInterfaces(raw, sel, { allInterfaces: this.opts.allInterfaces })
			const skip = this.opts.skipUsages || []
			const isSkipped = (d) => skip.some(([p, u]) => d.usagePage === p && d.usage === u)
			const wanted = all.filter((d) => !isSkipped(d))
			const skipped = all.filter(isSkipped)

			// close handles whose path disappeared (device unplugged without an error event)
			for (const [path, entry] of this.handles) {
				if (!wanted.some((d) => d.path === path)) {
					this.log('info', `Interface removed: ${entry.label}`)
					await this.safeClose(path)
				}
			}

			// open everything that is not open yet
			const errors = []
			for (const d of wanted) {
				if (this.stopped) return
				if (this.handles.has(d.path)) continue
				try {
					await this.openInterface(d)
				} catch (e) {
					errors.push(`${interfaceLabel(d)}: ${e?.message || e}`)
				}
			}
			errors.sort() // stable status text regardless of open order

			const wasConnected = this.connected
			// The device counts as connected when at least one interface is open, or when all of its
			// interfaces are served by another source (Raw Input on Windows).
			this.connected = this.handles.size > 0 || skipped.length > 0
			if (this.connected) {
				this.lastError = errors.join('; ')
				this.emitConnected(errors, skipped)
			} else {
				const message =
					all.length === 0
						? `Device ${hex4(sel.vendorId)}:${hex4(sel.productId)} not found`
						: `Could not open any interface: ${errors.join('; ')}`
				const changed = wasConnected || message !== this.lastError
				this.lastError = message
				this.lastStatusMessage = ''
				if (changed) this.emit('status', { connected: false, message, error: errors.join('; ') || undefined })
			}
			this.lastScanError = ''
		} catch (e) {
			const msg = `Device scan failed: ${e?.message || e}`
			if (msg !== this.lastScanError) this.log('error', msg)
			this.lastScanError = msg
		} finally {
			this.scanning = false
			this.scheduleTick()
		}
	}

	/** Emits a "connected" status, but only when its text changed since the last emission. */
	emitConnected(errors = [], skipped = []) {
		const interfaces = [...this.handles.values()].map((h) => h.info)
		const first = interfaces.find((i) => i.product) || skipped.find((i) => i.product) || interfaces[0] || skipped[0]
		const device = first
			? {
					name: deviceName(first.manufacturer, first.product),
					vendorId: first.vendorId,
					productId: first.productId,
					serialNumber: first.serialNumber || '',
				}
			: undefined
		const labels = [...this.handles.values()].map((h) => h.label).join(', ')
		let message = `${device?.name ?? ''} – ${this.handles.size} interface(s): ${labels || '-'}`
		if (skipped.length) message += ` | via Raw Input: ${skipped.map(interfaceLabel).join(', ')}`
		if (errors.length) message += ` | not opened: ${errors.join('; ')}`
		if (message === this.lastStatusMessage) return
		this.lastStatusMessage = message
		this.emit('status', { connected: true, message, interfaces, device, error: errors.join('; ') || undefined })
	}

	/**
	 * Opens one interface and wires its data/error events.
	 * @param {import('node-hid').Device} d
	 */
	async openInterface(d) {
		// `nonExclusive` only matters on macOS (kIOHIDOptionsTypeSeizeDevice); other platforms ignore it.
		const handle = await HID.HIDAsync.open(d.path, { nonExclusive: !this.opts.exclusive })
		if (this.stopped) {
			// stop() ran while we were opening – do not leak the handle
			await handle.close().catch(() => {})
			return
		}
		const label = interfaceLabel(d)
		const entry = { handle, info: d, pressed: new Set(), label }
		this.handles.set(d.path, entry)
		handle.on('data', (buf) => {
			try {
				this.onData(entry, buf)
			} catch (e) {
				this.log('error', `Report handling ${label}: ${e?.message || e}`)
			}
		})
		handle.on('error', (err) => this.onHandleError(d.path, label, err))
		this.log('info', `Interface opened: ${label} (${d.path})`)
	}

	/** A handle reported an error – almost always "device unplugged". Close and reconnect soon. */
	onHandleError(path, label, err) {
		this.log('warn', `Interface ${label} error/disconnect: ${err?.message || err}`)
		void this.safeClose(path).then(() => {
			if (this.stopped) return
			const was = this.connected
			this.connected = this.handles.size > 0
			if (was && !this.connected) {
				this.lastError = 'Device disconnected'
				this.lastStatusMessage = ''
				this.emit('status', { connected: false, message: 'Device disconnected' })
			}
			this.scheduleTick(RECONNECT_DELAY_MS)
		})
	}

	/**
	 * Parses one input report and emits press/release events for the differences.
	 * @param {{info:any, pressed:Set<string>, label:string}} entry
	 * @param {Buffer|number[]} buf
	 */
	onData(entry, buf) {
		if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf)
		const parsed = parseReport(buf, entry.info)
		if (parsed.rollover) return // phantom state ("too many keys"), keep previous state
		const { kind } = parsed
		// reports of unknown collections only count as keys when the user opted in
		const keys = kind === 'generic' && !this.opts.rawKeys ? new Set() : parsed.keys
		const hex = buf.toString('hex')
		this.emit('report', { hex, iface: entry.label, kind, keys: [...keys] })
		for (const k of keys) {
			if (!entry.pressed.has(k)) {
				entry.pressed.add(k)
				this.emit('key', { type: 'press', key: k, iface: entry.label, kind, raw: hex })
			}
		}
		for (const k of [...entry.pressed]) {
			if (!keys.has(k)) {
				entry.pressed.delete(k)
				this.emit('key', { type: 'release', key: k, iface: entry.label, kind, raw: hex })
			}
		}
	}

	/** Closes one interface; releases keys it still holds so feedbacks never get stuck. */
	async safeClose(path) {
		const entry = this.handles.get(path)
		if (!entry) return
		this.handles.delete(path)
		for (const k of entry.pressed)
			this.emit('key', { type: 'release', key: k, iface: entry.label, kind: 'close', raw: '' })
		entry.pressed.clear()
		try {
			entry.handle.removeAllListeners('data')
			entry.handle.removeAllListeners('error')
			await entry.handle.close()
		} catch {
			// closing an already vanished device may throw – nothing to do
		}
	}

	/** Closes every interface. */
	async closeAll() {
		for (const path of [...this.handles.keys()]) await this.safeClose(path)
		this.connected = false
		this.lastStatusMessage = ''
	}
}

module.exports = { HidWatcher }
