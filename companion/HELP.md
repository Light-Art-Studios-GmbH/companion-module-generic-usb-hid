## Generic: USB HID Presenter / Clicker

This module watches a **USB HID device** – a PowerPoint/Keynote presenter, a clicker, a keypad or a
keyboard – and exposes every key press as **variables** and **feedbacks**. Use them to fire Companion
**triggers**, colour buttons or start actions. The presenter keeps working for your presentation
software at the same time.

Developed by Lucas Hoyer, Light Art Studios GmbH (lh@lightartstudios.de).

### Setup

1. Plug the device in and add the connection **Generic: USB HID Presenter**.
2. In the configuration pick the device under **USB device**. The list is re-read every time the
   configuration page is opened (close and reopen the page to refresh). Alternatively run the action
   **Refresh device list**; the result is also available in `$(usb-hid:devices_list)`.
   Manual entry is possible as `vid:pid` (hex), e.g. `046d:c52f`.
3. Save. The connection status shows which interfaces were opened.

Presenters usually consist of several HID interfaces (keyboard + consumer/mouse). With
**Watch all HID interfaces** every one of them is opened, so laser/mouse buttons or media keys are
detected as well. Devices without vendor/product id (e.g. built-in Apple devices) are additionally
distinguished by their product name (`0000:0000::Name`).

### Configuration fields

| Field                                       | Default        | Meaning                                                                                                        |
| ------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| Input source                                | USB HID device | `USB HID device` = device specific (recommended). `Global keyboard hook` = all keyboards, no device selection. |
| USB device                                  | –              | Device from the list or typed as `vid:pid` (hex).                                                              |
| Watch all HID interfaces                    | on             | Open every interface of the device (keyboard + consumer + mouse …). Off = keyboard only.                       |
| Open exclusively                            | off            | macOS only: do not pass keys on to other applications.                                                         |
| Windows Raw Input                           | on             | Windows only: read keyboard/mouse interfaces via Raw Input.                                                    |
| Treat reports of unknown interfaces as keys | off            | Reports of unknown interfaces count as key `raw:<hex>`.                                                        |
| Rescan interval                             | 2 s            | How often the device is searched for (hot-plug).                                                               |
| Default window "recently pressed"           | 500 ms         | Default for the feedback of the same name.                                                                     |
| Debug                                       | off            | Log every report and key event.                                                                                |

### Permissions per operating system

- **macOS**: On first connect macOS asks for **Input Monitoring** for Companion (System Settings →
  Privacy & Security → Input Monitoring). Without it the module reports `not permitted` for keyboard
  interfaces. After granting, restart Companion or run the action **Reconnect device**. The option
  **Open exclusively** keeps the keys away from other applications (the system may refuse it).
- **Linux**: Access to `/dev/hidraw*` requires a udev rule, e.g. `/etc/udev/rules.d/70-companion-hid.rules`:

  ```
  KERNEL=="hidraw*", SUBSYSTEM=="hidraw", MODE="0660", TAG+="uaccess"
  ```

  then `sudo udevadm control --reload-rules && sudo udevadm trigger` and re-plug the device.

- **Windows**: Windows never hands keyboard and mouse HID interfaces to applications (`Access denied`).
  The module therefore reads those interfaces through the **Raw Input API**: a small PowerShell helper
  (`win-rawinput.ps1`) is started and reports key presses together with the device id (VID/PID), so the
  selection stays device specific. Requirements: Windows PowerShell 5.1 (standard) and Companion running
  in the user session (not as a service). Consumer/vendor interfaces are still opened directly. The
  **Global keyboard hook** remains available as a fallback. The helper state is shown in
  `$(usb-hid:rawinput_state)`.

### Creating triggers

Example: "next slide" on the presenter should start something.

- **Variant A (recommended)**: Triggers → event _Variable changed_ `$(usb-hid:press_count)` → condition
  feedback **Last key is** = `PageDown` → actions.
- **Variant B**: Triggers → event _On feedback change_ with feedback **Key is held** (`PageDown`) or
  **Key recently pressed**. The feedback becomes true on press and false again on release.

Unknown key layout? Click **Learn** in the feedback and press the key on the device – the name is
taken over. To test without a device use the action **Simulate key**.

### Key names

Presenter keys: `PageDown`, `PageUp`, `F5`, `Escape`, `B`, `.`, `Space`, `Enter`, `Left`, `Right`, `Up`,
`Down`, `Home`, `End`, `Tab`. Modifiers: `LeftCtrl`, `LeftShift`, `LeftAlt`, `LeftGui` (…`Right`…).
Media keys: `VolumeUp`, `VolumeDown`, `Mute`, `PlayPause`, `NextTrack`, `PreviousTrack`. Mouse:
`Mouse1` … `Mouse5`. Names are compared case-insensitively.

Devices with an unknown protocol: reports of vendor/unknown interfaces update `last_report_hex` and the
feedback **Last HID report starts with**. With the option **Treat reports of unknown interfaces as keys**
every such report additionally counts as key `raw:<hex>` (careful: sensor interfaces can fire continuously).

### Variables

| Variable                                                 | Content                                         |
| -------------------------------------------------------- | ----------------------------------------------- |
| `device_connected`                                       | `true`/`false`                                  |
| `device_name`, `device_id`, `device_interfaces`          | device information                              |
| `source_mode`                                            | `hid` or `hook`                                 |
| `last_key`, `last_event`, `last_key_time`, `last_key_ts` | last key and time                               |
| `press_count`                                            | counts every key press – ideal as trigger event |
| `pressed_keys`, `pressed_count`                          | keys currently held                             |
| `last_report_hex`, `last_interface`                      | raw data of the last report                     |
| `devices_count`, `devices_list`                          | result of the device list                       |
| `rawinput_state`                                         | Windows Raw Input helper state                  |

### Actions

Refresh device list · Reconnect device · Select device · Simulate key · Reset state

### Feedbacks

Device connected · Key is held · Key recently pressed · Last key is · Last HID report starts with

### Presets

Status button, last-key display, rescan button and buttons for the usual presenter keys that light up
when pressed on the device and simulate the key when clicked.

### Troubleshooting

- On start the module writes a line `Diagnostics: …` to the Companion log (Log → filter by the connection
  label) with platform, Node version and whether node-hid / uiohook-napi / PowerShell could be loaded.
- Outside Companion, `scripts/diagnose.js` lists all HID interfaces with an open test, tests the keyboard
  hook (5 s) and, on Windows, Raw Input (10 s). On Windows run it with Companion's own Node:

  ```
  "C:\Program Files\Bitfocus Companion\resources\node-runtimes\node22\node.exe" scripts\diagnose.js
  ```

- Installing on Windows from a developer folder: copy the complete module folder **including
  `node_modules`** into Companion's developer modules path (Settings → Developer modules path) and restart
  Companion. Native binaries for Windows/macOS/Linux are already contained.
- Folders copied from a Mac often carry companion files `._<name>` and `.DS_Store`. The module bypasses
  them automatically (note in the diagnostics log line). Clean up in a command prompt inside the module folder:

  ```
  del /s /q /a ._*
  del /s /q /a .DS_Store
  ```
