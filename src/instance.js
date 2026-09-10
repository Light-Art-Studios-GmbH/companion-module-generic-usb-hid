/**
 * @file Companion connection instance (UsbHidInstance) for the "generic-usb-hid" module.
 *
 * Responsibilities
 * ─────────────────
 * • Owns the configuration and the runtime state (connected device, pressed keys, counters).
 * • Starts exactly one *input source* depending on the configuration:
 *     - `HidWatcher`   (mode "hid")  – opens the selected USB HID device via node-hid,
 *                                     on Windows complemented by `WinRawInput` for keyboard/mouse collections.
 *     - `KeyboardHook` (mode "hook") – global keyboard hook (uiohook-napi), not device specific.
 * • Converts the source events into Companion variables, feedbacks and the connection status.
 *
 * Robustness rules used throughout this file
 * ───────────────────────────────────────────
 * • Every callback coming from a source or from Companion is wrapped in `guard()` so that a
 *   single failing handler can never crash the module process (which would restart the
 *   connection and lose state).
 * • `stopSource()` is idempotent and always leaves the instance in a clean state, even if
 *   a source throws while shutting down.
 * • After `destroy()` no event is processed any more (`this.destroyed`).
 */
const { InstanceBase, InstanceStatus } = require('@companion-module/base')
const { getConfigFields, NONE } = require('./config.js')
const { getActionDefinitions } = require('./actions.js')
const { getFeedbackDefinitions } = require('./feedbacks.js')
const { getVariableDefinitions } = require('./variables.js')
const { getPresetDefinitions } = require('./presets.js')
const { groupDevices, parseDeviceKey, hex4 } = require('./hid-devices.js')
const { HidWatcher } = require('./hid-watcher.js')
const { KeyboardHook } = require('./keyboard-hook.js')
const { WinRawInput } = require('./win-rawinput.js')
const { runDiagnostics } = require('./diagnostics.js')
const { normalizeKeyName } = require('./keycodes.js')

/** Default window (ms) for the "recently pressed" feedback when neither option nor config is set. */
const DEFAULT_RECENT_WINDOW_MS = 500
/** Upper bound for the "recently pressed" window to keep timers sane (10 minutes). */
const MAX_RECENT_WINDOW_MS = 600000

class UsbHidInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		/** @type {Record<string, any>} current connection configuration */
		this.config = {}
		/** @type {import('./hid-devices.js').DeviceGroup[]} last enumeration result (for dropdowns) */
		this.deviceList = []
		/** @type {import('./hid-watcher.js').HidWatcher | import('./keyboard-hook.js').KeyboardHook | null} */
		this.source = null
		/** @type {import('./win-rawinput.js').WinRawInput | null} Windows-only companion source */
		this.rawInput = null
		/** Human readable state of the Windows Raw Input helper ('' when not used). */
		this.rawInputState = ''
		/** Last status object emitted by the HID watcher, replayed when the Raw Input state changes. */
		this.lastWatcherStatus = null
		/** @type {Map<string, NodeJS.Timeout>} feedbackId → timer that re-evaluates "recently pressed" */
		this.recentTimers = new Map()
		/** @type {Set<{resolve:(v:string|undefined)=>void}>} pending "learn" requests waiting for a key */
		this.keyWaiters = new Set()
		/** Set once destroy() ran; blocks late events from sources that are still shutting down. */
		this.destroyed = false
		/** Serialises refreshDeviceList() calls. @type {Promise<void>|null} */
		this.refreshPromise = null
		this.state = this.emptyState()
	}

	/** Fresh runtime state. Kept as a separate object so "reset" can rebuild it in one go. */
	emptyState() {
		return {
			connected: false,
			deviceName: '',
			deviceId: '',
			interfaces: 0,
			/** normalised (lower-case) names of keys currently held */
			pressed: new Set(),
			/** normalised name → display name, keeps the original spelling for variables */
			pressedDisplay: new Map(),
			lastKey: '',
			lastEvent: '',
			lastKeyTs: 0,
			lastInterface: '',
			lastReportHex: '',
			pressCount: 0,
			/** normalised name → timestamp (ms) of the last press, used by "recently pressed" */
			lastPressAt: new Map(),
		}
	}

	// ────────────────────────────────────────────────────────────── lifecycle

	/** Called once by Companion when the connection is created or enabled. */
	async init(config) {
		this.config = config || {}
		this.destroyed = false
		this.setVariableDefinitions(getVariableDefinitions())
		this.setVariableValues({ rawinput_state: '' })
		this.log('info', `Diagnostics: ${runDiagnostics()}`)
		this.setFeedbackDefinitions(getFeedbackDefinitions(this))
		await this.refreshDeviceList(false) // also publishes the action definitions (device dropdown)
		this.publishPresets()
		this.publishState()
		await this.startSource()
	}

	/** Called by Companion whenever the config or the connection label changed. */
	async configUpdated(config) {
		await this.stopSource()
		this.config = config || {}
		await this.refreshDeviceList(false)
		this.publishPresets() // presets embed the connection label in variable references
		await this.startSource()
	}

	/** Called by Companion when the connection is deleted, disabled or the module is reloaded. */
	async destroy() {
		this.destroyed = true
		await this.stopSource()
		for (const t of this.recentTimers.values()) clearTimeout(t)
		this.recentTimers.clear()
		for (const w of this.keyWaiters) w.resolve(undefined)
		this.keyWaiters.clear()
	}

	/** Config UI definition; re-enumerates HID devices every time the config page is opened. */
	getConfigFields() {
		return getConfigFields(this)
	}

	/**
	 * Runs `fn` and converts any exception into a log line instead of a crashed process.
	 * @template T
	 * @param {string} what description for the log
	 * @param {() => T} fn
	 * @returns {T|undefined}
	 */
	guard(what, fn) {
		if (this.destroyed) return undefined
		try {
			return fn()
		} catch (e) {
			this.log('error', `Internal error in ${what}: ${e?.stack || e?.message || e}`)
			return undefined
		}
	}

	// ────────────────────────────────────────────────────────────── devices

	/**
	 * Enumerates HID devices (asynchronously, off the event loop), updates the device dropdown
	 * of the actions and the `devices_*` variables. Concurrent calls share one enumeration.
	 * @param {boolean} logIt write the list to the log (used by the "refresh" action)
	 */
	refreshDeviceList(logIt) {
		if (this.refreshPromise) return this.refreshPromise
		this.refreshPromise = (async () => {
			try {
				this.deviceList = await groupDevices(undefined, { async: true })
			} catch (e) {
				this.log('error', `HID enumeration failed: ${e?.message || e}`)
				this.deviceList = []
			}
			if (this.destroyed) return
			this.setActionDefinitions(getActionDefinitions(this))
			this.setVariableValues({
				devices_count: this.deviceList.length,
				devices_list: this.deviceList.map((d) => d.label).join('\n'),
			})
			if (logIt) {
				this.log(
					'info',
					`HID devices (${this.deviceList.length}):\n` +
						this.deviceList.map((d) => `  ${d.key}  ${d.label}`).join('\n'),
				)
			}
		})().finally(() => {
			this.refreshPromise = null
		})
		return this.refreshPromise
	}

	/** (Re)publishes the presets; they reference variables via the current connection label. */
	publishPresets() {
		const { structure, presets } = getPresetDefinitions(this.label || 'generic-usb-hid')
		this.setPresetDefinitions(structure, presets)
	}

	// ────────────────────────────────────────────────────────────── input sources

	/** Starts the configured input source. Never throws; problems end up in the connection status. */
	async startSource() {
		if (this.destroyed) return
		const mode = this.config.mode === 'hook' ? 'hook' : 'hid'
		this.setVariableValues({ source_mode: mode })
		try {
			if (mode === 'hook') this.startHook()
			else this.startHid()
		} catch (e) {
			this.log('error', `Starting the input source failed: ${e?.stack || e?.message || e}`)
			this.updateStatus(InstanceStatus.UnknownError, `Start failed: ${e?.message || e}`)
		}
	}

	/** Mode "hook": global keyboard hook, all keyboards, no device selection. */
	startHook() {
		if (!KeyboardHook.isAvailable()) {
			this.updateStatus(InstanceStatus.BadConfig, 'Keyboard hook not available (uiohook-napi missing)')
			return
		}
		const hook = new KeyboardHook({ log: (l, m) => this.log(l, m) })
		hook.on('key', (ev) => this.guard('handleKeyEvent', () => this.handleKeyEvent(ev)))
		hook.on('status', (s) => this.guard('handleStatus', () => this.handleStatus(s)))
		this.source = hook
		try {
			hook.start()
		} catch (e) {
			this.source = null
			this.updateStatus(InstanceStatus.ConnectionFailure, `Keyboard hook failed to start: ${e?.message || e}`)
			this.log('error', `Keyboard hook failed to start: ${e?.message || e}`)
		}
	}

	/** Mode "hid": device specific via node-hid (+ Raw Input on Windows). */
	startHid() {
		const selection = this.config.device && this.config.device !== NONE ? parseDeviceKey(this.config.device) : null
		if (!selection) {
			this.updateStatus(InstanceStatus.BadConfig, 'No USB device selected')
			this.state.deviceId = ''
			this.state.deviceName = ''
			this.publishState()
			return
		}
		this.state.deviceId =
			`${hex4(selection.vendorId)}:${hex4(selection.productId)}` +
			(selection.serialNumber ? `:${selection.serialNumber}` : '') +
			(selection.product ? `::${selection.product}` : '')
		const known = this.deviceList.find((d) => d.vendorId === selection.vendorId && d.productId === selection.productId)
		this.state.deviceName = known ? known.name : this.state.deviceId
		this.publishState()
		this.updateStatus(InstanceStatus.Connecting, `Looking for ${this.state.deviceName} …`)

		// Windows never hands keyboard/mouse collections to applications; Raw Input covers those.
		const useRawInput = WinRawInput.isSupported() && this.config.winRawInput !== false
		const watcher = new HidWatcher({
			selection,
			allInterfaces: this.config.allInterfaces !== false,
			exclusive: !!this.config.exclusive,
			rawKeys: !!this.config.rawKeys,
			pollInterval: Number(this.config.pollInterval) || 2,
			skipUsages: useRawInput ? WinRawInput.COVERED_USAGES : [],
			log: (l, m) => this.log(l, m),
		})
		watcher.on('key', (ev) => this.guard('handleKeyEvent', () => this.handleKeyEvent(ev)))
		watcher.on('status', (s) => this.guard('handleStatus', () => this.handleStatus(s)))
		watcher.on('report', (r) => this.guard('handleReport', () => this.handleReport(r)))
		this.source = watcher
		watcher.start()

		if (useRawInput) {
			const ri = new WinRawInput({ selection, log: (l, m) => this.log(l, m) })
			ri.on('key', (ev) => this.guard('handleKeyEvent', () => this.handleKeyEvent(ev)))
			ri.on('report', (r) => this.guard('handleReport', () => this.handleReport(r)))
			ri.on('status', (s) => this.guard('rawInputStatus', () => this.handleRawInputStatus(s)))
			this.rawInput = ri
			ri.start()
		}
	}

	/** Stops all sources, releases held keys and resets the connection state. Safe to call twice. */
	async stopSource() {
		const ri = this.rawInput
		this.rawInput = null
		if (ri) {
			ri.removeAllListeners()
			try {
				await ri.stop()
			} catch (e) {
				this.log('debug', `Raw Input stop: ${e?.message || e}`)
			}
		}
		this.rawInputState = ''
		this.lastWatcherStatus = null

		const src = this.source
		this.source = null
		if (src) {
			src.removeAllListeners()
			try {
				await src.stop()
			} catch (e) {
				this.log('debug', `stop: ${e?.message || e}`)
			}
		}
		if (this.destroyed) return
		this.setVariableValues({ rawinput_state: '' })
		this.releaseAllKeys()
		this.state.connected = false
		this.state.interfaces = 0
		this.publishState()
		this.checkFeedbacks('device_connected')
	}

	/** Used by the "reconnect" action. */
	async restartSource() {
		await this.stopSource()
		await this.startSource()
	}

	// ────────────────────────────────────────────────────────────── event handlers

	/**
	 * Status of the primary source (HidWatcher / KeyboardHook).
	 * @param {{connected:boolean, message?:string, error?:string, interfaces?:any[], device?:{name:string}}} s
	 */
	handleStatus(s) {
		this.lastWatcherStatus = s
		this.state.connected = !!s.connected
		this.state.interfaces = s.interfaces ? s.interfaces.length : s.connected ? 1 : 0
		if (s.device?.name) this.state.deviceName = s.device.name

		if (s.connected) {
			const riError = this.rawInputState.startsWith('ERROR') ? this.rawInputState : ''
			const warn = s.error || riError
			this.updateStatus(
				warn ? InstanceStatus.UnknownWarning : InstanceStatus.Ok,
				riError ? `${s.message} | ${riError}` : s.message,
			)
			this.log('info', `Connected: ${s.message}${riError ? ' | ' + riError : ''}`)
		} else {
			let msg = s.message || 'Not connected'
			const err = String(s.error || s.message || '')
			let status = InstanceStatus.Disconnected
			if (/privilege|permission|denied|not permitted|access/i.test(err)) {
				status = InstanceStatus.InsufficientPermissions
				msg += this.permissionHint()
			} else if (s.error) {
				status = InstanceStatus.ConnectionFailure
			}
			this.updateStatus(status, msg)
			this.log('warn', msg)
			this.releaseAllKeys()
		}
		this.publishState()
		this.checkFeedbacks('device_connected')
	}

	/** Platform specific hint appended to permission errors. */
	permissionHint() {
		switch (process.platform) {
			case 'darwin':
				return ' – macOS: allow Input Monitoring for Companion (System Settings → Privacy & Security), then restart Companion'
			case 'linux':
				return ' – Linux: udev rule for hidraw missing (see help)'
			case 'win32':
				return ' – Windows: keyboard/mouse interfaces are read via Raw Input (enable the option in the configuration)'
			default:
				return ''
		}
	}

	/** Status of the Windows Raw Input helper (secondary source). */
	handleRawInputStatus(s) {
		this.rawInputState = s.connected ? `ok: ${s.message}` : `ERROR: ${s.message}`
		this.setVariableValues({ rawinput_state: this.rawInputState })
		this.log(s.connected ? 'info' : 'warn', `Raw Input: ${s.message}`)
		// re-evaluate the combined connection status
		if (this.lastWatcherStatus) this.handleStatus(this.lastWatcherStatus)
	}

	/** A raw HID report arrived (any source). Updates the raw variables and the "raw report" feedback. */
	handleReport(r) {
		this.state.lastReportHex = r.hex
		this.state.lastInterface = r.iface
		if (this.config.debug) this.log('debug', `Report [${r.iface}/${r.kind}] ${r.hex} → ${r.keys.join(',') || '-'}`)
		this.setVariableValues({ last_report_hex: r.hex, last_interface: r.iface })
		this.checkFeedbacks('raw_report')
	}

	/**
	 * A key press or release arrived (any source, including "simulate key").
	 * @param {{type:'press'|'release', key:string, iface:string, kind?:string, raw?:string}} ev
	 */
	handleKeyEvent(ev) {
		const name = String(ev?.key ?? '').trim()
		if (!name) return
		const norm = normalizeKeyName(name)
		const now = Date.now()
		if (ev.type === 'press') {
			this.state.pressed.add(norm)
			this.state.pressedDisplay.set(norm, name)
			this.state.lastKey = name
			this.state.lastEvent = 'press'
			this.state.lastKeyTs = now
			this.state.lastInterface = ev.iface || ''
			this.state.pressCount++
			this.state.lastPressAt.set(norm, now)
			if (this.config.debug) this.log('debug', `Key pressed: ${name} [${ev.iface}]`)
			// resolve pending "learn" requests
			for (const w of this.keyWaiters) w.resolve(name)
			this.keyWaiters.clear()
		} else {
			this.state.pressed.delete(norm)
			this.state.pressedDisplay.delete(norm)
			this.state.lastEvent = 'release'
			this.state.lastInterface = ev.iface || ''
		}
		this.publishKeyState()
		this.checkFeedbacks('key_down', 'key_recent', 'last_key')
	}

	/** Releases every held key, e.g. when the device disappears, so feedbacks never get stuck. */
	releaseAllKeys() {
		if (this.state.pressed.size === 0) return
		this.state.pressed.clear()
		this.state.pressedDisplay.clear()
		this.publishKeyState()
		this.checkFeedbacks('key_down')
	}

	/** "Reset state" action: clears keys and counters but keeps the connection information. */
	resetKeyState() {
		const keep = {
			connected: this.state.connected,
			deviceName: this.state.deviceName,
			deviceId: this.state.deviceId,
			interfaces: this.state.interfaces,
		}
		this.state = { ...this.emptyState(), ...keep }
		this.publishState()
		this.checkFeedbacks('key_down', 'key_recent', 'last_key', 'raw_report')
	}

	// ────────────────────────────────────────────────────────────── helpers for feedbacks

	/**
	 * Effective window for the "recently pressed" feedback.
	 * @param {unknown} optionValue feedback option (0 / empty = use config default)
	 */
	recentWindowFor(optionValue) {
		const v = Number(optionValue)
		if (Number.isFinite(v) && v > 0) return Math.min(v, MAX_RECENT_WINDOW_MS)
		const d = Number(this.config.recentWindow)
		return Number.isFinite(d) && d > 0 ? Math.min(d, MAX_RECENT_WINDOW_MS) : DEFAULT_RECENT_WINDOW_MS
	}

	/**
	 * Re-evaluates one feedback after `ms`. Used by "recently pressed" so it turns false again
	 * without polling. One timer per feedback; a newer request replaces the old one.
	 */
	scheduleFeedbackRecheck(feedbackId, ms) {
		if (this.destroyed) return
		const old = this.recentTimers.get(feedbackId)
		if (old) clearTimeout(old)
		const t = setTimeout(
			() => {
				this.recentTimers.delete(feedbackId)
				if (!this.destroyed) this.checkFeedbacksById(feedbackId)
			},
			Math.max(1, Math.min(ms, MAX_RECENT_WINDOW_MS + 1000)),
		)
		this.recentTimers.set(feedbackId, t)
	}

	/**
	 * Resolves with the next pressed key name (for "learn"), or `undefined` on timeout/abort.
	 * @param {AbortSignal|undefined} signal Companion aborts when the user cancels
	 * @param {number} timeoutMs
	 * @returns {Promise<string|undefined>}
	 */
	waitForNextKey(signal, timeoutMs) {
		return new Promise((resolve) => {
			let done = false
			const finish = (v) => {
				if (done) return
				done = true
				clearTimeout(timer)
				this.keyWaiters.delete(waiter)
				signal?.removeEventListener?.('abort', onAbort)
				resolve(v)
			}
			const waiter = { resolve: finish }
			const timer = setTimeout(() => finish(undefined), timeoutMs)
			const onAbort = () => finish(undefined)
			if (signal?.aborted) return finish(undefined)
			signal?.addEventListener?.('abort', onAbort)
			this.keyWaiters.add(waiter)
		})
	}

	// ────────────────────────────────────────────────────────────── variables

	/** Publishes device related variables plus the key state. */
	publishState() {
		if (this.destroyed) return
		this.setVariableValues({
			device_connected: this.state.connected,
			device_name: this.state.deviceName,
			device_id: this.state.deviceId,
			device_interfaces: this.state.interfaces,
		})
		this.publishKeyState()
	}

	/** Publishes all key related variables. */
	publishKeyState() {
		if (this.destroyed) return
		const pressed = [...this.state.pressedDisplay.values()]
		this.setVariableValues({
			last_key: this.state.lastKey,
			last_event: this.state.lastEvent,
			last_key_time: this.state.lastKeyTs ? new Date(this.state.lastKeyTs).toISOString() : '',
			last_key_ts: this.state.lastKeyTs,
			press_count: this.state.pressCount,
			pressed_keys: pressed.join(','),
			pressed_count: pressed.length,
			last_interface: this.state.lastInterface,
			last_report_hex: this.state.lastReportHex,
		})
	}
}

module.exports = { UsbHidInstance }
