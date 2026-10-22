# servers-ipc.ts — index

`servers:*` IPC (own family). `registerServersIpc(deps)`; `isServerWindowsSender` accepts only TOP frame of remote-connect/connecting (bundled file) or main window on LOCAL origin; subframes + remote-mode origin refused. Payload validation (`validHostPort`, fp regex); host+port must match known server; manual URL from remote-connect only. `servers:changed` pushed to trusted windows only. See change: add-electron-server-windows (D9).

## group-servers-by-identity

Channels `servers:pair-with-code` (main only), `servers:submit-code` (connecting window only). See change: group-servers-by-identity.
