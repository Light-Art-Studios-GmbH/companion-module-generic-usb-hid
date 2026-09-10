// Prints all HID devices grouped like the module's config dropdown. Run: npm run list-devices
const { groupDevices } = require('../src/hid-devices.js')
for (const d of groupDevices()) {
	console.log(`${d.key.padEnd(24)} ${d.label}`)
	for (const i of d.interfaces)
		console.log(`    usagePage=${i.usagePage} usage=${i.usage} if=${i.interface} path=${i.path}`)
}
