/**
 * @file Key name tables.
 *
 * HID usage tables (USB HID Usage Tables 1.4) reduced to what presenters, keypads and
 * keyboards typically send. The names defined here are the *canonical key names* used by
 * every input source (node-hid, Raw Input, keyboard hook) and by all variables, feedbacks and
 * actions – comparisons are case-insensitive (see normalizeKeyName).
 */

const KEYBOARD_USAGE_NAMES = {
	4: 'A',
	5: 'B',
	6: 'C',
	7: 'D',
	8: 'E',
	9: 'F',
	10: 'G',
	11: 'H',
	12: 'I',
	13: 'J',
	14: 'K',
	15: 'L',
	16: 'M',
	17: 'N',
	18: 'O',
	19: 'P',
	20: 'Q',
	21: 'R',
	22: 'S',
	23: 'T',
	24: 'U',
	25: 'V',
	26: 'W',
	27: 'X',
	28: 'Y',
	29: 'Z',
	30: '1',
	31: '2',
	32: '3',
	33: '4',
	34: '5',
	35: '6',
	36: '7',
	37: '8',
	38: '9',
	39: '0',
	40: 'Enter',
	41: 'Escape',
	42: 'Backspace',
	43: 'Tab',
	44: 'Space',
	45: '-',
	46: '=',
	47: '[',
	48: ']',
	49: '\\',
	50: '#',
	51: ';',
	52: "'",
	53: '`',
	54: ',',
	55: '.',
	56: '/',
	57: 'CapsLock',
	58: 'F1',
	59: 'F2',
	60: 'F3',
	61: 'F4',
	62: 'F5',
	63: 'F6',
	64: 'F7',
	65: 'F8',
	66: 'F9',
	67: 'F10',
	68: 'F11',
	69: 'F12',
	70: 'PrintScreen',
	71: 'ScrollLock',
	72: 'Pause',
	73: 'Insert',
	74: 'Home',
	75: 'PageUp',
	76: 'Delete',
	77: 'End',
	78: 'PageDown',
	79: 'Right',
	80: 'Left',
	81: 'Down',
	82: 'Up',
	83: 'NumLock',
	84: 'Numpad/',
	85: 'Numpad*',
	86: 'Numpad-',
	87: 'Numpad+',
	88: 'NumpadEnter',
	89: 'Numpad1',
	90: 'Numpad2',
	91: 'Numpad3',
	92: 'Numpad4',
	93: 'Numpad5',
	94: 'Numpad6',
	95: 'Numpad7',
	96: 'Numpad8',
	97: 'Numpad9',
	98: 'Numpad0',
	99: 'Numpad.',
	100: 'NonUS\\',
	101: 'Application',
	102: 'Power',
	103: 'Numpad=',
	104: 'F13',
	105: 'F14',
	106: 'F15',
	107: 'F16',
	108: 'F17',
	109: 'F18',
	110: 'F19',
	111: 'F20',
	112: 'F21',
	113: 'F22',
	114: 'F23',
	115: 'F24',
	116: 'Execute',
	117: 'Help',
	118: 'Menu',
	119: 'Select',
	120: 'Stop',
	121: 'Again',
	122: 'Undo',
	123: 'Cut',
	124: 'Copy',
	125: 'Paste',
	126: 'Find',
	127: 'Mute',
	128: 'VolumeUp',
	129: 'VolumeDown',
	224: 'LeftCtrl',
	225: 'LeftShift',
	226: 'LeftAlt',
	227: 'LeftGui',
	228: 'RightCtrl',
	229: 'RightShift',
	230: 'RightAlt',
	231: 'RightGui',
}

/** Modifier bits of byte 0 in a boot-protocol keyboard report, in bit order. */
const MODIFIER_NAMES = [
	'LeftCtrl',
	'LeftShift',
	'LeftAlt',
	'LeftGui',
	'RightCtrl',
	'RightShift',
	'RightAlt',
	'RightGui',
]

/** Consumer Control usage page (0x0C) */
const CONSUMER_USAGE_NAMES = {
	0x30: 'Power',
	0x31: 'Reset',
	0x32: 'Sleep',
	0x40: 'Menu',
	0x41: 'MenuPick',
	0x42: 'MenuUp',
	0x43: 'MenuDown',
	0x44: 'MenuLeft',
	0x45: 'MenuRight',
	0x46: 'MenuEscape',
	0x6f: 'BrightnessUp',
	0x70: 'BrightnessDown',
	0xb0: 'Play',
	0xb1: 'PauseMedia',
	0xb2: 'Record',
	0xb3: 'FastForward',
	0xb4: 'Rewind',
	0xb5: 'NextTrack',
	0xb6: 'PreviousTrack',
	0xb7: 'StopMedia',
	0xb8: 'Eject',
	0xcd: 'PlayPause',
	0xe2: 'Mute',
	0xe9: 'VolumeUp',
	0xea: 'VolumeDown',
	0x183: 'MediaSelect',
	0x18a: 'Mail',
	0x192: 'Calculator',
	0x194: 'MyComputer',
	0x221: 'WebSearch',
	0x223: 'WebHome',
	0x224: 'WebBack',
	0x225: 'WebForward',
	0x226: 'WebStop',
	0x227: 'WebRefresh',
	0x22a: 'WebFavorites',
}

const MOUSE_BUTTON_NAMES = ['Mouse1', 'Mouse2', 'Mouse3', 'Mouse4', 'Mouse5']

function keyboardUsageToName(code) {
	return KEYBOARD_USAGE_NAMES[code] || `Key0x${code.toString(16).padStart(2, '0')}`
}

function consumerUsageToName(usage) {
	return CONSUMER_USAGE_NAMES[usage] || `Consumer0x${usage.toString(16).padStart(3, '0')}`
}

/** Normalise a key name for comparisons: case-insensitive, whitespace trimmed. */
function normalizeKeyName(name) {
	return String(name ?? '')
		.trim()
		.toLowerCase()
}

/** Choices for dropdowns: all known names, presenter keys first. */
function keyChoices() {
	const presenterFirst = [
		'PageDown',
		'PageUp',
		'F5',
		'Escape',
		'B',
		'.',
		'Space',
		'Enter',
		'Left',
		'Right',
		'Up',
		'Down',
		'Tab',
		'Home',
		'End',
	]
	const seen = new Set()
	const out = []
	const add = (name, group) => {
		const k = normalizeKeyName(name)
		if (seen.has(k)) return
		seen.add(k)
		out.push({ id: name, label: group ? `${name}  (${group})` : name })
	}
	for (const n of presenterFirst) add(n, 'Presenter')
	for (const n of Object.values(KEYBOARD_USAGE_NAMES)) add(n, 'Keyboard')
	for (const n of MODIFIER_NAMES) add(n, 'Modifier')
	for (const n of Object.values(CONSUMER_USAGE_NAMES)) add(n, 'Consumer')
	for (const n of MOUSE_BUTTON_NAMES) add(n, 'Mouse')
	return out
}

module.exports = {
	KEYBOARD_USAGE_NAMES,
	MODIFIER_NAMES,
	CONSUMER_USAGE_NAMES,
	MOUSE_BUTTON_NAMES,
	keyboardUsageToName,
	consumerUsageToName,
	normalizeKeyName,
	keyChoices,
}
