/**
 * @file Module entrypoint.
 *
 * Companion (module API 2.x) imports this file and expects
 *   • the connection class as default export and
 *   • an `UpgradeScripts` named export.
 * The entry is an ES module so that both the developer-folder load (plain `import()`) and the
 * esbuild bundle produced by `companion-module-build` (ESM output) expose the named export.
 * The implementation itself is CommonJS; Node and esbuild both resolve its named exports.
 */
import { UsbHidInstance } from './instance.js'
import { UpgradeScripts } from './upgrades.js'

export default UsbHidInstance
export { UpgradeScripts }
