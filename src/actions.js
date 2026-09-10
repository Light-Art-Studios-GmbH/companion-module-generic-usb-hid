/**
 * @file Action definitions.
 *
 * Actions are re-published after every device enumeration because the "select device"
 * dropdown embeds the current device list.
 */
const { keyChoices } = require('./keycodes.js')
const { NONE } = require('./config.js')

/**
 * @param {import('./instance.js').UsbHidInstance} instance
 * @returns {import('@companion-module/base').CompanionActionDefinitions}
 */
function getActionDefinitions(instance) {
	const deviceChoices = [
		{ id: NONE, label: '– no device –' },
		...(instance.deviceList || []).map((d) => ({ id: d.key, label: d.label })),
	]

	return {
		refresh_devices: {
			name: 'Refresh device list',
			description: 'Re-scans the connected HID devices and updates variables and dropdowns',
			options: [],
			callback: async () => {
				await instance.refreshDeviceList(true)
			},
		},
		reconnect: {
			name: 'Reconnect device',
			description: 'Closes and reopens the selected device',
			options: [],
			callback: async () => {
				await instance.restartSource()
			},
		},
		set_device: {
			name: 'Select device',
			description: 'Switches the watched USB device (stored in the configuration, enables HID mode)',
			options: [
				{
					id: 'device',
					type: 'dropdown',
					label: 'Device',
					default: NONE,
					choices: deviceChoices,
					allowCustom: true,
					minChoicesForSearch: 0,
					tooltip: 'Run "Refresh device list" to update this list. Manual entry: vid:pid (hex)',
				},
			],
			callback: async (action) => {
				const device = String(action.options.device || NONE)
				// saveConfig() makes Companion call configUpdated(), which restarts the source
				instance.saveConfig({ ...instance.config, mode: 'hid', device }, undefined)
			},
		},
		simulate_key: {
			name: 'Simulate key (test)',
			description: 'Fires a virtual key press – useful for testing triggers without a device',
			options: [
				{
					id: 'key',
					type: 'dropdown',
					label: 'Key',
					default: 'PageDown',
					choices: keyChoices(),
					allowCustom: true,
					minChoicesForSearch: 0,
				},
				{ id: 'hold', type: 'number', label: 'Hold time (ms)', default: 100, min: 0, max: 10000 },
			],
			callback: async (action) => {
				const key = String(action.options.key || '').trim()
				if (!key) return
				const hold = Math.min(10000, Math.max(0, Number(action.options.hold) || 0))
				instance.handleKeyEvent({ type: 'press', key, iface: 'simulated', kind: 'simulated', raw: '' })
				setTimeout(() => {
					instance.guard('simulate_key release', () =>
						instance.handleKeyEvent({ type: 'release', key, iface: 'simulated', kind: 'simulated', raw: '' }),
					)
				}, hold)
			},
		},
		reset_state: {
			name: 'Reset state',
			description: 'Clears "last key", held keys and the press counter',
			options: [],
			callback: async () => {
				instance.resetKeyState()
			},
		},
	}
}

module.exports = { getActionDefinitions }
