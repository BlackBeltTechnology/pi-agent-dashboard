# server-windows-main.ts — index

`startServerWindows(opts)`: Electron binding for server windows. Builds keyring (`safeStorage`), discovery, window ports (`BrowserWindow`, `session`, `dialog`, `powerMonitor`), bounds store (`server-windows-state.json`), `servers:*` IPC, Servers menu hooks. Local fp proved lazily w/ retry (local mode only). Warns when CDP active + paired servers exist. `dispose()` at quit. See change: add-electron-server-windows.

## harden-peer-address-identity

Wires `lookup` (`dns.promises.lookup({all:true})`), `interfaces` (`os.networkInterfaces`) and `hasLocalServer` (remote mode ⇒ `localFp()` is `"none"`). See change: harden-peer-address-identity.

## device-key-mutual-check

`prove` = `proveWithDeviceNonce`; `onDeviceChange: changed` (device view is memory only ⇒ list + menu refresh); menu entries carry `note: deviceNote(serverWindows.deviceView(fp))`; `askNeedsPairing(label, reason)` wording per `REPAIR_TEXT` (refused | access-removed | access-expired | network-not-allowed). See change: device-key-mutual-check.
