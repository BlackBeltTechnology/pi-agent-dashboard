## Why

> Follow-up to `cleanup-stale-fork-specs` (task 6.1). Draft only: not yet planned or reviewed.

`cleanup-stale-fork-specs` fixed the stale fork and loader requirements in six capabilities. It deliberately left the drift below, because each item needs its own audit or touches production code. This change records it so it is not lost.

## What Changes

Out-of-scope drift to resolve (spec rewrites unless noted):
- `@mariozechner` mentions in 11 other capabilities. `JITI_PACKAGES` still lists `@mariozechner/jiti` as a deliberate fallback (`binary-lookup.ts:29-32`), so each mention needs a careful audit.
- `bundled-recommended-extensions`: "First-run activation…" still cites `dependency-installer.ts`; "Build-time bundling script" still requires the deleted `bundle-recommended-extensions.sh`.
- `electron-launch-source`: "Uniform spawn primitive" lists the deleted kinds `piExtension`, `npmGlobal` and `extracted`.
- `server-launch`: "Removed predecessors" is phrased as pending ("SHALL be removed once…") although the removal is done.
- `dashboard-server`: "Doctor does not probe for tsx" is scoped to `electron/src/lib/doctor.ts`, while shared `doctor-core.ts` still reports a "TypeScript loader" row that may probe system tsx.
- Dead `bootstrap-state` protocol types in `browser-protocol.ts` (code deletion).
- Stale comments in `bundle-server.mjs`, `tool-registry/definitions.ts` and `no-raw-node-import.test.ts` (code edits).

## Capabilities

### Modified Capabilities
- To be determined during planning; see the list above.

## Impact

- Mostly specs. The dead protocol types and stale comments are small production edits.
- Depends on `cleanup-stale-fork-specs`.
- Related: `cleanup-stale-fork-specs` (openspec/changes/cleanup-stale-fork-specs/design.md, Non-Goals).

## Discipline Skills

None apply: no auth, latency, endpoint or runtime change.
