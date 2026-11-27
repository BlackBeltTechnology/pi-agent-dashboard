# spawn-token.ts — index

Spawn token captured + scrubbed from env at bridge ACTIVATION, kept process-global until first register. `captureSpawnTokenAtActivation()` (idempotent; non-empty only), `consumeSpawnToken()` (once), `__resetSpawnToken`. Nested pi never inherits it. See change: mirror-dashboard-trust-to-pi.
