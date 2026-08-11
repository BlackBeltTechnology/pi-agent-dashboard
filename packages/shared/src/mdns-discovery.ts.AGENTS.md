# mdns-discovery.ts — index

mDNS `_pi-dashboard._tcp` advertise + discover. `advertiseDashboard(port, piPort)`, `stopAdvertising()`, `discoverDashboard(timeout?)`, `discoverFallback(port)`, `discoverDashboardWithFallback(configPort)`, `createBrowser()` (EventEmitter `server-up`/`server-down`), `pickBestHost(service)` (DNS-safe fallback), `isLocalService(service)`. Exports `DiscoveredServer`, `DashboardBrowser`.
