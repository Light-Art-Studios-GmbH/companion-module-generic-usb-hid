/**
 * Build configuration for `companion-module-build` (@companion-module/tools).
 *
 * - node-hid ships its binaries via pkg-prebuilds → listed under `prebuilds` so the tool copies
 *   the platform folders into the package.
 * - uiohook-napi uses node-gyp-build and resolves its binary relative to its own package
 *   folder → kept as an external dependency (installed into pkg/ at build time).
 * - The PowerShell Raw Input helper is a plain file that must travel with the bundle.
 */
module.exports = {
	prebuilds: ['node-hid'],
	externals: ['uiohook-napi'],
	extraFiles: ['scripts/win-rawinput.ps1'],
}
