# known-servers-api.ts — index

Client fetch helpers for known-servers management. Exports `listKnownServers`, `addKnownServer(host, port, label?)`, `removeKnownServer(host, port)`, `discoverServers`. Hits /api/known-servers + /api/discover-servers. Also `listKnownServersWithAccess()` (`{servers, canManage}`), `addKnownServer(host,port,label?,fingerprint?)` → `{updated}`, `probeKnownServer` / `acceptKnownServerMove` (operator-only; transport failure or refusal → `null`). See change: stabilize-mdns-server-identity.

## group-servers-by-identity

Routes, `scheme`, remove by route/fingerprint, probe result with `fingerprint`. See change: group-servers-by-identity.
