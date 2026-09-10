const assert = require('node:assert/strict')
const { parseReport } = require('../src/report-parser.js')
const { groupDevices, parseDeviceKey, matchInterfaces } = require('../src/hid-devices.js')

const kbd = { usagePage: 1, usage: 6 }
const consumer = { usagePage: 12, usage: 1 }
const mouse = { usagePage: 1, usage: 2 }

// boot keyboard: PageDown pressed
let r = parseReport(Buffer.from([0, 0, 0x4e, 0, 0, 0, 0, 0]), kbd)
assert.deepEqual([...r.keys], ['PageDown'])
assert.equal(r.kind, 'keyboard')
// with report id prefix and shift modifier + F5
r = parseReport(Buffer.from([1, 0x02, 0, 0x3e, 0, 0, 0, 0, 0]), kbd)
assert.deepEqual([...r.keys].sort(), ['F5', 'LeftShift'])
// release
r = parseReport(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]), kbd)
assert.equal(r.keys.size, 0)
// rollover
r = parseReport(Buffer.from([0, 0, 1, 1, 1, 1, 1, 1]), kbd)
assert.equal(r.rollover, true)
// unknown usage page, 8 bytes → keyboard guess
r = parseReport(Buffer.from([0, 0, 0x4b, 0, 0, 0, 0, 0]), { usagePage: undefined })
assert.deepEqual([...r.keys], ['PageUp'])
// consumer: volume up (u16le) with report id
r = parseReport(Buffer.from([2, 0xe9, 0x00]), consumer)
assert.deepEqual([...r.keys], ['VolumeUp'])
r = parseReport(Buffer.from([0xcd, 0x00]), consumer)
assert.deepEqual([...r.keys], ['PlayPause'])
r = parseReport(Buffer.from([0x00, 0x00]), consumer)
assert.equal(r.keys.size, 0)
// mouse buttons
r = parseReport(Buffer.from([0x01, 0, 0]), mouse)
assert.deepEqual([...r.keys], ['Mouse1'])
r = parseReport(Buffer.from([1, 0x02, 0, 0, 0]), mouse)
assert.deepEqual([...r.keys], ['Mouse2'])
// generic
r = parseReport(Buffer.from([0x05, 0x01]), { usagePage: 0xff00, usage: 1 })
assert.deepEqual([...r.keys], ['raw:0501'])
r = parseReport(Buffer.from([0, 0]), { usagePage: 0xff00, usage: 1 })
assert.equal(r.keys.size, 0)

// device grouping
const raw = [
	{
		vendorId: 0x46d,
		productId: 0xc52f,
		serialNumber: '',
		manufacturer: 'Logitech',
		product: 'USB Receiver',
		usagePage: 1,
		usage: 6,
		interface: 0,
		path: 'p0',
	},
	{
		vendorId: 0x46d,
		productId: 0xc52f,
		serialNumber: '',
		manufacturer: 'Logitech',
		product: 'USB Receiver',
		usagePage: 12,
		usage: 1,
		interface: 1,
		path: 'p1',
	},
	{
		vendorId: 0x46d,
		productId: 0xc52f,
		serialNumber: '',
		manufacturer: 'Logitech',
		product: 'USB Receiver',
		usagePage: 1,
		usage: 2,
		interface: 1,
		path: 'p1',
	},
	{
		vendorId: 0,
		productId: 0,
		serialNumber: '',
		manufacturer: 'Apple',
		product: 'Internal',
		usagePage: 1,
		usage: 6,
		interface: -1,
		path: 'a',
	},
]
const groups = groupDevices(raw)
assert.equal(groups.length, 2)
assert.equal(groups[0].key, '046d:c52f')
assert.equal(groups[0].interfaces.length, 3)
assert.match(groups[0].label, /Logitech USB Receiver \(046d:c52f\) \[Keyboard, Consumer, Mouse\]/)
assert.equal(groups[1].internal, true)
assert.equal(groups[1].key, '0000:0000::Internal')
assert.deepEqual(parseDeviceKey('0000:0000::Internal'), {
	vendorId: 0,
	productId: 0,
	serialNumber: '',
	product: 'Internal',
})
assert.equal(matchInterfaces(raw, parseDeviceKey('0000:0000::Internal'), { allInterfaces: true }).length, 1)
assert.equal(matchInterfaces(raw, parseDeviceKey('0000:0000::Other'), { allInterfaces: true }).length, 0)
assert.match(
	groupDevices([
		{ vendorId: 1, productId: 2, manufacturer: 'Apple', product: 'Apple Keyboard', usagePage: 1, usage: 6, path: 'x' },
	])[0].label,
	/^Apple Keyboard \(0001:0002\)/,
)

const sel = parseDeviceKey('046d:c52f')
assert.deepEqual(sel, { vendorId: 0x46d, productId: 0xc52f, serialNumber: '', product: '' })
assert.deepEqual(parseDeviceKey('0x046D:0xC52F:ABC'), {
	vendorId: 0x46d,
	productId: 0xc52f,
	serialNumber: 'ABC',
	product: '',
})
assert.equal(parseDeviceKey('__none__'), null)
assert.equal(matchInterfaces(raw, sel, { allInterfaces: true }).length, 2) // p0, p1 (dedup by path)
assert.equal(matchInterfaces(raw, sel, { allInterfaces: false }).length, 1)

console.log('parser + device tests OK')

// Windows helpers
const { vkToName, mouseFlagsToEvents, parseWinDeviceName } = require('../src/vkeys.js')
assert.equal(vkToName(0x22, 0x51, true), 'PageDown')
assert.equal(vkToName(0x21, 0x49, true), 'PageUp')
assert.equal(vkToName(0x74, 0x3f, false), 'F5')
assert.equal(vkToName(0x1b, 1, false), 'Escape')
assert.equal(vkToName(0x42, 0x30, false), 'B')
assert.equal(vkToName(0xbe, 0x34, false), '.')
assert.equal(vkToName(0x10, 0x36, false), 'RightShift')
assert.equal(vkToName(0x11, 0x1d, true), 'RightCtrl')
assert.equal(vkToName(0x0d, 0x1c, true), 'NumpadEnter')
assert.deepEqual(mouseFlagsToEvents(0x0001 | 0x0008), [
	{ button: 1, down: true },
	{ button: 2, down: false },
])
assert.deepEqual(
	parseWinDeviceName('\\\\?\\HID#VID_046D&PID_C538&MI_00#7&abc#{884b96c3-56ef-11d1-bc8c-00a0c91405dd}'),
	{ vendorId: 0x46d, productId: 0xc538 },
)
assert.equal(parseWinDeviceName('\\\\?\\ACPI#PNP0303#4&1e6f0f0&0#{...}'), null)

// node side of the raw input protocol (no PowerShell needed)
const { WinRawInput } = require('../src/win-rawinput.js')
const ri = new WinRawInput({ selection: { vendorId: 0x46d, productId: 0xc538 }, log: () => {} })
ri.stopped = false
const got = []
ri.on('key', (e) => got.push(`${e.type}:${e.key}`))
const dev = '\\\\?\\HID#VID_046D&PID_C538&MI_00#7&abc#{x}'
ri.onLine(JSON.stringify({ t: 'key', dev, vk: 0x22, sc: 0x51, e0: true, down: true }))
ri.onLine(JSON.stringify({ t: 'key', dev, vk: 0x22, sc: 0x51, e0: true, down: true })) // auto repeat
ri.onLine(JSON.stringify({ t: 'key', dev, vk: 0x22, sc: 0x51, e0: true, down: false }))
ri.onLine(JSON.stringify({ t: 'key', dev: '\\\\?\\HID#VID_1234&PID_0001#x', vk: 0x22, sc: 0x51, e0: true, down: true })) // other device
ri.onLine(JSON.stringify({ t: 'mouse', dev, flags: 1 }))
ri.onLine(JSON.stringify({ t: 'hid', dev, size: 2, count: 1, data: 'e900', up: 12, u: 1, vid: 0x46d, pid: 0xc538 }))
ri.onLine(JSON.stringify({ t: 'hid', dev, size: 2, count: 1, data: '0000', up: 12, u: 1, vid: 0x46d, pid: 0xc538 }))
ri.onLine('not json')
assert.deepEqual(got, ['press:PageDown', 'release:PageDown', 'press:Mouse1', 'press:VolumeUp', 'release:VolumeUp'])
console.log('windows helper tests OK')

// AppleDouble guard for node-gyp-build
const os = require('node:os')
const fsx = require('node:fs')
const pathx = require('node:path')
const { installNodeGypBuildGuard, findAppleDoubleFiles, fixPath } = require('../src/native-loader.js')
const tmp = fsx.mkdtempSync(pathx.join(os.tmpdir(), 'ngb-'))
const pb = pathx.join(tmp, 'prebuilds', `${process.platform}-${process.arch}`)
fsx.mkdirSync(pb, { recursive: true })
fsx.writeFileSync(pathx.join(pb, '._fake.node'), 'junk')
fsx.writeFileSync(pathx.join(pb, 'fake.node'), 'real')
assert.equal(installNodeGypBuildGuard(), true)
// eslint-disable-next-line n/no-extraneous-require -- transitive dependency of uiohook-napi
const ngb = require('node-gyp-build')
assert.equal(pathx.basename(ngb.resolve(tmp)), 'fake.node')
assert.equal(pathx.basename(ngb.path(tmp)), 'fake.node')
assert.equal(pathx.basename(fixPath(pathx.join(pb, '._fake.node'))), 'fake.node')
assert.equal(findAppleDoubleFiles([tmp]).length, 1)
fsx.rmSync(tmp, { recursive: true, force: true })
// uiohook-napi itself still loads through the guarded resolver
assert.equal(typeof require('uiohook-napi').uIOhook.start, 'function')
console.log('native loader tests OK')

// presets embed the connection label
const { getPresetDefinitions } = require('../src/presets.js')
const pd = getPresetDefinitions('clicker')
assert.match(pd.presets.status.style.text, /\$\(clicker:device_name\)/)
assert.ok(pd.structure.every((s) => s.definitions.every((id) => pd.presets[id])))
// device key validation
assert.equal(parseDeviceKey('zz:zz'), null)
assert.equal(parseDeviceKey('12345:0001'), null)
console.log('preset/device-key tests OK')
