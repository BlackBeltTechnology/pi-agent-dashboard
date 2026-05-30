# Proposal — bump-pi-compat-to-0-78

## Why

Pi has published two minor releases since the 0.75 floor was drafted: `0.76.0` (2026-05-27), `0.77.0` (2026-05-28), `0.78.0` (2026-05-29). The earlier proposal `bump-pi-compat-to-0-76` was drafted but never merged to `develop` (verified: develop HEAD still pins `^0.75.0` everywhere) — this change supersedes it and lifts the dashboard's `piCompatibility` block straight from `0.75` to `0.78` in a single jump.

The 0.75 → 0.78 window is benign from the dashboard's perspective:

- **Zero Breaking Changes** in the 0.76, 0.77, 0.78 changelog sections. Last breaking surface was 0.75.0 (Node floor → 22.19.0), already absorbed.
- **Node floor unchanged** at `>=22.19.0` across all three minors. No `engines.node` change, no `node-guard.ts` change.
- **Net positives free to inherit** (no code change):
  - `0.77`: SIGTERM/SIGHUP exits now fire `session_shutdown` cleanup. Bridge's existing `pi.on("session_shutdown", …)` (bridge.ts:2061) starts executing on signal-driven exits — cleaner `session_unregister` telemetry, faster session-row removal on the server.
  - `0.77`: Session disposal aborts in-flight agent / compaction / branch / retry work — pure bug fix the dashboard benefits from.
  - `0.76`: `RpcClient` drains stdin + rejects pending requests on unexpected child exit (cleaner keeper teardown).
  - `0.76`: RPC stdout writes retry transient backpressure + flush on shutdown.
  - `0.76`: managed npm extension updates no longer install pi host packages as peer deps.

The remaining additive surface (`--session-id`, `--exclude-tools`, `--name`, `InputEvent.streamingBehavior`, `pi.getAllTools().promptGuidelines`, exported `convertToPng` / `parseArgs` / `Args`) is opt-in — adoption is tracked in follow-up proposals (`surface-input-streaming-behavior` scaffolded alongside this change; `--session-id` adoption deferred).

Why a single 0.75 → 0.78 hop instead of three chained bumps:

- The 0-76 proposal never reached develop; chaining 0-76 → 0-77 → 0-78 across three unshipped PRs adds review surface with no signal.
- Each minor's delta against the dashboard's surface is small and additive; bundling keeps the diff a 5-file manifest edit + a lookup-table update.
- Rollback semantics are unchanged: revert one PR to return to `0.75.0` / `0.75.5` floor.

## What Changes

### Phase 1 — Bump piCompatibility

- **MODIFY**: `packages/server/package.json::piCompatibility`:
  - `minimum: "0.75.0"` → `"0.78.0"`
  - `recommended: "0.75.5"` → `"0.78.0"` (latest published; lockstep with minimum since the 0.78 line currently has only `0.78.0`).
  - `maximum: null` (unchanged).
- **MODIFY**: `packages/server/package.json::dependencies."@earendil-works/pi-coding-agent"`: `^0.75.0` → `^0.78.0`.

### Phase 2 — Bundled-extension peer-deps in lockstep

- **MODIFY**: `packages/electron/resources/bundled-extensions/pi-anthropic-messages/package.json` — peer `@earendil-works/pi-coding-agent` `">=0.75.0"` → `">=0.78.0"`.
- **MODIFY**: `packages/electron/resources/bundled-extensions/pi-flows/package.json` — both peer and dev occurrences of `pi-ai`, `pi-coding-agent`, `pi-tui` `^0.75.0` → `^0.78.0`.
- Grep catch-all (`grep -rn '0\.75' packages/electron/resources/bundled-extensions/`) for any other 0.75 peer-dep.

### Phase 3 — Lookup table update

- **MODIFY**: `packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts` — add to `PI_MIN_TO_NODE_FLOOR`:
  - `"0.76.0": { major: 22, minor: 19 }`
  - `"0.77.0": { major: 22, minor: 19 }`
  - `"0.78.0": { major: 22, minor: 19 }`
  (Pi 0.76 / 0.77 / 0.78 all inherit 0.75's Node floor; no Node bump occurred in the window.)

### Phase 4 — Smoke verification (no code, manual)

`/api/bootstrap/status` and the bootstrap banner were removed under `eliminate-electron-runtime-install`; runtime enforcement now flows through `engines.node` + bundled-extension peer-dep resolution. Smoke targets those:

- Fresh `npm install` of the server resolves `@earendil-works/pi-coding-agent@^0.78.0`.
- Install bundled `pi-flows` against host pi 0.75.x / 0.76.x / 0.77.x → peer-dep warn / fail (intended); against 0.78.0 → clean.
- Optional: confirm the SIGTERM/SIGHUP cleanup positive (kill pi with SIGTERM; observe `session_unregister` reaching the server before WS close).

## Capabilities

### Modified Capabilities

- `pi-core-version-check`:
  - `piCompatibility.minimum` and `piCompatibility.recommended` SHALL track the 0.78 line (`0.78.0` floor, `0.78.0` recommendation until a 0.78.x patch ships).

## Impact

- **Code**: 3 manifest files (server `package.json`, two bundled-extension `package.json`s).
- **Tests**: `bundled-node-meets-pi-floor.test.ts` lookup table gains `0.76.0`, `0.77.0`, `0.78.0` rows (all → 22.19, Node floor unchanged). `pi-version-skew.test.ts` literal fixtures unaffected (synthetic versions).
- **Migration / compat**: pi 0.75.x, 0.76.x, 0.77.x users hit peer-dep failures when installing bundled extensions against the new floor (no in-app red banner today — `/api/health.compatibility` + bootstrap banner remain removed; tracked separately as `restore-pi-version-skew-surface`). Node engines floor (`>=22.19.0`) is unchanged — no user-facing Node implication.
- **Supersedes**: `bump-pi-compat-to-0-76` (unshipped). After this change merges, that proposal's directory may be archived without an implementation pass.
