## Why

> Follow-up to `cleanup-stale-fork-specs` (task 6.1). Planned from a code audit (see design.md).

`cleanup-stale-fork-specs` fixed the stale fork and loader requirements in six capabilities. It deliberately left the drift below, because each item needs its own audit or touches production code. This change records it so it is not lost.

## What Changes

Out-of-scope drift to resolve (spec rewrites unless noted):
- `@mariozechner` mentions in 11 other capabilities. `JITI_PACKAGES` still lists `@mariozechner/jiti` as a deliberate fallback (`packages/shared/src/platform/binary-lookup.ts:29-32`), so each mention needs a careful audit.
- `bundled-recommended-extensions`: "First-run activation…" still cites `dependency-installer.ts`; "Build-time bundling script" still requires the deleted `bundle-recommended-extensions.sh` (its `.mjs` successor is deleted too).
- `electron-launch-source`: "Uniform spawn primitive" lists the deleted kinds `piExtension`, `npmGlobal` and `extracted`.
- `server-launch`: "Removed predecessors" is phrased as pending ("SHALL be removed once…") although the removal is done.
- `dashboard-server`: "Doctor does not probe for tsx" is scoped to `electron/src/lib/doctor.ts`, while shared `doctor-core.ts` still reports a "TypeScript loader" row that may probe system tsx.
- Dead `bootstrap-state` protocol types in `browser-protocol.ts` (code deletion).
- Stale comments in `bundle-server.mjs`, `tool-registry/definitions.ts` and `no-raw-node-import.test.ts` (code edits).

## Capabilities

### Modified Capabilities
- `electron-launch-source`: the resolver, probe and spawn requirements now name the live kinds (`attach`, `devMonorepo`, `localLink`, `overlay`, `bundled`). The extracted self-heal requirement is removed. The CLI-wrapper rationale no longer cites the deleted `probeNpmGlobal`.
- `bundled-recommended-extensions`: the manifest is empty. The bundling-script, extraResource, first-run activation and size-budget requirements are removed.
- `server-launch`: "Removed predecessors" now states a completed removal.
- `dashboard-server`: "Doctor does not probe for tsx" covers all Doctor surfaces, including shared `doctor-core.ts`. This is a code change: the tsx probes are dropped.
- `electron-qa-coverage`: the obsolete "degraded managed-dir recovery" (Stage 9) requirement is removed. It was found during the audit.
- `doctor-diagnostic`: the section taxonomy names the live `TypeScript loader` check instead of `TypeScript loader (tsx)`.
- `electron-build-pipeline`: the "Size budget enforcement in CI" requirement for the removed `bundled-extensions` tree is removed.
- `ci-cd-pipeline`: "Build tools referenced by workflows…" is replaced to drop the stale scenario about the deleted `bundle-recommended-extensions.mjs` step. The rule itself is unchanged.
- `electron-bundle-extract`: **retired**. Every requirement describes the deleted extraction into `~/.pi-dashboard/`, config migration or `/api/electron/reinstall`.
- `platform-primitives`: the "Electron jiti resolver is removed" scenario no longer points at the deleted `resolve-jiti.ts`.

`@mariozechner` appears in 13 spec files. `server-launch` and `electron-qa-coverage` are handled above. The other 11 were audited and need no change: every mention is a negative guard or the deliberate `@mariozechner/jiti` loader fallback.

## Impact

- Mostly specs. Production edits: drop the tsx probes from `doctor-core.ts`; delete the dead `bootstrap_*` protocol types; fix stale comments. Residual bundled-extension code (`BUNDLED_EXTENSION_IDS`, `computeIsBundled`) is kept on purpose.
- Depends on `cleanup-stale-fork-specs`.
- Related: `cleanup-stale-fork-specs` (openspec/changes/cleanup-stale-fork-specs/design.md, Non-Goals).

## Discipline Skills

- `review-code`: run before commit. The `doctor-core.ts` probe removal changes runtime output.
- `doubt-driven-review`: retiring `electron-bundle-extract` deletes its spec directory on archive (recoverable only from git), so it was run during planning.
- No other skill applies. Nothing touches auth, untrusted input, a latency budget, a new endpoint or job, or a data migration.
