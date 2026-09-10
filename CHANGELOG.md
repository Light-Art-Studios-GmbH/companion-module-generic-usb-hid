# Changelog

## 1.2.0 – 2026-09-10

Bitfocus template alignment and English localisation.

- Module id is now `generic-usb-hid` (manufacturer _Generic_); connections created as `usb-hid-trigger` keep working via `legacyIds`.
- Layout follows the Bitfocus module template: entrypoint `src/main.mjs`, Bitfocus prettier/eslint presets, `build-config.cjs` for `companion-module-build`.
- All user-facing texts (configuration, actions, feedbacks, presets, variables, status, log, help) are in English.
- Branding: Lucas Hoyer, Light Art Studios GmbH.

## 1.1.0 – 2026-09-10

Hardening and documentation release.

- All event handlers are guarded; an exception in a handler is logged instead of crashing the module process.
- `stopSource()` / `destroy()` are idempotent and no longer leak HID handles when a scan is in flight during a restart.
- Device enumeration for actions/variables runs asynchronously (`devicesAsync`) and is serialised.
- Presets reference variables through the current connection label and are rebuilt when the label changes.
- Repeated enumeration errors are logged once instead of every rescan.
- "Recently pressed" windows are clamped (max 10 minutes); learn requests cannot resolve twice.
- Comprehensive JSDoc comments, README, HELP and this changelog.

## 1.0.2 – 2026-09-10

- Removed the `diagnostics` and `rawinput_latency_ms` variables again (diagnosis line stays in the log).

## 1.0.1 – 2026-09-10

- Windows: keyboard/mouse collections are read through the Raw Input API (`scripts/win-rawinput.ps1`).
- Windows: tolerate macOS `._*` companion files next to native binaries (`src/native-loader.js`).
- Enumeration filtered by vendor/product id (much faster on Windows).
- `scripts/diagnose.js` and a start-up diagnosis log line.
- Manifest declares `native-addons`, `worker-threads` and `child-process` permissions.

## 1.0.0 – 2026-09-10

- Initial release: device selection, hot-plug, key parsing (keyboard, consumer, mouse, generic),
  variables, feedbacks with learn, actions, presets, global keyboard hook fallback.
