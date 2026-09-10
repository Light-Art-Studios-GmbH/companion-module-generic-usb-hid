/**
 * Syntax-checks every source file with `node --check` (cross-platform replacement for a shell loop).
 * Usage: yarn check
 */
const { execFileSync } = require('node:child_process')
const { readdirSync } = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const files = ['src/main.mjs']
for (const dir of ['src', 'scripts', 'test']) {
	for (const f of readdirSync(path.join(root, dir))) if (f.endsWith('.js')) files.push(`${dir}/${f}`)
}
for (const f of files) execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'inherit' })
console.log(`syntax OK (${files.length} files)`)
