# companion-module-generic-usb-hid

Bitfocus Companion connection module that watches a **USB HID device** – a PowerPoint/Keynote
presenter / clicker, a keypad or a keyboard – and exposes every key press as Companion
**variables** and **feedbacks**, so that keys can drive **triggers**, buttons and actions.

- Device specific: pick one device by vendor/product id (and serial); other keyboards are ignored.
- Hot-plug: the device may be unplugged and reconnected at any time.
- Cross-platform: Windows, macOS and Linux (native binaries for all three are bundled).
- No exclusive access by default: the presenter keeps working for PowerPoint/Keynote at the same time.

Developed and maintained by **Lucas Hoyer, Light Art Studios GmbH** (<lh@lightartstudios.de>).
Licensed under MIT.

User documentation lives in [companion/HELP.md](companion/HELP.md) and is shown inside Companion via
the connection's help button.

---

## Contents

1. [Requirements](#requirements)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Actions, feedbacks, variables, presets](#actions-feedbacks-variables-presets)
5. [Using keys as triggers](#using-keys-as-triggers)
6. [Platform notes](#platform-notes)
7. [Architecture](#architecture)
8. [Development](#development)
9. [Troubleshooting](#troubleshooting)

---

## Requirements

|           |                                                                                              |
| --------- | -------------------------------------------------------------------------------------------- |
| Companion | 5.0 or newer (module API `@companion-module/base` 2.x, Node 22 runtime)                      |
| Windows   | Windows 10/11, Windows PowerShell 5.1 (pre-installed), Companion running in the user session |
| macOS     | 13+; _Input Monitoring_ permission for Companion                                             |
| Linux     | udev rule granting access to `/dev/hidraw*` (see below)                                      |

Runtime dependencies: [`node-hid`](https://github.com/node-hid/node-hid) (HID access) and optionally
[`uiohook-napi`](https://github.com/SnosMe/uiohook-napi) (global keyboard hook fallback).

## Installation

### From a package (recommended)

`yarn package` (see [Development](#development)) produces `generic-usb-hid-<version>.tgz`.
Import it in Companion under **Modules → Import module package**.

### From the developer modules path

1. Copy the whole module folder **including `node_modules`** into Companion's developer modules
   path (Settings → Developer), e.g. `…/Companion Developer Modules/companion-module-generic-usb-hid/`.
2. Restart Companion (or wait – it watches the folder).
3. Add a connection: search for **USB HID** / **Presenter** (manufacturer _Generic_).

`node_modules` already contains prebuilt binaries for Windows, macOS and Linux (x64/arm64), so the
same folder can be copied to any machine without running `npm install`.

> Copying from a Mac leaves `._*` and `.DS_Store` companion files behind on other file systems.
> The module tolerates them (`src/native-loader.js`); remove them on Windows with
> `del /s /q /a ._*` inside the module folder.

Connections created with the previous module id `usb-hid-trigger` keep working (`legacyIds`).

## Configuration

| Field                                      | Default | Meaning                                                                                                       |
| ------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------- |
| Input source (`mode`)                      | `hid`   | `hid` = selected USB device (recommended). `hook` = global keyboard hook, all keyboards, not device specific. |
| USB device (`device`)                      | none    | Device key `vvvv:pppp[:serial]` chosen from the list (re-read every time the page opens) or typed manually.   |
| Watch all HID interfaces (`allInterfaces`) | on      | Open every collection of the device (keyboard + consumer + mouse …). Off = keyboard collection only.          |
| Open exclusively (`exclusive`)             | off     | macOS only: seize the device so its keys do not reach other applications.                                     |
| Windows Raw Input (`winRawInput`)          | on      | Windows only: read keyboard/mouse collections through the Raw Input API (see platform notes).                 |
| Treat reports as keys (`rawKeys`)          | off     | Reports of unknown/vendor collections count as pseudo keys `raw:<hex>`.                                       |
| Rescan interval (`pollInterval`)           | 2 s     | Hot-plug detection interval.                                                                                  |
| Window "recently pressed" (`recentWindow`) | 500 ms  | Default window of the _recently pressed_ feedback.                                                            |
| Debug (`debug`)                            | off     | Log every report and key event.                                                                               |

## Actions, feedbacks, variables, presets

**Actions**

| Action              | Purpose                                                                          |
| ------------------- | -------------------------------------------------------------------------------- |
| Refresh device list | Re-enumerate HID devices; updates `devices_*` variables and the device dropdown. |
| Reconnect device    | Close and reopen the device.                                                     |
| Select device       | Switch the watched device from a button (saved to the config).                   |
| Simulate key        | Fire a virtual press/release – test triggers without hardware.                   |
| Reset state         | Clear last key, held keys and counters.                                          |

**Feedbacks** (all boolean; every key feedback supports _Learn_: click Learn, press the key on the device)

| Feedback                    | True when …                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| Device connected            | the device is open (or served by Raw Input).                                                 |
| Key is held                 | the key is currently held.                                                                   |
| Key recently pressed        | the key was pressed within the window (option or config default). Turns false automatically. |
| Last key is                 | the most recent key equals the option.                                                       |
| Last HID report starts with | the last raw report starts with the given hex prefix.                                        |

**Variables**

| Variable                                                            | Content                                                          |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `device_connected`, `device_name`, `device_id`, `device_interfaces` | device state                                                     |
| `source_mode`                                                       | `hid` or `hook`                                                  |
| `last_key`, `last_event`, `last_key_time`, `last_key_ts`            | most recent key and time                                         |
| `press_count`                                                       | counts every press – the ideal _variable changed_ trigger source |
| `pressed_keys`, `pressed_count`                                     | keys currently held                                              |
| `last_interface`, `last_report_hex`                                 | raw data of the last report                                      |
| `devices_count`, `devices_list`                                     | enumeration result                                               |
| `rawinput_state`                                                    | Windows Raw Input helper state                                   |

**Presets**: status button, "last key" display, rescan button and one button per common presenter
key (`PageDown`, `PageUp`, `F5`, `Escape`, `B`, `.`, `Space`, `Enter`, `Left`, `Right`) that lights up
when the key is pressed on the device and simulates the key when clicked.

### Key names

Canonical names are shared by all input sources: letters `A`–`Z`, digits, `F1`–`F24`, `PageUp`,
`PageDown`, `Home`, `End`, `Insert`, `Delete`, `Escape`, `Enter`, `Space`, `Tab`, `Backspace`,
arrows `Left`/`Right`/`Up`/`Down`, punctuation (`.`, `,`, `-`, `=` …), `Numpad0`–`Numpad9`,
modifiers `LeftCtrl`/`LeftShift`/`LeftAlt`/`LeftGui` (and `Right…`), media keys (`VolumeUp`,
`VolumeDown`, `Mute`, `PlayPause`, `NextTrack`, `PreviousTrack`), mouse buttons `Mouse1`–`Mouse5`
and `raw:<hex>` for unknown reports. Comparisons are case-insensitive.

## Using keys as triggers

_Variant A – variable changed (recommended)_

1. Triggers → new trigger → event **Variable changed**: `$(usb-hid:press_count)`.
2. Condition: feedback **Last key is** = `PageDown`.
3. Actions: whatever should happen.

_Variant B – feedback becomes true_

Event **On feedback change** with **Key is held** or **Key recently pressed**. The feedback turns true
on press and false on release / after the window.

## Platform notes

### Windows

Windows never hands keyboard and mouse HID collections to applications (`Access denied`), which is
exactly how most presenters present themselves. The module therefore runs a small helper,
[`scripts/win-rawinput.ps1`](scripts/win-rawinput.ps1) (PowerShell + inline C#), that registers for
**Raw Input** with `RIDEV_INPUTSINK`. Raw Input reports every key together with the originating
device path (`\\?\HID#VID_046D&PID_C538…`), so the selection stays device specific and no exclusive
access is needed. The helper prints JSON lines to stdout, `src/win-rawinput.js` parses them,
filters by vendor/product id and maps Windows virtual-key codes to the canonical names. Consumer
and vendor collections are still read directly through node-hid.

The helper exits on its own when the module process disappears and is restarted with back-off
if it crashes. Its state is visible in `$(usb-hid:rawinput_state)`.

### macOS

Opening keyboard collections requires **Input Monitoring** for Companion (System Settings →
Privacy & Security). Until granted, the log shows `(iokit/common) not permitted` for the keyboard
interface while vendor/consumer collections already work. Restart Companion after granting.

### Linux

Access to `/dev/hidraw*` needs a udev rule, e.g. `/etc/udev/rules.d/70-companion-hid.rules`:

```
KERNEL=="hidraw*", SUBSYSTEM=="hidraw", MODE="0660", TAG+="uaccess"
```

then `sudo udevadm control --reload-rules && sudo udevadm trigger` and re-plug the device.
The global keyboard hook needs an X11 session.

## Architecture

The layout follows the Bitfocus module template (`companion-module-template-js`):

```
companion/manifest.json     module metadata, runtime permissions, legacy ids
companion/HELP.md           user documentation shown in Companion
src/main.mjs                 entrypoint (default export = instance class, UpgradeScripts)
src/instance.js             UsbHidInstance – config, state, variables, feedbacks, status
src/config.js               configuration fields (enumerates devices on every page open)
src/actions.js  feedbacks.js  presets.js  variables.js  upgrades.js
src/hid-devices.js          enumeration, grouping into physical devices, device keys, matching
src/hid-watcher.js          input source: node-hid, hot-plug, report → key events
src/report-parser.js        heuristic report parsing (keyboard, consumer, mouse, generic)
src/keycodes.js             canonical key names, HID usage tables
src/win-rawinput.js         input source (Windows): spawns scripts/win-rawinput.ps1
src/vkeys.js                Windows virtual-key → name, device path → VID/PID
src/keyboard-hook.js        input source: uiohook-napi global hook
src/native-loader.js        guards native loading against macOS "._" companion files
src/diagnostics.js          start-up diagnostics line
scripts/win-rawinput.ps1    Raw Input helper (PowerShell / C#)
scripts/diagnose.js         standalone diagnosis (any OS)
scripts/list-devices.js     prints the device list as seen by the config dropdown
test/parser.test.js         unit tests (parser, grouping, Windows helpers, presets, loader guard)
build-config.cjs            packaging configuration for companion-module-build
eslint.config.mjs           Bitfocus eslint preset
```

Event flow: _source_ (`HidWatcher` / `WinRawInput` / `KeyboardHook`) → `'key'` / `'report'` /
`'status'` events → `UsbHidInstance.handleKeyEvent/handleReport/handleStatus` → variables,
`checkFeedbacks()`, `updateStatus()`.

Design rules:

- Every handler is wrapped (`guard()`); an exception can never take the module process down.
- Status messages are de-duplicated so the log stays quiet while a device is missing.
- Key state is released whenever a source stops or a device vanishes – feedbacks cannot get stuck.
- `stopSource()` is idempotent; `destroy()` blocks late events from sources still shutting down.

## Development

```bash
yarn install         # dependencies incl. Bitfocus tooling (yarn 4 via corepack, as in the Bitfocus template)
yarn format       # prettier, Bitfocus style (tabs, no semicolons, single quotes)
yarn lint         # eslint with the Bitfocus preset
yarn test            # unit tests
yarn check        # syntax check of all sources
yarn list-devices # what the config dropdown will show
yarn package      # companion-module-build → generic-usb-hid-<version>.tgz
yarn deploy       # rsync into Companion's developer modules path (macOS dev machine)
```

`yarn package` needs `yarn` on the PATH (the Bitfocus tool installs the external
`uiohook-napi` dependency with it): `corepack enable` provides it with Node 22.

Companion 5 specifics worth knowing (they differ from the 1.x module template):

- `src/main.mjs` must default-export the instance class and export `UpgradeScripts`; there is no
  `runEntrypoint` any more.
- `setVariableDefinitions()` takes an object keyed by variable id; feedbacks have no `subscribe`.
- Native addons, worker threads and child processes require the corresponding
  `runtime.permissions` in `companion/manifest.json` (Companion runs modules under Node's
  permission model).
- The developer modules path does not follow symlinks – copy the folder.

Version numbers live in `package.json` and `companion/manifest.json`; see [CHANGELOG.md](CHANGELOG.md).

## Troubleshooting

| Symptom                                                     | Cause / fix                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Connection status "No USB device selected"                  | Open the config page and pick a device.                                                                      |
| "Device … not found"                                        | Device unplugged or wrong id; open the config page to re-enumerate.                                          |
| macOS "not permitted" for Keyboard/Mouse                    | Grant Input Monitoring, restart Companion.                                                                   |
| Windows: keys not arriving, `rawinput_state` shows an error | PowerShell blocked (policy) or Companion runs as a service; run `scripts/diagnose.js` with Companion's node. |
| Windows: `is not a valid Win32 application`                 | Old version; from 1.0.1 on `._` files are ignored. Delete them: `del /s /q /a ._*`.                          |
| `press_count` races up without key presses                  | A vendor/sensor collection sends continuous reports and `rawKeys` is on – turn it off.                       |
| Hook mode shows no keys                                     | macOS: Accessibility permission for Companion; Linux: needs X11.                                             |

`scripts/diagnose.js` prints everything at once (platform, native modules, every interface with an
open test, 5 s hook capture, 10 s Raw Input capture on Windows):

```bash
node scripts/diagnose.js
```

On Windows use Companion's bundled Node:
`"C:\Program Files\Bitfocus Companion\resources\node-runtimes\node22\node.exe" scripts\diagnose.js`.

## License

MIT © 2026 Lucas Hoyer, Light Art Studios GmbH – see [LICENSE](LICENSE).
