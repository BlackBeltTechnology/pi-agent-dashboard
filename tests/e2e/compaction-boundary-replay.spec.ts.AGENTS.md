# compaction-boundary-replay.spec.ts

L3 (change: replay-compaction-boundary, F1/F2). Live `/compact` writes a real persisted `compaction` entry; replay must rebuild the `── Session compacted ──` divider at its place in the branch, exactly once.

F1 — server-restart cold load (events evicted → disk): one divider with `BEFORE-BETA` above and `AFTER-GAMMA` below; the persisted `summary` is never rendered.
F2 — `headless` `/reload` respawn → bridge reconnect → `replaySessionEntries()`: exactly one divider survives the register-time wipe/reset (never two, never zero).

Determinism: `qa/fixtures/e2e-custom.ext.ts` returns a canned `session_before_compact` result (no faux summarization round-trip); `scripts/seed-settings-compaction.mjs` lowers `compaction.keepRecentTokens` under `PI_E2E_SEED` so a few small turns cross the manual-compaction cut point. Harness port via `./fixtures.js` / lifecycle, never hardcoded.
