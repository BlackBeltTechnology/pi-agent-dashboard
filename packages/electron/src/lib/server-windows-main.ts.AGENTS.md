# server-windows-main.ts — index

`startServerWindows(opts)`: Electron binding for server windows. Builds keyring (`safeStorage`), discovery, window ports (`BrowserWindow`, `session`, `dialog`, `powerMonitor`), bounds store (`server-windows-state.json`), `servers:*` IPC, Servers menu hooks. Local fp proved lazily w/ retry (local mode only). Warns when CDP active + paired servers exist. `dispose()` at quit. See change: add-electron-server-windows.
