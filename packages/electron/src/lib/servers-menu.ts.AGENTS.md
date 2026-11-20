# servers-menu.ts — index

Servers submenu for app + tray menus: `buildServersSubmenu`, `serversMenuItem`, `setServersMenuHooks`, `notifyServersMenuChanged`/`onServersMenuChanged` (rebuild on keyring change). Label sanitised; `— needs pairing` suffix; `Connect to another dashboard…`. See change: add-electron-server-windows.

## device-key-mutual-check

`ServersMenuEntry.note?` replaces the suffix: `— <note>` (e.g. `access removed`, `network not allowed`, `access expired`); with `needsPairing` the default stays `needs pairing`. See change: device-key-mutual-check.
