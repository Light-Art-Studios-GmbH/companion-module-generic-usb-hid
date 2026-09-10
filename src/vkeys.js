/**
 * @file Windows helpers: virtual-key codes → canonical key names, Raw Input mouse flags,
 * vendor/product id extraction from Windows device paths.
 */

/** Windows virtual-key codes → canonical key names (same names as keycodes.js). */
const VK_NAMES = {
	0x08: 'Backspace',
	0x09: 'Tab',
	0x0d: 'Enter',
	0x13: 'Pause',
	0x14: 'CapsLock',
	0x1b: 'Escape',
	0x20: 'Space',
	0x21: 'PageUp',
	0x22: 'PageDown',
	0x23: 'End',
	0x24: 'Home',
	0x25: 'Left',
	0x26: 'Up',
	0x27: 'Right',
	0x28: 'Down',
	0x29: 'Select',
	0x2b: 'Execute',
	0x2c: 'PrintScreen',
	0x2d: 'Insert',
	0x2e: 'Delete',
	0x2f: 'Help',
	0x5b: 'LeftGui',
	0x5c: 'RightGui',
	0x5d: 'Application',
	0x5f: 'Sleep',
	0x60: 'Numpad0',
	0x61: 'Numpad1',
	0x62: 'Numpad2',
	0x63: 'Numpad3',
	0x64: 'Numpad4',
	0x65: 'Numpad5',
	0x66: 'Numpad6',
	0x67: 'Numpad7',
	0x68: 'Numpad8',
	0x69: 'Numpad9',
	0x6a: 'Numpad*',
	0x6b: 'Numpad+',
	0x6d: 'Numpad-',
	0x6e: 'Numpad.',
	0x6f: 'Numpad/',
	0x90: 'NumLock',
	0x91: 'ScrollLock',
	0xa0: 'LeftShift',
	0xa1: 'RightShift',
	0xa2: 'LeftCtrl',
	0xa3: 'RightCtrl',
	0xa4: 'LeftAlt',
	0xa5: 'RightAlt',
	0xa6: 'WebBack',
	0xa7: 'WebForward',
	0xa8: 'WebRefresh',
	0xa9: 'WebStop',
	0xaa: 'WebSearch',
	0xab: 'WebFavorites',
	0xac: 'WebHome',
	0xad: 'Mute',
	0xae: 'VolumeDown',
	0xaf: 'VolumeUp',
	0xb0: 'NextTrack',
	0xb1: 'PreviousTrack',
	0xb2: 'StopMedia',
	0xb3: 'PlayPause',
	0xb4: 'Mail',
	0xb5: 'MediaSelect',
	0xba: ';',
	0xbb: '=',
	0xbc: ',',
	0xbd: '-',
	0xbe: '.',
	0xbf: '/',
	0xc0: '`',
	0xdb: '[',
	0xdc: '\\',
	0xdd: ']',
	0xde: "'",
	0xe2: 'NonUS\\',
}
for (let i = 0; i < 24; i++) VK_NAMES[0x70 + i] = `F${i + 1}`
for (let i = 0; i < 10; i++) VK_NAMES[0x30 + i] = String(i)
for (let i = 0; i < 26; i++) VK_NAMES[0x41 + i] = String.fromCharCode(65 + i)

/**
 * @param {number} vk virtual key
 * @param {number} sc scan code (make code)
 * @param {boolean} e0 extended-key flag
 */
function vkToName(vk, sc, e0) {
	// generic modifiers come as VK_SHIFT/CONTROL/MENU in raw input; resolve side
	if (vk === 0x10) return sc === 0x36 ? 'RightShift' : 'LeftShift'
	if (vk === 0x11) return e0 ? 'RightCtrl' : 'LeftCtrl'
	if (vk === 0x12) return e0 ? 'RightAlt' : 'LeftAlt'
	if (vk === 0x0d && e0) return 'NumpadEnter'
	return VK_NAMES[vk] || `VK0x${vk.toString(16).padStart(2, '0')}`
}

/** RAWMOUSE usButtonFlags → [{button:1..5, down:boolean}] */
function mouseFlagsToEvents(flags) {
	const out = []
	for (let i = 0; i < 5; i++) {
		if (flags & (1 << (i * 2))) out.push({ button: i + 1, down: true })
		if (flags & (1 << (i * 2 + 1))) out.push({ button: i + 1, down: false })
	}
	return out
}

/** Extracts vendor/product id from a Windows device path like \\?\HID#VID_046D&PID_C538&MI_00#... */
function parseWinDeviceName(name) {
	const m = /VID_([0-9a-f]{4}).*?PID_([0-9a-f]{4})/i.exec(name || '')
	if (!m) return null
	return { vendorId: parseInt(m[1], 16), productId: parseInt(m[2], 16) }
}

module.exports = { VK_NAMES, vkToName, mouseFlagsToEvents, parseWinDeviceName }
