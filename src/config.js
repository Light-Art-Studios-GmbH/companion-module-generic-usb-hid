/**
 * @file Connection configuration fields.
 *
 * Companion calls `getConfigFields()` every time the configuration page is opened, which is
 * why the device dropdown enumerates HID devices synchronously here – that *is* the "refresh"
 * the user sees. Enumeration errors are shown in the info text instead of breaking the page.
 *
 * Config keys (all optional, see defaults below):
 *   mode          'hid' | 'hook'
 *   device        device key (see hid-devices.js) or NONE
 *   allInterfaces open all collections of the device (default true)
 *   exclusive     macOS: seize the device (default false)
 *   winRawInput   Windows: read keyboard/mouse collections via Raw Input (default true)
 *   rawKeys       reports of unknown collections count as raw:<hex> keys (default false)
 *   pollInterval  rescan interval in seconds (default 2)
 *   recentWindow  default window in ms for the "recently pressed" feedback (default 500)
 *   debug         verbose logging (default false)
 */
const { groupDevices } = require('./hid-devices.js')
const { KeyboardHook } = require('./keyboard-hook.js')

/** Dropdown value meaning "no device selected". */
const NONE = '__none__'

/** Accepts NONE or "vvvv:pppp" with optional ":serial" / "::product" suffix (0x prefixes allowed). */
const DEVICE_KEY_REGEX = '/^(__none__|0?x?[0-9a-fA-F]{1,4}:0?x?[0-9a-fA-F]{1,4}(:.*)?)$/'

/**
 * @param {import('./instance.js').UsbHidInstance} instance
 * @returns {import('@companion-module/base').SomeCompanionConfigField[]}
 */
function getConfigFields(instance) {
	let devices = []
	let enumError = ''
	try {
		devices = groupDevices()
		instance.deviceList = devices
	} catch (e) {
		enumError = e?.message || String(e)
	}

	const choices = [
		{ id: NONE, label: '– no device selected –' },
		...devices.map((d) => ({ id: d.key, label: d.label })),
	]
	const isHid = (opts) => opts.mode !== 'hook'
	const hookAvailable = KeyboardHook.isAvailable()

	return [
		{
			id: 'info',
			type: 'static-text',
			label: 'Information',
			width: 12,
			value:
				'The device list is re-read every time this page is opened. ' +
				'Plugged in a new device? Close and reopen this page, or run the action "Refresh device list". ' +
				(enumError
					? `<br/><b style="color:#c00">Enumeration failed: ${enumError}</b>`
					: `Found ${devices.length} HID device(s).`) +
				` System: ${process.platform}-${process.arch}, Node ${process.version}.`,
		},
		{
			id: 'mode',
			type: 'dropdown',
			label: 'Input source',
			width: 6,
			default: 'hid',
			choices: [
				{ id: 'hid', label: 'USB HID device (recommended, device specific)' },
				{ id: 'hook', label: `Global keyboard hook (all keyboards${hookAvailable ? '' : ' – not installed'})` },
			],
		},
		{
			id: 'device',
			type: 'dropdown',
			label: 'USB device',
			width: 12,
			default: NONE,
			choices,
			allowCustom: true,
			regex: DEVICE_KEY_REGEX,
			minChoicesForSearch: 0,
			tooltip: 'Pick a device from the list or type vid:pid in hex, e.g. 046d:c52f',
			isVisible: isHid,
		},
		{
			id: 'allInterfaces',
			type: 'checkbox',
			label: 'Watch all HID interfaces of the device',
			width: 6,
			default: true,
			tooltip:
				'Presenters usually expose several interfaces (keyboard + consumer/mouse). Off = keyboard interface only.',
			isVisible: isHid,
		},
		{
			id: 'exclusive',
			type: 'checkbox',
			label: 'Open exclusively (macOS): do NOT pass keys on to other applications',
			width: 6,
			default: false,
			tooltip: 'macOS only. The system may refuse this for keyboards – turn it off in that case.',
			isVisible: isHid,
		},
		{
			id: 'winRawInput',
			type: 'checkbox',
			label: 'Windows: read keyboard/mouse interfaces via Raw Input (recommended)',
			width: 6,
			default: true,
			tooltip:
				'Windows never hands HID keyboards to applications. Raw Input still delivers the keys per device (PowerShell helper). No effect on macOS/Linux.',
			isVisible: isHid,
		},
		{
			id: 'rawKeys',
			type: 'checkbox',
			label: 'Treat reports of unknown interfaces as keys (raw:<hex>)',
			width: 6,
			default: false,
			tooltip:
				'Off: vendor/unknown interfaces only update "last HID report" and the feedback "report starts with". On: every report counts as a key press raw:<hex> – for devices with an unknown protocol.',
			isVisible: isHid,
		},
		{
			id: 'pollInterval',
			type: 'number',
			label: 'Rescan interval (seconds, hot-plug)',
			width: 4,
			default: 2,
			min: 0.5,
			max: 60,
			isVisible: isHid,
		},
		{
			id: 'recentWindow',
			type: 'number',
			label: 'Default window for "recently pressed" (ms)',
			width: 4,
			default: 500,
			min: 50,
			max: 600000,
		},
		{
			id: 'debug',
			type: 'checkbox',
			label: 'Debug: log every report and key event',
			width: 4,
			default: false,
		},
		{
			id: 'help',
			type: 'static-text',
			label: 'Permissions',
			width: 12,
			value:
				'<b>macOS:</b> System Settings → Privacy & Security → <i>Input Monitoring</i> → allow Companion (the prompt appears on first connect). ' +
				'<b>Linux:</b> a udev rule for hidraw is required (see help). ' +
				'<b>Windows:</b> keyboard/mouse interfaces are blocked by the OS; the module reads them via Raw Input (option above). Fallback: keyboard hook. Details in the Companion log (filter by the connection label).',
		},
	]
}

module.exports = { getConfigFields, NONE, DEVICE_KEY_REGEX }
