/**
 * Standalone diagnosis, runs outside Companion. Prints platform info, native module status,
 * all HID interfaces with an open-test, and (Windows) a 10 s Raw Input capture.
 *
 *   Windows (Companion's bundled node):
 *     "C:\Program Files\Bitfocus Companion\resources\node-runtimes\node22\node.exe" scripts\diagnose.js
 *   macOS / Linux:  node scripts/diagnose.js
 */
const { runDiagnostics } = require('../src/diagnostics.js')
const { groupDevices, interfaceLabel } = require('../src/hid-devices.js')

async function main() {
	console.log('== Diagnostics ==')
	console.log(runDiagnostics())
	console.log('\n== HID devices ==')
	const HID = require('node-hid')
	for (const d of groupDevices()) {
		console.log(`${d.key}  ${d.label}`)
		for (const i of d.interfaces) {
			let result
			try {
				const h = await HID.HIDAsync.open(i.path, { nonExclusive: true })
				await h.close()
				result = 'open OK'
			} catch (e) {
				result = `open ERROR: ${e.message || e}`
			}
			console.log(`    ${interfaceLabel(i).padEnd(18)} ${result}`)
		}
	}

	console.log('\n== Keyboard hook (uiohook-napi), 5 s – press some keys ==')
	try {
		const { KeyboardHook } = require('../src/keyboard-hook.js')
		const hook = new KeyboardHook({ log: (l, m) => console.log(`  [${l}] ${m}`) })
		hook.on('key', (ev) => console.log(`  ${ev.type} ${ev.key}`))
		hook.on('status', (s) => console.log(`  status: ${s.message}`))
		hook.start()
		await new Promise((r) => setTimeout(r, 5000))
		await hook.stop()
	} catch (e) {
		console.log(`  ERROR: ${e.message || e}`)
	}

	if (process.platform === 'win32') {
		console.log('\n== Windows Raw Input, 10 s – press keys on the presenter ==')
		const { WinRawInput } = require('../src/win-rawinput.js')
		const ri = new WinRawInput({ selection: null, log: (l, m) => console.log(`  [${l}] ${m}`) })
		ri.on('key', (ev) => console.log(`  ${ev.type} ${ev.key}  (${ev.raw})`))
		ri.on('status', (s) => console.log(`  status: ${s.message}`))
		ri.start()
		await new Promise((r) => setTimeout(r, 10000))
		await ri.stop()
	}
	console.log('\ndone')
	// the hook/helper may keep the event loop alive – end the diagnosis explicitly
	// eslint-disable-next-line n/no-process-exit
	process.exit(0)
}

main().catch((e) => {
	console.error(e)
	// eslint-disable-next-line n/no-process-exit
	process.exit(1)
})
