# server-pin-store.ts — index

`~/.pi/dashboard/pinned-servers.json` (0600) — server identities pinned at pairing time, keyed by FINGERPRINT so a moved dashboard verifies without re-pairing. Exports `serverPinsPath`, `loadServerPins`, `recordServerPin`, `resolvePinForEndpoint` (exact address, else the sole pin), `notePinEndpoint`. See change: add-pi-gateway-transport-identity (task 7.1).
