# compaction-boundary-replay.spec.ts

L3 (change: replay-compaction-boundary, F1/F2). Live `/compact` writes a real persisted `compaction` entry; replay must rebuild the `── Session compacted ──` divider at its place in the branch, exactly once.

F1 — `/reload` bridge replay after the register-time store wipe: one divider with `BEFORE-BETA` above and `AFTER-GAMMA` below; the persisted `summary` is never rendered.
F2 — two consecutive `headless` `/reload` respawns → bridge reconnect → `replaySessionEntries()`: exactly one divider survives each register-time wipe/reset (never two, never zero).

Disk cold load is deliberately NOT driven here: `POST /api/restart` exits the container's main process and `restart: unless-stopped` respawns it, wiping the RAM-backed `pi-state` tmpfs where session JSONL lives — the file the cold load needs is gone first. That producer is gated at L2 instead: `loadAndReplay` over a real session file in `packages/server/src/__tests__/session-load-worker.test.ts`.

Determinism: `qa/fixtures/e2e-custom.ext.ts` returns a canned `session_before_compact` result (no faux summarization round-trip); `scripts/seed-settings-compaction.mjs` lowers `compaction.keepRecentTokens` under `PI_E2E_SEED` so a few small turns cross the manual-compaction cut point. Harness port via `./fixtures.js` / lifecycle, never hardcoded.
