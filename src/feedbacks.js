/**
 * @file Feedback definitions (all boolean).
 *
 * Every key feedback offers "learn": Companion calls `learn()`, the module waits for the
 * next key press on the device and returns its name as the new option value.
 */
const { combineRgb } = require('@companion-module/base')
const { keyChoices, normalizeKeyName } = require('./keycodes.js')

/** How long "learn" waits for a key press (Companion's own timeout is set slightly higher). */
const LEARN_WAIT_MS = 15000

/**
 * @param {import('./instance.js').UsbHidInstance} instance
 * @returns {import('@companion-module/base').CompanionFeedbackDefinitions}
 */
function getFeedbackDefinitions(instance) {
	const keyOption = {
		id: 'key',
		type: 'dropdown',
		label: 'Key',
		default: 'PageDown',
		choices: keyChoices(),
		allowCustom: true,
		minChoicesForSearch: 0,
		tooltip: 'Unknown key? Click "Learn" and press the key on the device.',
	}

	const learnKey = async (_fb, context) => {
		const key = await instance.waitForNextKey(context?.signal, LEARN_WAIT_MS)
		return key ? { key } : undefined
	}

	return {
		device_connected: {
			type: 'boolean',
			name: 'Device connected',
			description: 'True while the selected USB device is open',
			defaultStyle: { bgcolor: combineRgb(0, 140, 0), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => instance.state.connected,
		},
		key_down: {
			type: 'boolean',
			name: 'Key is held',
			description: 'True while the key is pressed on the device (trigger: "feedback becomes true")',
			defaultStyle: { bgcolor: combineRgb(255, 0, 0), color: combineRgb(255, 255, 255) },
			options: [keyOption],
			callback: (fb) => instance.state.pressed.has(normalizeKeyName(fb.options.key)),
			learn: learnKey,
			learnTimeout: LEARN_WAIT_MS + 1000,
		},
		key_recent: {
			type: 'boolean',
			name: 'Key recently pressed',
			description: 'True for a time window after the press – reliable even for very short presses',
			defaultStyle: { bgcolor: combineRgb(255, 128, 0), color: combineRgb(0, 0, 0) },
			options: [
				keyOption,
				{
					id: 'window',
					type: 'number',
					label: 'Window (ms, 0 = default from configuration)',
					default: 0,
					min: 0,
					max: 600000,
				},
			],
			callback: (fb) => {
				const t = instance.state.lastPressAt.get(normalizeKeyName(fb.options.key))
				if (!t) return false
				const window = instance.recentWindowFor(fb.options.window)
				const remaining = window - (Date.now() - t)
				if (remaining <= 0) return false
				// re-evaluate this feedback once the window has elapsed so it turns false again
				instance.scheduleFeedbackRecheck(fb.id, remaining + 20)
				return true
			},
			learn: learnKey,
			learnTimeout: LEARN_WAIT_MS + 1000,
		},
		last_key: {
			type: 'boolean',
			name: 'Last key is',
			description: 'True when the most recently pressed key matches (stays true until the next key)',
			defaultStyle: { bgcolor: combineRgb(0, 90, 200), color: combineRgb(255, 255, 255) },
			options: [keyOption],
			callback: (fb) => normalizeKeyName(instance.state.lastKey) === normalizeKeyName(fb.options.key),
			learn: learnKey,
			learnTimeout: LEARN_WAIT_MS + 1000,
		},
		raw_report: {
			type: 'boolean',
			name: 'Last HID report starts with (hex)',
			description: 'For devices with an unknown protocol: compares the beginning of the last raw report',
			defaultStyle: { bgcolor: combineRgb(120, 0, 160), color: combineRgb(255, 255, 255) },
			options: [{ id: 'hex', type: 'textinput', label: 'Hex prefix (e.g. 00004e)', default: '' }],
			callback: (fb) => {
				const want = String(fb.options.hex || '')
					.replace(/[^0-9a-fA-F]/g, '')
					.toLowerCase()
				if (!want) return false
				return instance.state.lastReportHex.startsWith(want)
			},
		},
	}
}

module.exports = { getFeedbackDefinitions }
