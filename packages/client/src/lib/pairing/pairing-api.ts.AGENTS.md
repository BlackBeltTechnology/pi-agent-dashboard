# pairing-api.ts — index

Operator pairing fetch helpers. Exports `getPairPayload()` (`GET /api/pair/payload`; `no_reachable_endpoint`→`{ok:false}` not throw), `approvePairing(code, confirmCode, label?)` (`POST /api/pair/approve`), `PairingPayload`. Mirrors `paired-devices-api.ts`. See change: wire-nonzrok-pairing-view.
