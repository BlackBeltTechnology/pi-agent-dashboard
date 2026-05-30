## 1. Watcher module + filename filter

- [x] 1.1 Create `packages/server/src/openspec-change-watcher.ts` with the `OpenSpecChangeWatcher` interface from design.md (`attach`, `detach`, `detachAll`).
- [x] 1.2 Implement filename-filter regex `^(?:tasks\.md|proposal\.md|design\.md|specs(?:\/.*)?\.md)$`.
- [x] 1.3 Add `packages/server/src/__tests__/openspec-change-watcher-filter.test.ts` — table-driven positive / negative cases. Confirm tests fail first (TDD).
- [x] 1.4 Make 1.3 pass: implement filter helper.

## 2. Debounce

- [x] 2.1 Add per-cwd debounce timer (default 300 ms; constructor-overridable for tests).
- [x] 2.2 Add `packages/server/src/__tests__/openspec-change-watcher-debounce.test.ts` using vitest fake timers — three events in 300 ms → one `onChange` call. Confirm fail-first.
- [x] 2.3 Make 2.2 pass.

## 3. Real `fs.watch` integration

- [x] 3.1 Implement `attach(cwd)` — `fs.watch(join(cwd, "openspec", "changes"), { recursive: true, persistent: false })`. Wrap in try/catch. Log + degrade on ENOENT, EMFILE, EACCES, EPERM.
- [x] 3.2 Implement `detach(cwd)` — close watcher, clear debounce timer. Idempotent.
- [x] 3.3 Implement `detachAll()` — iterate attached set.
- [x] 3.4 Guard handler against post-detach race: re-check `attached.has(cwd)` inside the debounce callback.
- [x] 3.5 Add `packages/server/src/__tests__/openspec-change-watcher-fs.test.ts` — tmp dir, real fs.watch, write to `tasks.md` → `onChange(cwd)` called within ≤ 1 s. Confirm fail-first.
- [x] 3.6 Make 3.5 pass.
- [x] 3.7 Add ENOENT test — attach to a cwd without `openspec/changes/`; assert no throw, watcher recorded as "deferred"; subsequent re-attach succeeds after dir created.

## 4. Wire into `DirectoryService`

- [x] 4.1 Add optional `watcher: OpenSpecChangeWatcher` field to `DirectoryService` constructor deps. Default-construct via `createOpenSpecChangeWatcher` when undefined.
- [x] 4.2 `onDirectoryAdded(cwd)` — after the immediate `pollOne(cwd, true)` call, invoke `watcher.attach(cwd)`.
- [x] 4.3 `onDirectoryRemoved(cwd)` (or the matching forget path — check `directory-handler.ts` unpin + `session_unregister` cwd-eviction) — invoke `watcher.detach(cwd)`.
- [x] 4.4 Server graceful-shutdown hook → `watcher.detachAll()`. Reuse existing shutdown plumbing (`stop()` / `dispose()`).
- [x] 4.5 Wire `onChange: (cwd) => pollOne(cwd, false)` so the watcher fans into the existing mtime-gated path.

## 5. Regression: mtime-gate dedup still applies

- [x] 5.1 Add `packages/server/src/__tests__/directory-service-watcher-dedup.test.ts` — fire the watcher twice in a row with no mtime advance; assert only zero or one `openspec status` spawn occurs (gate skips the redundant call). Confirm fail-first if regression introduced.

## 6. Update spec

- [x] 6.1 Add Requirement "Push refresh on local filesystem change" with scenarios under `specs/server-openspec-polling/spec.md` of this change directory.

## 7. Documentation

- [x] 7.1 Add row for `packages/server/src/openspec-change-watcher.ts` in `docs/file-index-server.md` (alphabetical-by-path; caveman-style purpose; `See change: fix-openspec-taskcheck-delay`).
- [x] 7.2 Append a `See change: fix-openspec-taskcheck-delay` annotation to the existing `directory-service.ts` row in the same split, noting the new watcher integration.
- [x] 7.3 Add `[Unreleased]` CHANGELOG entry: "OpenSpec task counter and stepper actions refresh within 1 s of editing tasks.md (push-based fs.watch, polling kept as fallback)."

## 8. Verification

- [x] 8.1 `npm test 2>&1 | tee /tmp/pi-test.log` — all green (6605 passed, 19 skipped, 0 failed).
- [x] 8.2 Manual: open dashboard with a folder containing an active change. Edit `tasks.md` checkbox in editor → session card counter updates within ≤ 1 s.
- [x] 8.3 Manual: rapid-tick five checkboxes in < 300 ms → exactly one `openspec_update` broadcast observed in DevTools WebSocket frames.
- [x] 8.4 Manual: cwd with no `openspec/` dir → no thrown errors in server.log; periodic poll continues.
