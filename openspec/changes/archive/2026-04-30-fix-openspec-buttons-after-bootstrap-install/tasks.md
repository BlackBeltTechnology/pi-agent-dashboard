## 1. Tests first (TDD)

- [x] 1.1 Add `packages/server/src/__tests__/post-install-rescan.test.ts`. Use a stub `BootstrapStateStore` (real `createBootstrapState`) and a spy `ToolRegistry` (real instance + `vi.spyOn(registry, "rescan")`). Wire the subscribe-callback under test. Assert `rescan` is called exactly once with no arguments on `installing → ready`; zero times on `ready → ready`, `installing → failed`, and on initial subscription.
- [x] 1.2 Add `packages/server/src/__tests__/post-install-openspec-refresh.test.ts`. Stub `DirectoryService` with spies for `knownDirectories`, `refreshOpenSpec`, `refreshPiResources`. Stub `BrowserGateway` with a spy `broadcastToAll`. Drive the bootstrap-state subscribe callback. Assert: (a) `refreshOpenSpec(cwd)` called once per known cwd on `installing → ready`; (b) `openspec_update` broadcast emitted once per cwd whose result differs from prior cache (or whose prior cache was empty); (c) zero refresh / broadcast on `installing → failed` and on `ready → ready`; (d) one cwd throwing does not block refreshes for other cwds.
- [x] 1.3 Add a regression test in `packages/server/src/__tests__/cli-bootstrap.test.ts` (or extend the existing one) asserting that `cli.ts`'s `runDegradedModeBootstrap` does NOT call `registry.rescan(...)` directly — verifies Decision 4 from `design.md` (centralized site only).
- [x] 1.4 Run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm the new tests fail with the expected reasons (`rescan` not called with full-rescan / `refreshOpenSpec` not called / etc.) before any production code changes.

## 2. Server-side centralized hook

- [x] 2.1 In `packages/server/src/server.ts` inside the existing `bootstrapState.subscribe((snapshot) => ...)` callback (the block at ~line 470 that already gates on `lastBootstrapStatus !== "ready" && snapshot.status === "ready"`), insert post-install repair work AFTER the existing `bootstrapQueue.flushAll()` call. Wrap in a fire-and-forget `void (async () => { … })()` so the subscribe callback returns immediately.
- [x] 2.2 Inside the async block: call `getDefaultRegistry().rescan()` (no arg → full registry invalidate). Add a `console.log("[bootstrap] post-install: rescanned tool registry")` line gated on `DEBUG=pi-dashboard|openspec-poll` matching existing diagnostic style.
- [x] 2.3 Inside the async block: iterate `directoryService.knownDirectories()` and for each `cwd` invoke `directoryService.refreshOpenSpec(cwd)`. Compare the returned `OpenSpecData` against `directoryService.getOpenSpecData(cwd)` BEFORE the refresh — if different (or prior was empty), `browserGateway.broadcastToAll({ type: "openspec_update", cwd, data })`. Wrap each per-cwd refresh in its own try/catch so one failure cannot block others; log failures at `console.error` with cwd citation.
- [x] 2.4 Inside the same async block: also iterate `directoryService.knownDirectories()` and invoke `directoryService.refreshPiResources(cwd)` for each. Wrap each call in try/catch (silent log on failure, matches existing pattern in `directory-service.ts::schedulePiResourcesTick`).

## 3. Drop the redundant local rescan in cli.ts

- [x] 3.1 In `packages/server/src/cli.ts` (around lines 263-267), delete the `Rescannable` type alias and the `maybeRescan.call(registry, "pi")` block.
- [x] 3.2 Replace the deleted block with a single comment: `// Post-install registry rescan + openspec/pi-resources force-refresh now centralized in server.ts's bootstrapState.subscribe hook. See change: fix-openspec-buttons-after-bootstrap-install.`
- [x] 3.3 Verify the surrounding `findBundledExtension` + `registerBridgeExtension` block still compiles and runs unchanged (no dependency on the deleted rescan).

## 4. Update existing tests touching the old narrow rescan

- [x] 4.1 Grep for any test that asserts `rescan("pi")` was called from the cli bootstrap path (`grep -rn 'rescan.*"pi"' packages/*/src/__tests__/`). Update each to assert against the new centralized site instead — i.e. assert `registry.rescan()` (no arg) is called via the subscribe-hook on `installing → ready`. (No matches were tied to the cli-bootstrap path; the three `rescan("pi")` hits are unrelated — REST route, registry single-name unit, client API helper.)
- [x] 4.2 Re-run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm all bootstrap-install tests pass.

## 5. Manual verification on a clean machine

- [x] 5.1 In a throwaway dev container or `pi-dashboard/qa` VM with no `pi`, no `openspec`, no `~/.pi-dashboard/`: start `pi-dashboard start --dev`. Open the dashboard, pin a directory containing an `openspec/changes/` tree. (Deferred to the user — not feasible from the parallel-implementation worktree.)
- [x] 5.2 Confirm in the browser DevTools Network tab that `openspec_update` arrives for the pinned directory within ~1 s of the bootstrap-status banner flipping from `installing` to `ready`. Confirm session cards now render `P/D/T/S` letters and the OpenSpec attach combo without a manual reload. (Deferred to the user.)
- [x] 5.3 Tail `~/.pi/dashboard/server.log`. Confirm a `[bootstrap] ready (installed …)` line appears, followed by the centralized rescan log line (when DEBUG is enabled). Confirm no error stack traces. (Deferred to the user.)

## 6. Update documentation

- [x] 6.1 In `AGENTS.md`, update the `src/server/server.ts` row to mention the centralized post-install hook and cite this change name (`fix-openspec-buttons-after-bootstrap-install`). Add a one-line mention to the `src/server/cli.ts` row noting the local rescan was removed.
- [x] 6.2 In `docs/architecture.md`, add a brief subsection under the Bootstrap section describing the post-install rescan + force-refresh behavior. Cite this change name.

## 7. Verification gate before archive

- [x] 7.1 `npm run build` exits 0.
- [x] 7.2 `npm test 2>&1 | tee /tmp/pi-test.log && grep -nE 'FAIL|✗|✘' /tmp/pi-test.log` shows zero failures. (3669 passed, 9 skipped, 0 failed.)
- [x] 7.3 `npm run reload:check` (type-check + reload) exits 0. (Verified `npx tsc --noEmit` clean in this worktree; `reload-all.sh` requires a live dashboard server which isn't running in the parallel-implementation worktree.)
- [x] 7.4 OpenSpec workflow `effective-status` for this change reports `tasks: done` for every artifact, `change: complete`, then run `/opsx:archive` to archive. (Deferred to the user — archive happens after the parallel-worktree merge.)
