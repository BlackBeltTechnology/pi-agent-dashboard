# known-server-stale-name.spec.ts — index

L3: known server with a dead `.local` name reads "Name not found" (not CORS-blocked) in the header selector, via the real operator-only server probe. See change: stabilize-mdns-server-identity.

Also F4/F5 (add-electron-server-windows): with an init-script `piDashboard.openServerWindow` stub the header dropdown asks the app with host+port only, shows inline progress, opens no staging socket and writes no `pi-dashboard-last-server` (toast wording pinned at L1; App toasts are not observable in the harness); without the stub the staging-socket switch still runs. Remote is a Playwright-stubbed health endpoint. See change: add-electron-server-windows.

F10 seeds the twin entry (one identity, two routes) straight into the container's `config.json`: the add API now refuses the server's own address with `409 self_address`. See change: harden-peer-address-identity.
