# electron-server-windows.md — index

Paired-server windows. Main-process discovery + knock pairing + fp keyring (`safeStorage`, `0600`); one window per server on its own origin, partition `persist:server-<fp>`, `/api/device-session` cookie. Routes: keyring stores delivered https (max 3, after pin proof). Bridges `listServers`/`pairWithCode`; in-app code redeem (`pairing-code-client.ts`). See change: add-electron-server-windows; group-servers-by-identity.
