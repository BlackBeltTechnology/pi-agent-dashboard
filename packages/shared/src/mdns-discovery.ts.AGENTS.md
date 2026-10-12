# mdns-discovery.ts — index

mDNS `_pi-dashboard._tcp` advertise + discover.
- `deriveAdvertisedNames(fingerprint, port)` → `pi-dashboard-<id12>-<port>[.local]`; id12 = first 12 hex of sha256(fingerprint). Never `os.hostname()` → OS responder host record not contested.
- `advertiseDashboard(port, piPort, {bindHost, addresses?, fingerprint, version, name, publish?, resolveAddresses?, schedule?, log?})`. Loopback bind advertises NOTHING (`shouldAdvertise`). Publishes `probe:true` + `host`; replaces `service.records()` so A/AAAA carry exactly `addresses`. Service already `published` at install → unpublish + fail closed. Probe conflict: 3 s check, 3 attempts 5 s apart, then warn naming instance + `identity.key`. `resolveAddresses` re-run every 60 s; changed set → unpublish + republish.
- `resolveAdvertisedAddresses(bindHost, {interfaces?, lookup?})`: specific IP → itself; hostname → lookup ∩ local ifaces; all-ifaces → non-internal, no IPv6 link-local, no `docker*|br-*|veth*|virbr*|cni*|flannel*`; loopback/unresolvable → `[]`.
- TXT: `version`, `pid`, `piPort`, `fp` (full fingerprint), `name` (`dashboardName` or OS hostname minus `.local`; display only).
- `stopAdvertising()`; `isLocalService` (address overlap); `pickBestHost`.
- `serviceToServer(service, isLocal)`: local peer host = first non-link-local advertised address, IPv4 first (IP literal); remote keeps advertised name. Adds `fingerprint?`, `name?`, `addresses`, `instance` (fqdn).
- `peerKey(server)` = fqdn (else `host:port`) — identical for up/down.
- `createBrowser(deps?)`: events `server-up|server-down|server-update|sweep`; handles `srv-update`/`txt-update`; 60 s refresh sweep (3 s browse, injectable `sweepBrowse`/`schedule`/`createBonjour`); peer absent from 3 sweeps → `server-down`.
- `discoverDashboard`, `discoverFallback`, `discoverDashboardWithFallback`: one-shot discovery.
Version pinned: `bonjour-service` 1.4.2 (`records()` override relies on internals; test asserts registered packet). See change: stabilize-mdns-server-identity.
