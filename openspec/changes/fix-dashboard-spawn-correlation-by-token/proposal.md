## Why

A CLI-launched pi session can be incorrectly stamped `source: "dashboard"` (and rendered with the headless robot icon) when the user happens to launch it in a cwd where the dashboard recently issued a Spawn. The cause is in `event-wiring.ts:494`: the `pendingDashboardSpawns` matcher gates the stamp on **cwd alone**, ignoring `msg.spawnToken`/`msg.pid`. The three-tier identity (`token → pid → cwd-FIFO`) that already exists for `headlessPidRegistry.linkSession` was never applied here.

The symptom persists across restarts because the wrong attribution is written into the session's `.meta.json` sidecar. A defensive guard was added in `source-detector.ts` (the bridge ignores a stale `dashboard` tag when a TUI is attached), but the **server-side mis-attribution that writes the sidecar in the first place** remains.

## What Changes

- Gate the `source: "dashboard"` stamp on a **strong identity match** (token or PID), not on cwd presence. CLI registers without a matching token/PID SHALL NOT consume a `pendingDashboardSpawns` entry and SHALL NOT be stamped.
- Track pending dashboard spawns by `spawnToken` (with cwd as secondary key for fallback only), mirroring the existing `headlessPidRegistry` three-tier model.
- Stop writing `source: "dashboard"` into `.meta.json` when the only signal is a cwd match. Without a token/PID match, the dashboard SHALL leave the bridge's own `detectSessionSource` verdict intact.
- Log every cwd-FIFO fallback for the source-stamp path, so we can observe how often (and when) it actually triggers — paralleling the existing fallback log in the headless-PID-registry linker.
- Provide a one-shot cleanup utility that scans `.meta.json` sidecars and removes `source: "dashboard"` where the corresponding live session reports `hasUI === true` (TUI attached → cannot have been headless).

Not changing:
- The `source-detector.ts` defensive guard added in the prior fix (it remains correct and tested).
- The browser `spawnRequestId` correlation path (already token-keyed via `pendingClientCorrelations`).

## Capabilities

### New Capabilities
*(none)*

### Modified Capabilities
- `spawn-correlation`: Tighten the source-attribution requirement. The existing capability already mandates that `spawnToken` propagates from server → spawned process → first `session_register`. This change extends those guarantees to the **source-tag write path**: a CLI register without a token match SHALL NOT be tagged `dashboard`, and the `.meta.json` write SHALL be skipped on cwd-only matches.

## Impact

**Code:**
- `packages/server/src/event-wiring.ts` — replace cwd-only matcher (lines ~492-503) with token/PID-first matcher; preserve cwd-FIFO as logged fallback only.
- `packages/server/src/pending-dashboard-spawns.ts` (new, small) — extract the registry into a typed structure keyed primarily by `spawnToken`, with cwd-FIFO as secondary. (Or extend `headlessPidRegistry` if shape aligns — TBD in design.)
- `packages/server/src/process-manager.ts` — at spawn time, record `{ token, cwd }` in the new registry instead of bumping the cwd counter.
- `packages/extension/src/source-detector.ts` — no change (already defensive against stale tags).
- `packages/server/src/__tests__/event-wiring-source-stamp.test.ts` (new) — regression coverage for CLI-in-spawn-cwd, token-match, PID-match, cwd-FIFO fallback.

**APIs / protocol:** none. `session_register` already carries `spawnToken` and `pid`; no wire-format change.

**Migration / data:** existing `.meta.json` files with incorrect `source: "dashboard"` need a one-time cleanup. A standalone script SHALL scan `~/.pi/agent/sessions/**/*.meta.json` and remove the `source` field where the live session (per bridge state) reports `hasUI`. Idempotent; safe to re-run.

**Risk:** low. The token/PID match is strictly more conservative than the cwd-only match; the only behaviour change for correct dashboard spawns is "still works". The cwd-FIFO fallback preserves legacy-bridge support (any bridge that doesn't send `spawnToken` or `pid`).

**Backout:** revert `event-wiring.ts` to cwd-only matcher. The `.meta.json` cleanup is one-shot and idempotent.
