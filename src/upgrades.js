/**
 * @file Config/action/feedback upgrade scripts.
 *
 * Companion runs these in order when a connection created with an older module version is
 * loaded. Append new scripts at the end and never remove existing ones – Companion stores the
 * index of the last script that ran.
 * @type {import('@companion-module/base').CompanionStaticUpgradeScript<any>[]}
 */
const UpgradeScripts = []

module.exports = { UpgradeScripts }
