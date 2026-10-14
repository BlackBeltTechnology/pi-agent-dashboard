# pairing-api.ts — index

Operator pairing fetch helpers. Exports `getPairPayload()` (`GET /api/pair/payload`; `no_reachable_endpoint`→`{ok:false}` not throw), `approvePairing(code, confirmCode, label?)` (`POST /api/pair/approve`), `PairingPayload`. Mirrors `paired-devices-api.ts`. See change: wire-nonzrok-pairing-view.

`requestAccess(name?)` — same-origin LAN knock against `POST /api/pair/request`; returns a typed refusal result (never throws on a refusal). See change: add-lan-knock-pairing.
