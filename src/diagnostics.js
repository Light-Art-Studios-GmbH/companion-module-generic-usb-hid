/**
 * @file Start-up diagnostics: one line with platform, Node version and whether the native
 * dependencies load. Written to the Companion log on init and used by scripts/diagnose.js.
 */
function tryLoad(name, probe) {
	try {
		const mod = require(name)
		return probe ? probe(mod) : 'ok'
	} catch (e) {
		return `ERROR: ${(e && e.message) || e}`.replace(/\s+/g, ' ').slice(0, 200)
	}
}

const path = require('node:path')
const { installNodeGypBuildGuard, findAppleDoubleFiles } = require('./native-loader.js')

function runDiagnostics() {
	installNodeGypBuildGuard()
	const parts = [`${process.platform}-${process.arch}`, `node ${process.version}`]
	parts.push(
		'node-hid ' +
			tryLoad('node-hid', (HID) => {
				const n = HID.devices().length
				return `ok (${n} Interfaces, hidapi ${typeof HID.getHidapiVersion === 'function' ? HID.getHidapiVersion() : '?'})`
			}),
	)
	parts.push('uiohook-napi ' + tryLoad('uiohook-napi', (u) => (u && u.uIOhook ? 'ok' : 'loaded but incomplete')))
	if (process.platform === 'win32') {
		const { WinRawInput } = require('./win-rawinput.js')
		let ps
		try {
			ps = require('node:fs').existsSync(WinRawInput.powershellPath())
				? 'ok'
				: 'not found: ' + WinRawInput.powershellPath()
		} catch (e) {
			ps = `not checkable (${e.code || e.message})`
		}
		parts.push(`powershell ${ps}`)
	}
	const junk = findAppleDoubleFiles([path.join(__dirname, '..', 'node_modules')], 4)
	if (junk.length) {
		parts.push(
			`${junk.length} macOS companion file(s) "._*" found (e.g. ${path.basename(junk[0])}) – bypassed; clean up in the module folder with: del /s /q /a ._*`,
		)
	}
	return parts.join(' | ')
}

module.exports = { runDiagnostics }
