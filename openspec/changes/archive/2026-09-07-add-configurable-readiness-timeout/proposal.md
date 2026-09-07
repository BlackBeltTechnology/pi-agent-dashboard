## Why

The bridge's auto-spawn gives the dashboard server a fixed 10 s cold-start readiness window, hardcoded at the `launchServer` call site (`packages/extension/src/server-launcher.ts`, `healthTimeoutMs: 10_000`). On slow hosts the server's real cold start can outlive that window — the dominant cost is the startup session scan, which grows with the number of sessions under `~/.pi/agent/sessions`. A measured cold start with 229 sessions took ~16.5 s from spawn to `writePid()`, plus more for health-OK.

When the window expires, the bridge reports `Dashboard server failed to start: readiness timeout` while the server goes on to boot healthily in the background (HTTP 200 seconds later). The warning is misleading — nothing failed — and unactionable: the window is not configurable, so affected users' only remedy is patching `node_modules`. This mirrors the situation the `fix-bridge-server-start-diagnostics` change already anticipated ("slow hosts reach `writePid()` but are not health-OK within 2 s"), just at a larger margin.

## What Changes

- Add `readinessTimeoutMs` to `DashboardConfig` (`packages/shared/src/config.ts`), parsed from `~/.pi/dashboard/config.json` like the sibling numeric fields: a positive finite number is honored (clamped into `[READINESS_TIMEOUT_MIN_MS, READINESS_TIMEOUT_MAX_MS]` = 1 s … 10 min), anything else falls back to the `HEALTH_CHECK_TIMEOUT_MS` default (the historical hardcoded value, so existing configs see zero behavior change). Included in `ensureConfig`'s written defaults for discoverability.
- Derive the auto-start lock's staleness bound from the configured window: `spawnReadinessBudgetMs(readinessTimeoutMs) = max(3 × timeout, SPAWN_READINESS_BUDGET_MS)`, threaded through the existing `deps.readinessBudgetMs` seam in `packages/extension/src/server-auto-start.ts`. Without it the constant 30 s bound inverts the documented "budget > health poll" invariant for any configured value > 30 s: the lock is `childPid`-less for the whole readiness window, so `isLockStale` falls through to pure age, and a second session breaks a LIVE holder's lock mid-spawn and starts a competing server (`PortConflictError`) — on exactly the slow hosts a raised window targets.
- `launchServer` (`packages/extension/src/server-launcher.ts`) forwards `config.readinessTimeoutMs` (with a 10 s fallback for legacy config objects) as `healthTimeoutMs` to the shared `launchDashboardServer` primitive.
- The timeout is a readiness **budget**, not a boot deadline: expiry only controls how long the bridge waits before surfacing the warning. The spawned server keeps booting either way, so a value below the real cold start produces a spurious error next to a healthy server — the doc comment on the new field says so explicitly.

**Not in scope:** the standalone CLI path (`packages/server/src/cli.ts`, hardcoded 30 s) — it already tolerates slow starts, and this change's scope is the bridge path that produced the observed failure. It can adopt the same field later if wanted. `SERVER_STARTUP_DEADLINE_MS` (the server's own hung-boot kill deadline) also stays constant: it bounds a server killing ITSELF, not a spawner waiting, so a raised bridge window cannot turn it into a false positive.

## Capabilities

### New Capabilities

_(none — this modifies an existing capability)_

### Modified Capabilities

- `shared-config`: schema gains `readinessTimeoutMs` (number, default `10000`); non-positive or non-numeric values fall back to the default.
- `bridge-auto-start-lifecycle`: the spawn readiness window is taken from `readinessTimeoutMs` instead of a hardcoded constant; semantics of expiry (warning + background boot continues) are unchanged. The spawn readiness budget stays strictly larger than the health poll for every configured value, so the single-flight lock's staleness rule is unaffected by raising the window.

## Discipline Skills

- `doubt-driven-review` — the change widens a concurrency-relevant timing window; the lock-invariant inversion it uncovered is exactly the class of finding this skill exists to surface before the change stands.
- `review-code` — non-trivial change, tests green before commit.

## Impact

- **Code**: `packages/shared/src/config.ts` (field + default + parse + clamp + `ensureConfig` + `spawnReadinessBudgetMs`), `packages/extension/src/server-launcher.ts` (forwarding + doc comment), `packages/extension/src/server-auto-start.ts` (budget derived from the configured window).
- **Tests**: `packages/shared/src/__tests__/config.test.ts` (default / round-trip / invalid fallback / clamp / budget derivation), `packages/extension/src/__tests__/server-launcher-launch.test.ts` (forwarding pin updated: default 10 s when absent, configured value wins when present), `packages/extension/src/__tests__/server-auto-start-guarded.test.ts` (a 40 s-old lock survives under a 60 s window, still expires under the default one).
- **Docs**: `docs/architecture.md` config reference gains the field.
- **Compatibility**: additive; existing `config.json` files without the field behave exactly as before.
