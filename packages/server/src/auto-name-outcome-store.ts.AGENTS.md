# auto-name-outcome-store.ts — index

Bounded (500) in-memory retention of the last auto-naming outcome per session. Eviction prefers non-`stopped` entries; when `stopped` entries alone reach the bound the OLDEST stopped goes — the bound is absolute, protection is only an order. Served by `GET /api/auto-name-outcomes` so a stop latched with no subscribed client is still discoverable. See change: fix-auto-naming-reasoning-model.
