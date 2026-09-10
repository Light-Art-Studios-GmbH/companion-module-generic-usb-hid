/**
 * @file Variable definitions, keyed by variable id (format required by @companion-module/base 2.x).
 * Values are published by `UsbHidInstance.publishState()` / `publishKeyState()`.
 */
function getVariableDefinitions() {
	return {
		device_connected: { name: 'Device connected (true/false)' },
		device_name: { name: 'Name of the watched device' },
		device_id: { name: 'Device id (vid:pid[:serial])' },
		device_interfaces: { name: 'Number of open HID interfaces' },
		source_mode: { name: 'Input source (hid / hook)' },
		last_key: { name: 'Last pressed key' },
		last_event: { name: 'Last event (press / release)' },
		last_key_time: { name: 'Time of the last key press (ISO)' },
		last_key_ts: { name: 'Time of the last key press (ms since 1970)' },
		press_count: { name: 'Counter: key presses since start (for "variable changed" triggers)' },
		pressed_keys: { name: 'Keys currently held (comma separated)' },
		pressed_count: { name: 'Number of keys currently held' },
		last_interface: { name: 'Interface of the last event' },
		last_report_hex: { name: 'Last HID report (hex)' },
		devices_count: { name: 'Number of HID devices found' },
		devices_list: { name: 'HID devices found (list)' },
		rawinput_state: { name: 'Windows Raw Input helper state' },
	}
}

module.exports = { getVariableDefinitions }
