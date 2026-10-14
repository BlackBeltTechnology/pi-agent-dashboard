# known-server-stale-name.spec.ts — index

L3: known server with a dead `.local` name reads "Name not found" (not CORS-blocked) in the header selector, via the real operator-only server probe. See change: stabilize-mdns-server-identity.

Also F4/F5 (add-electron-server-windows): with an init-script `piDashboard.openServerWindow` stub the header dropdown shows inline progress then a failure toast (reason + label) and writes no `pi-dashboard-last-server`; without the stub the staging-socket switch still runs. Remote is a Playwright-stubbed health endpoint. See change: add-electron-server-windows.
