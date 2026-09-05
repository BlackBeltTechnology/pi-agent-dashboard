## Why

The bridge's auto-spawn gives the dashboard server a fixed 10 s cold-start readiness window, hardcoded at the `launchServer` call site (`packages/extension/src/server-launcher.ts`, `healthTimeoutMs: 10_000`). On slow hosts the server's real cold start can outlive that window — the dominant cost is the startup session scan, which grows with the number of sessions under `~/.pi/agent/sessions`. A measured cold start with 229 sessions took ~16.5 s from spawn to `writePid()`, plus more for health-OK.

When the window expires, the bridge reports `Dashboard server failed to start: readiness timeout` while the server goes on to boot healthily in the background (HTTP 200 seconds later). The warning is misleading — nothing failed — and unactionable: the window is not configurable, so affected users' only remedy is patching `node_modules`. This mirrors the situation the `fix-bridge-server-start-diagnostics` change already anticipated ("slow hosts reach `writePid()` but are not health-OK within 2 s"), just at a larger margin.

## What Changes

- Add `readinessTimeoutMs` to `DashboardConfig` (`packages/shared/src/config.ts`), parsed from `~/.pi/dashboard/config.json` like the sibling numeric fields: a positive finite number is honored, anything else falls back to the 10 s default (the historical hardcoded value, so existing configs see zero behavior change). Included in `ensureConfig`'s written defaults for discoverability.
- `launchServer` (`packages/extension/src/server-launcher.ts`) forwards `config.readinessTimeoutMs` (with a 10 s fallback for legacy config objects) as `healthTimeoutMs` to the shared `launchDashboardServer` primitive.
- The timeout is a readiness **budget**, not a boot deadline: expiry only controls how long the bridge waits before surfacing the warning. The spawned server keeps booting either way, so a value below the real cold start produces a spurious error next to a healthy server — the doc comment on the new field says so explicitly.

**Not in scope:** the standalone CLI path (`packages/server/src/cli.ts`, hardcoded 30 s) — it already tolerates slow starts, and this change's scope is the bridge path that produced the observed failure. It can adopt the same field later if wanted.

## Capabilities

### New Capabilities

_(none — this modifies an existing capability)_

### Modified Capabilities

- `shared-config`: schema gains `readinessTimeoutMs` (number, default `10000`); non-positive or non-numeric values fall back to the default.
- `bridge-auto-start-lifecycle`: the spawn readiness window is taken from `readinessTimeoutMs` instead of a hardcoded constant; semantics of expiry (warning + background boot continues) are unchanged.

## Impact

- **Code**: `packages/shared/src/config.ts` (field + default + parse + `ensureConfig`), `packages/extension/src/server-launcher.ts` (forwarding + doc comment).
- **Tests**: `packages/shared/src/__tests__/config.test.ts` (default / round-trip / invalid fallback), `packages/extension/src/__tests__/server-launcher-launch.test.ts` (forwarding pin updated: default 10 s when absent, configured value wins when present).
- **Compatibility**: additive; existing `config.json` files without the field behave exactly as before.
