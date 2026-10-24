# peer-shared-bridge.spec.ts — index

L3 (needs `compose.test.peer.yml`; skips otherwise): two dashboards on one multicast network both holding `192.168.64.1` on `bridge0`. A sees B as non-local peer (`POST /api/discover-servers`); neither advert lists `192.168.64.1` (in-container bonjour browse); operator add of the shared address ⇒ `409 self_address`, `knownServers` unchanged. See change: harden-peer-address-identity (X6).
