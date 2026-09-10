/**
 * @file Report parser – turns raw HID input reports into the set of currently pressed keys.
 * Heuristic parsing without report descriptors — good enough for presenters,
 * keyboards, keypads, consumer-control and mouse-button collections.
 * Unknown layouts fall back to a "raw:<hex>" pseudo key so that any device
 * can still be used with feedbacks and learn.
 */
const { MODIFIER_NAMES, MOUSE_BUTTON_NAMES, keyboardUsageToName, consumerUsageToName } = require('./keycodes.js')

function isAllZero(buf, from = 0) {
	for (let i = from; i < buf.length; i++) if (buf[i] !== 0) return false
	return true
}

/** Boot-protocol keyboard report: [id?] mods reserved k1..k6 (+ optional NKRO bitmap) */
function parseKeyboard(buf) {
	if (buf.length < 3) return null
	// with numbered reports the report id is prepended
	const off = buf.length >= 9 ? 1 : 0
	const keys = new Set()
	const mods = buf[off]
	for (let bit = 0; bit < 8; bit++) if (mods & (1 << bit)) keys.add(MODIFIER_NAMES[bit])
	const end = Math.min(buf.length, off + 8)
	let rollover = false
	for (let i = off + 2; i < end; i++) {
		const code = buf[i]
		if (code === 1) rollover = true
		if (code > 3) keys.add(keyboardUsageToName(code))
	}
	// NKRO bitmap style keyboards: remaining bytes are a usage bitmap
	if (buf.length > off + 8) {
		for (let i = off + 8; i < buf.length; i++) {
			const b = buf[i]
			if (!b) continue
			for (let bit = 0; bit < 8; bit++) {
				if (b & (1 << bit)) {
					const code = (i - (off + 8)) * 8 + bit
					if (code > 3) keys.add(keyboardUsageToName(code))
				}
			}
		}
	}
	return { keys, rollover }
}

/** Consumer control report: [id?] u16le usages, or a single byte usage / bitmask */
function parseConsumer(buf) {
	if (buf.length < 1) return null
	const keys = new Set()
	if (buf.length === 1) {
		if (buf[0]) keys.add(consumerUsageToName(buf[0]))
		return { keys }
	}
	const off = buf.length % 2 === 1 ? 1 : 0
	for (let i = off; i + 1 < buf.length; i += 2) {
		const usage = buf[i] | (buf[i + 1] << 8)
		if (usage) keys.add(consumerUsageToName(usage))
	}
	return { keys }
}

/** Mouse report: [id?] buttons x y [wheel] — only buttons are exposed */
function parseMouse(buf) {
	if (buf.length < 3) return null
	const off = buf.length <= 4 ? 0 : 1
	const keys = new Set()
	const buttons = buf[off]
	for (let bit = 0; bit < MOUSE_BUTTON_NAMES.length; bit++) if (buttons & (1 << bit)) keys.add(MOUSE_BUTTON_NAMES[bit])
	return { keys }
}

/** Anything else: non-zero report = pseudo key "raw:<hex>", all-zero = release */
function parseGeneric(buf) {
	const keys = new Set()
	if (buf.length && !isAllZero(buf)) keys.add(`raw:${buf.toString('hex')}`)
	return { keys }
}

/**
 * @param {Buffer} buf
 * @param {{usagePage?:number, usage?:number}} iface
 * @returns {{keys:Set<string>, rollover?:boolean, kind:string}}
 */
function parseReport(buf, iface) {
	const page = iface?.usagePage
	const usage = iface?.usage
	let res = null
	let kind = 'generic'
	if (page === 1 && (usage === 6 || usage === 7)) {
		res = parseKeyboard(buf)
		kind = 'keyboard'
	} else if (page === 12) {
		res = parseConsumer(buf)
		kind = 'consumer'
	} else if (page === 1 && (usage === 2 || usage === 1)) {
		res = parseMouse(buf)
		kind = 'mouse'
	} else if ((page === undefined || page === null || page === 0) && (buf.length === 8 || buf.length === 9)) {
		// Linux hidraw without usage info: 8/9-byte reports are almost always boot keyboards
		res = parseKeyboard(buf)
		kind = 'keyboard?'
	}
	if (!res) {
		res = parseGeneric(buf)
		kind = 'generic'
	}
	return { keys: res.keys, rollover: res.rollover === true, kind }
}

module.exports = { parseReport, parseKeyboard, parseConsumer, parseMouse, parseGeneric, isAllZero }
