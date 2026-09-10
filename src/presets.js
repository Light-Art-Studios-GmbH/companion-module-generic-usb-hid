/**
 * @file Preset buttons offered in Companion's "Presets" tab.
 *
 * Presets reference variables through the *connection label* (`$(label:variable)`), so the
 * definitions are rebuilt whenever the label changes (see `UsbHidInstance.publishPresets`).
 */
const { combineRgb } = require('@companion-module/base')

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const DARK = combineRgb(30, 30, 30)
const ORANGE = combineRgb(255, 128, 0)
const RED = combineRgb(255, 0, 0)

/**
 * Button for one presenter key: lights up while/after the key is pressed on the device,
 * pressing the button simulates the key (handy for testing triggers).
 */
function keyPreset(key, text) {
	return {
		type: 'simple',
		name: `Key ${key}`,
		style: { text, size: 'auto', color: WHITE, bgcolor: DARK },
		steps: [{ down: [{ actionId: 'simulate_key', options: { key, hold: 100 } }], up: [] }],
		feedbacks: [
			{ feedbackId: 'key_recent', options: { key, window: 0 }, style: { bgcolor: ORANGE, color: BLACK } },
			{ feedbackId: 'key_down', options: { key }, style: { bgcolor: RED, color: WHITE } },
		],
	}
}

/**
 * @param {string} label connection label used in variable references
 * @returns {{structure: any[], presets: Record<string, any>}}
 */
function getPresetDefinitions(label) {
	const v = (name) => `$(${label}:${name})`
	const presets = {
		status: {
			type: 'simple',
			name: 'Device status',
			style: { text: `USB\\n${v('device_name')}`, size: 'auto', color: WHITE, bgcolor: combineRgb(120, 0, 0) },
			steps: [{ down: [{ actionId: 'reconnect', options: {} }], up: [] }],
			feedbacks: [
				{ feedbackId: 'device_connected', options: {}, style: { bgcolor: combineRgb(0, 140, 0), color: WHITE } },
			],
		},
		last_key: {
			type: 'simple',
			name: 'Show last key',
			style: { text: `Last:\\n${v('last_key')}\\n#${v('press_count')}`, size: 'auto', color: WHITE, bgcolor: DARK },
			steps: [{ down: [{ actionId: 'reset_state', options: {} }], up: [] }],
			feedbacks: [],
		},
		refresh: {
			type: 'simple',
			name: 'Refresh device list',
			style: {
				text: `USB\\nRescan\\n${v('devices_count')}`,
				size: 'auto',
				color: WHITE,
				bgcolor: combineRgb(0, 60, 120),
			},
			steps: [{ down: [{ actionId: 'refresh_devices', options: {} }], up: [] }],
			feedbacks: [],
		},
		key_pagedown: keyPreset('PageDown', 'Next ▶\\nPgDn'),
		key_pageup: keyPreset('PageUp', '◀ Prev\\nPgUp'),
		key_f5: keyPreset('F5', 'Start\\nF5'),
		key_escape: keyPreset('Escape', 'Stop\\nEsc'),
		key_b: keyPreset('B', 'Black\\nB'),
		key_period: keyPreset('.', 'Black\\n.'),
		key_space: keyPreset('Space', 'Space'),
		key_enter: keyPreset('Enter', 'Enter'),
		key_right: keyPreset('Right', '→'),
		key_left: keyPreset('Left', '←'),
	}

	const structure = [
		{ id: 'status', name: 'Status & tools', definitions: ['status', 'last_key', 'refresh'] },
		{
			id: 'keys',
			name: 'Presenter keys (display + test)',
			description: 'Light up when the key is pressed on the device. Pressing the button simulates the key.',
			definitions: [
				'key_pagedown',
				'key_pageup',
				'key_f5',
				'key_escape',
				'key_b',
				'key_period',
				'key_space',
				'key_enter',
				'key_right',
				'key_left',
			],
		},
	]

	return { structure, presets }
}

module.exports = { getPresetDefinitions }
