# Tasks — derive OpenSpec artifact status locally

## 1. Pure derivation helper

- [x] 1.1 Add `deriveArtifactStatus(changeDir, listEntry, probes)` to `packages/shared/src/openspec-poller.ts` returning `{ artifacts: [{id, status}], isComplete }`
- [x] 1.2 Implement artifact rules: `proposal` (proposal.md exists, else ready), `tasks` (totalTasks>0 ? done : blocked — matches CLI which keys on authored-not-complete), `design` (design evidence probe, else ready), `specs` (specs evidence probe, else ready); artifact order proposal,design,specs,tasks
- [x] 1.3 Derive `isComplete` = every artifact `done`
- [x] 1.4 Unit-test `deriveArtifactStatus` with injected probes — no fs mocks (mirror `buildOpenSpecData` test style)

## 2. Wire derivation into the periodic poll

- [x] 2.1 In `directory-service.ts` `pollOne`, when `force === false`, replace the `semaphore.run(() => runOpenSpecStatus(...))` call with `deriveArtifactStatus(changeDir, listEntry, {design, specs})`
- [x] 2.2 Keep the per-change mtime gate + TOCTOU stamping unchanged (derivation reads the same files the gate stats)
- [x] 2.3 Preserve `force === true` path: `refreshOpenSpec` still calls `runOpenSpecStatus` (authoritative)
- [x] 2.4 Confirm `buildOpenSpecData` consumes derived `statusResults` identically to CLI results (no shape change)

## 3. Parity guard

- [x] 3.1 Add a test that runs `deriveArtifactStatus` over the repo's own active changes and asserts artifact-for-artifact equality against `buildOpenSpecData(runOpenSpecStatus(...))` (the final dashboard status, with design/specs overrides applied — raw CLI diverges on `design` by construction); skips gracefully if `openspec` CLI absent in CI

## 4. Config relief

- [x] 4.1 Bump `DEFAULT_OPENSPEC_POLL.pollIntervalSeconds` 30 → 60 in `packages/shared/src/config.ts`
- [x] 4.2 Update config reference doc note in `docs/architecture.md` (delegate per docs protocol)

## 5. Verify

- [x] 5.1 `npm test` green (all change-relevant suites pass; residual full-suite failures are pre-existing load/timing flakes — health/shutdown/doctor/model-proxy/image-fit — all pass in isolation)
- [ ] 5.2 Manual (user): restart server with many changes; confirm `[openspec-poll] slow tick` warnings stop and no `heartbeat timeout` correlation
- [ ] 5.3 Manual (user): click OpenSpec Refresh → still force-spawns CLI (authoritative)
