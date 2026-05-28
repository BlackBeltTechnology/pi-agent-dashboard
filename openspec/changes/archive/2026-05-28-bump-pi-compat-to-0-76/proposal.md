# Proposal — bump-pi-compat-to-0-76

## Why

Pi 0.76.0 was published 2026-05-27 (same day as the 0.75 floor bump). The 0.75 → 0.76 delta is small from the dashboard's perspective — no Node-floor bump, no breaking surface the dashboard exercises (the one Breaking Change is the `xiaomi` provider's API-billing migration; the dashboard never references it). The remaining surface is additive (`--session-id`, RPC `excludeFromContext` on `bash`) or fixes (provider retries, Codex WS/SSE bounds, RpcClient lifecycle).

This change keeps the dashboard's `piCompatibility` block tracking the current upstream stream: lift `minimum` and `recommended` to `0.76.0` and bump the bundled-extension peer-dep pins in lockstep. No engines change, no node-guard change.

Why a separate change (vs amending bump-pi-compat-to-0-75):

- 0.75 is implemented + tested + ready to ship; reopening it grows its diff and review surface.
- 0.76's surface is genuinely smaller — the changelog reduces to "track the new upstream version" + lockstep pins.
- Each floor bump is its own auditable PR (matches the pattern set by the archived `pi-zero-seventy-compat`, `bump-pi-compatibility-073` family).

## What Changes

### Phase 1 — Bump piCompatibility

- **MODIFY**: `packages/server/package.json::piCompatibility`:
  - `minimum: "0.75.0"` → `"0.76.0"`
  - `recommended: "0.75.5"` → `"0.76.0"` (latest published; lockstep with minimum since the 0.76 line currently has only `0.76.0`).
  - `maximum: null` (unchanged).
- **MODIFY**: `packages/server/package.json::dependencies."@earendil-works/pi-coding-agent"`: `^0.75.0` → `^0.76.0`.

### Phase 2 — Bundled-extension peer-deps in lockstep

- **MODIFY**: `packages/electron/resources/bundled-extensions/pi-anthropic-messages/package.json` — peer `@earendil-works/pi-coding-agent` `">=0.75.0"` → `">=0.76.0"`.
- **MODIFY**: `packages/electron/resources/bundled-extensions/pi-flows/package.json` — both peer and dev occurrences of `pi-ai`, `pi-coding-agent`, `pi-tui` `^0.75.0` → `^0.76.0`.
- Grep catch-all for any other `0.75` peer-dep.

### Phase 3 — Smoke verification (no code, manual)

`/api/bootstrap/status` and the bootstrap banner were removed under `eliminate-electron-runtime-install`; runtime enforcement now flows through `engines.node` + bundled-extension peer-dep resolution. Smoke targets those:

- Fresh `npm install` of the server resolves `@earendil-works/pi-coding-agent@^0.76.0`.
- Install bundled `pi-flows` against host pi 0.75.x → peer-dep warn / fail (intended); against 0.76.0 → clean.
- (Optional) Exercise `excludeFromContext` from the dashboard's RPC keeper if a follow-up wants to consume it.

## Capabilities

### Modified Capabilities

- `pi-core-version-check`:
  - `piCompatibility.minimum` and `piCompatibility.recommended` SHALL track the 0.76 line (`0.76.0` floor, `0.76.0` recommendation until a 0.76.x patch ships).

## Impact

- **Code**: 3 manifest files (server `package.json`, two bundled-extension `package.json`s).
- **Tests**: `bundled-node-meets-pi-floor.test.ts` lookup table gains a `0.76.0 → 22.19` row (Node floor unchanged from 0.75). `pi-version-skew.test.ts` literal fixtures unaffected (synthetic versions).
- **Migration / compat**: pi 0.75.x users hit peer-dep failures when installing bundled extensions against the new floor (no in-app red banner today — `/api/health.compatibility` + bootstrap banner remain removed; tracked separately as `restore-pi-version-skew-surface`). Node engines floor (`>=22.19.0`) is unchanged — no user-facing Node implication.
- **Rollback**: revert the four edits; no persisted state.
- **Risk**: low. 0.76 ships ~4 hours before this change; if a critical regression surfaces in 0.76 we can ship `0.76.1` and update `recommended` without touching the floor.

## Out of Scope

- Node engines floor changes (unchanged at `>=22.19.0`).
- `node-guard.ts::isAffectedNode` widening (unchanged; pi 0.76 did not raise its Node minimum from 22.19).
- Adopting any new 0.76 APIs (`--session-id`, RPC `excludeFromContext`). Tracked as follow-up issues.
- Provider-retry behavior changes in 0.76 (`retry.provider.maxRetries` enforcement) — the dashboard's model-proxy config layer does not surface this knob today; follow-up if user-visible.
