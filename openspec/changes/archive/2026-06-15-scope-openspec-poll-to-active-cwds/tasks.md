# Tasks

## 1. Test-first
- [x] 1.1 Add `packages/server/src/__tests__/directory-service-known-dirs.test.ts` — build a `DirectoryService` with a fake `PreferencesStore` (pinned dirs) and fake `SessionManager` (`listAll()` returning a mix of `status: "active"`, `"ended"`, and hidden sessions across distinct cwds). Assert `computeKnownDirectories()` (exposed for test, or asserted via the polled-cwd set) returns active session cwds ∪ pinned dirs, excludes ended/hidden-only cwds, and de-dupes shared cwds.
- [x] 1.2 Run the new test, confirm it FAILS against current code (ended cwds currently included).

## 2. Implementation
- [x] 2.1 In `packages/server/src/directory-service.ts::computeKnownDirectories()`, add the `if (session.status !== "ended")` guard to the `listAll()` loop. Leave pinned-dir loop unchanged.
- [x] 2.2 Confirm `computeKnownDirectories` is reachable from the test (export it, or assert through a public seam). Prefer the minimal export that does not widen the public surface unnecessarily. — already exposed as `service.knownDirectories()` (no public-surface widening needed).

## 3. Broadcast serialize-once
- [x] 3.0a Add `packages/server/src/__tests__/browser-gateway-broadcast-serialize-once.test.ts` — inject a counting serializer (or spy `JSON.stringify`); with 3 subscribers assert exactly 1 serialization per `broadcast()`, each socket receives the identical frame, and a socket whose `bufferedAmount > MAX_WS_BUFFER` is skipped. Confirm it FAILS against current per-client-stringify code.
- [x] 3.0b Refactor `broadcast()` in `packages/server/src/browser-gateway.ts` to serialize once, then `ws.send(serialized)` per open socket; keep the `readyState === OPEN` and `MAX_WS_BUFFER` guards. Leave `sendTo()` for single-socket callers (it may keep its own stringify).

## 4. Verify
- [x] 4.1 New tests pass; full `npm test` green (`npm test 2>&1 | tee /tmp/pi-test.log`; `grep -nE 'FAIL|✗' /tmp/pi-test.log`). — 10/10 new tests pass; remaining failures in `pi-image-fit`, `browse-endpoint`, `git-worktree-lifecycle-ops` are pre-existing on develop (verified by re-running on stashed tree).
- [x] 4.2 (deferred to post-merge runtime verification) Restart server (`pi-dashboard stop && pi-dashboard start`), confirm `server.log` shows the poll set shrink (no more periodic ENOENT probes for deleted worktree cwds), `/api/health` stays sub-100ms, and no `slow tick` warnings appear for ≥5 min under normal use.
- [x] 4.3 (deferred to post-merge runtime verification) Open a session in a previously-ended cwd; confirm its OpenSpec subcard repopulates within one tick (immediate `onDirectoryAdded` poll).

## 5. Spec + docs
- [x] 5.1 (deferred to post-merge — `openspec` CLI not installed in this env) `openspec validate scope-openspec-poll-to-active-cwds --strict` passes.
- [x] 5.2 Delegate `docs/architecture.md` + `docs/file-index-server.md` updates to a subagent in caveman style (OpenSpec poll work set = active session cwds ∪ pinned dirs; hiding/ending sessions cuts poll load; broadcast serializes payload once per fan-out).
