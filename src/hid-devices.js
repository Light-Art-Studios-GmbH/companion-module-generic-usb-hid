/**
 * @file Enumeration and matching of HID devices via node-hid.
 *
 * Terminology
 * ───────────
 * • node-hid reports one entry per *interface* (Linux/Windows) or per *top-level collection*
 *   (macOS). A presenter therefore shows up 2–6 times.
 * • The UI works with one entry per *physical device* (`DeviceGroup`), identified by a
 *   *device key* string: `vvvv:pppp`, `vvvv:pppp:serial` or `vvvv:pppp::product`
 *   (hex ids; the product-name form is used for devices reporting vendor/product id 0, e.g.
 *   Apple internal devices).
 */
const HID = require('node-hid')

/**
 * @typedef {object} DeviceGroup
 * @property {string} key            device key (see file header)
 * @property {number} vendorId
 * @property {number} productId
 * @property {string} serialNumber
 * @property {string} manufacturer
 * @property {string} product
 * @property {string} name           display name (manufacturer + product, de-duplicated)
 * @property {string} label          dropdown label incl. ids and interface summary
 * @property {boolean} internal      built-in device (vendor id 0 / Apple without product name)
 * @property {import('node-hid').Device[]} interfaces raw node-hid entries
 */

/** 16-bit id as 4-digit lower-case hex. */
const hex4 = (n) => (Number(n) || 0).toString(16).padStart(4, '0')

/** Human readable usage of one interface / collection. */
function usageLabel(d) {
	const page = d.usagePage
	const usage = d.usage
	if (page === 1 && usage === 6) return 'Keyboard'
	if (page === 1 && usage === 7) return 'Keypad'
	if (page === 1 && usage === 2) return 'Mouse'
	if (page === 1 && usage === 1) return 'Pointer'
	if (page === 1 && usage === 0x80) return 'SystemControl'
	if (page === 12 && usage === 1) return 'Consumer'
	if (page === 13) return 'Digitizer'
	if (page >= 0xff00) return 'Vendor'
	if (page === undefined || page === null) return 'Unknown'
	return `Usage${page}/${usage}`
}

/** Device key of one raw node-hid entry. */
function deviceKey(d) {
	let key = `${hex4(d.vendorId)}:${hex4(d.productId)}`
	if (d.serialNumber) key += `:${d.serialNumber}`
	// devices without vendor/product id (e.g. Apple internal) can only be told apart by name
	else if (!d.vendorId && !d.productId && d.product) key += `::${d.product}`
	return key
}

/** Built-in devices are sorted to the end of the dropdown. */
function isInternalDevice(d) {
	return !d.vendorId || (d.vendorId === 0x05ac && !d.product)
}

/** "Logitech" + "Logitech USB Receiver" → "Logitech USB Receiver". */
function deviceName(manufacturer, product) {
	const m = (manufacturer || '').trim()
	const p = (product || '').trim()
	if (p && m && p.toLowerCase().startsWith(m.toLowerCase())) return p
	return [m, p].filter(Boolean).join(' ') || 'Unknown HID device'
}

/** Label of one interface for logs/status, e.g. "Keyboard if0". */
function interfaceLabel(d) {
	const parts = [usageLabel(d)]
	if (typeof d.interface === 'number' && d.interface >= 0) parts.push(`if${d.interface}`)
	return parts.join(' ')
}

/**
 * Groups raw node-hid entries into physical devices.
 * @param {import('node-hid').Device[]} [raw]  entries to group; enumerates when omitted
 * @param {{async?:boolean}} [opts]            async: enumerate with devicesAsync (returns a Promise)
 * @returns {DeviceGroup[] | Promise<DeviceGroup[]>}
 */
function groupDevices(raw, opts) {
	if (!raw && opts?.async) return HID.devicesAsync().then((list) => groupDevices(list))
	const list = raw ?? HID.devices()
	const groups = new Map()
	for (const d of list) {
		const key = deviceKey(d)
		let g = groups.get(key)
		if (!g) {
			g = {
				key,
				vendorId: d.vendorId,
				productId: d.productId,
				serialNumber: d.serialNumber || '',
				manufacturer: d.manufacturer || '',
				product: d.product || '',
				internal: isInternalDevice(d),
				interfaces: [],
			}
			groups.set(key, g)
		}
		if (!g.product && d.product) g.product = d.product
		if (!g.manufacturer && d.manufacturer) g.manufacturer = d.manufacturer
		// macOS lists one entry per collection with the same path – keep all usages, drop exact duplicates
		if (!g.interfaces.some((i) => i.path === d.path && i.usagePage === d.usagePage && i.usage === d.usage)) {
			g.interfaces.push(d)
		}
	}
	const out = [...groups.values()]
	for (const g of out) {
		g.name = deviceName(g.manufacturer, g.product)
		const ifaces = [...new Set(g.interfaces.map(usageLabel))].join(', ')
		g.label = `${g.name} (${hex4(g.vendorId)}:${hex4(g.productId)})${g.serialNumber ? ` SN ${g.serialNumber}` : ''} [${ifaces}]`
	}
	out.sort((a, b) => Number(a.internal) - Number(b.internal) || a.label.localeCompare(b.label))
	return out
}

/**
 * Parses a device key (also accepts manual input like "0x046D:0xC52F").
 * @param {unknown} str
 * @returns {{vendorId:number, productId:number, serialNumber:string, product:string}|null}
 */
function parseDeviceKey(str) {
	if (!str || typeof str !== 'string') return null
	const parts = str.trim().split(':')
	if (parts.length < 2) return null
	const vid = parseInt(parts[0].replace(/^0x/i, ''), 16)
	const pid = parseInt(parts[1].replace(/^0x/i, ''), 16)
	if (!Number.isFinite(vid) || !Number.isFinite(pid) || vid < 0 || vid > 0xffff || pid < 0 || pid > 0xffff) return null
	const rest = parts.slice(2)
	let serialNumber = ''
	let product = ''
	if (rest.length >= 2 && rest[0] === '') product = rest.slice(1).join(':')
	else serialNumber = rest.join(':')
	return { vendorId: vid, productId: pid, serialNumber, product }
}

/**
 * Returns the raw node-hid entries that belong to the selected device, de-duplicated by path
 * (one open handle per path).
 * @param {import('node-hid').Device[]} raw
 * @param {{vendorId:number, productId:number, serialNumber?:string, product?:string}} sel
 * @param {{allInterfaces:boolean}} opts  false = keyboard/keypad collections only
 */
function matchInterfaces(raw, sel, opts) {
	const seen = new Set()
	const out = []
	for (const d of raw) {
		if (d.vendorId !== sel.vendorId || d.productId !== sel.productId) continue
		if (sel.serialNumber && d.serialNumber && d.serialNumber !== sel.serialNumber) continue
		if (sel.product && (d.product || '') !== sel.product) continue
		if (!opts.allInterfaces) {
			const isKbd = d.usagePage === 1 && (d.usage === 6 || d.usage === 7)
			const unknown = d.usagePage === undefined || d.usagePage === null || d.usagePage === 0
			if (!isKbd && !unknown) continue
		}
		if (!d.path || seen.has(d.path)) continue
		seen.add(d.path)
		out.push(d)
	}
	return out
}

module.exports = {
	hex4,
	usageLabel,
	interfaceLabel,
	deviceKey,
	deviceName,
	groupDevices,
	parseDeviceKey,
	matchInterfaces,
}
