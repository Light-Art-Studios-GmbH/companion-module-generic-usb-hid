/**
 * Guards native-addon loading against macOS "AppleDouble" junk files.
 *
 * When a module folder is copied from a Mac to Windows (USB stick, SMB, zip)
 * every file may get a sibling `._<name>` containing Finder metadata.
 * node-gyp-build (used by uiohook-napi) lists `prebuilds/<platform>-<arch>/*.node`
 * and picks the first match — `._uiohook-napi.node` sorts before the real
 * binary and fails with "is not a valid Win32 application".
 *
 * installNodeGypBuildGuard() wraps node-gyp-build so such a pick is redirected
 * to the real file. findAppleDoubleFiles() reports leftovers for diagnostics.
 */
const fs = require('node:fs')
const path = require('node:path')

let installed = false

function fixPath(p) {
	const base = path.basename(p)
	if (!base.startsWith('._')) return p
	const real = path.join(path.dirname(p), base.slice(2))
	try {
		if (fs.existsSync(real)) return real
	} catch {
		// ignore
	}
	return p
}

function installNodeGypBuildGuard() {
	if (installed) return true
	let resolved
	try {
		// transitive dependency of uiohook-napi; only touched when it is actually installed
		// eslint-disable-next-line n/no-extraneous-require
		resolved = require.resolve('node-gyp-build')
	} catch {
		return false // dependency not present; nothing to guard
	}
	const original = require(resolved)
	if (typeof original !== 'function' || typeof original.resolve !== 'function') return false
	const safe = function (dir) {
		return require(safe.resolve(dir))
	}
	safe.resolve = safe.path = (dir) => fixPath(original.resolve(dir))
	require.cache[resolved].exports = safe
	installed = true
	return true
}

/** Lists `._*` files below the given directories (limited depth, cheap). */
function findAppleDoubleFiles(dirs, maxDepth = 4) {
	const out = []
	const walk = (dir, depth) => {
		if (depth > maxDepth || out.length > 50) return
		let entries
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true })
		} catch {
			return
		}
		for (const e of entries) {
			const p = path.join(dir, e.name)
			if (e.name.startsWith('._')) out.push(p)
			else if (e.isDirectory()) walk(p, depth + 1)
		}
	}
	for (const d of dirs) walk(d, 0)
	return out
}

module.exports = { installNodeGypBuildGuard, findAppleDoubleFiles, fixPath }
