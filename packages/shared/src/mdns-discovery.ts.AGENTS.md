# mdns-discovery.ts — index

mDNS `_pi-dashboard._tcp` advertise + discover. `advertiseDashboard(port, piPort)`, `stopAdvertising()`, `discoverDashboard(timeout?)`, `discoverFallback(port)`, `discoverDashboardWithFallback(configPort)`, `createBrowser()` (EventEmitter `server-up`/`server-down`), `pickBestHost(service)` (DNS-safe fallback), `isLocalService(service)`. Exports `DiscoveredServer`, `DashboardBrowser`.

Honest advertisement (fix-bridge-mdns-migration-hijack D4): `advertiseDashboard(port, piPort, {bindHost?, publish?})` consults `shouldAdvertise(bindHost)` — loopback bind (`127.x`/`::1`/`localhost`) publishes NOTHING (logged); unset/`0.0.0.0`/`::`/LAN binds keep advertising; `publish` is a test seam. The server passes `{bindHost: config.host}` at advertise time. Pinned by `src/__tests__/mdns-advertise.test.ts`.
