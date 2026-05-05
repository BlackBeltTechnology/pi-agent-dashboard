## 1. Detector hardening (TDD)

- [x] 1.1 Add failing tests in `packages/shared/src/__tests__/openspec-activity-detector.test.ts` (or co-located file) for: UUID-shaped path (`Read` + `Write`), UUID-shaped CLI arg (`bash openspec archive <UUID>`), uppercase name, underscore-containing name, digit-prefixed name, name longer than 64 chars. Each MUST assert `null` from `detectOpenSpecActivity`.
- [x] 1.2 Add positive-control tests for valid kebab-case slugs (`add-auth`, `valid-name-123`, `fix-mobile-attach`) — assert each still returns `{ changeName, isActive: true }`.
- [x] 1.3 Add `isValidOpenSpecChangeSlug(name: string): boolean` to `packages/shared/src/openspec-activity-detector.ts` implementing the regex `^[a-z][a-z0-9-]{0,63}$` (single source of truth).
- [x] 1.4 Replace the existing `name.startsWith("-")` guard in `detectOpenSpecActivity`'s bash branch with `if (!isValidOpenSpecChangeSlug(name)) return null;`. Apply the same predicate inside the `read` and `write` branches before returning a `changeName`.
- [x] 1.5 Run the test file — all new tests pass, all pre-existing flag-rename tests still pass.
- [x] 1.6 Export `isValidOpenSpecChangeSlug` from the module so server code can import it.

## 2. Defense-in-depth at rename site (TDD)

- [x] 2.1 Add a failing test in `packages/server/src/__tests__/auto-attach.test.ts` (or sibling file) that simulates `detectOpenSpecActivity` returning a UUID-shaped `{ changeName, isActive: true }` and asserts the server does NOT mutate `session.openspecChange`, `session.attachedProposal`, or `session.name`, and does NOT send `rename_session`.
- [x] 2.2 In `packages/server/src/event-wiring.ts` auto-attach branch (around lines 240–268), import `isValidOpenSpecChangeSlug` from the shared module and skip the entire `activityUpdates` + auto-attach + rename block when `detected.changeName && !isValidOpenSpecChangeSlug(detected.changeName)`.
- [x] 2.3 Confirm the new test passes and existing auto-attach tests still pass.
- [x] 2.4 Verify `applyAttachProposal` (`session-meta-handler.ts`) and the REST `/attach-proposal` route are NOT modified — manual paths must still accept any browser-sent name.

## 3. Manual verification

- [x] 3.1 Run `npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|✗|✘' /tmp/pi-test.log` — confirm no failures. (4538/4549 pass; the single FAIL is `no-direct-platform-branch` on `packages/shared/src/doctor-core.ts:565`, an untracked pre-existing file unrelated to this change.)
- [x] 3.2 Restart the dashboard server (`pi-dashboard restart` → delegated to `/api/restart`; orchestrator queued, server back at port 8000) and reload bridges (`npm run reload` succeeded; 13 sessions reloaded). Note: two pre-existing UUID-named sessions visible in the sidebar (`019df0aa`, `019dfa2b`) confirm the bug's prior victims; no migration sweep per design — user can rename/detach to clear.
- [x] 3.3 Spawn a session in a directory that contains `openspec/changes/<UUID>/...` (or simulate with a `bash openspec archive <UUID>` from the agent). Confirm the session card name does NOT become the UUID and `attachedProposal` stays `null`. (smoke test passed)
- [x] 3.4 Spawn a session in a directory with a real change (`openspec/changes/add-auth/...`) and trigger an activity event. Confirm auto-attach + rename to `add-auth` still works. (smoke test passed)

## 4. Docs + spec sync

- [x] 4.1 Append a CHANGELOG entry under `## [Unreleased]` summarizing the bug + fix.
- [x] 4.2 Per AGENTS.md `Documentation Update Protocol`, dispatch a general-purpose subagent to update the relevant `docs/file-index-<area>.md` rows for any file whose contract changed (`packages/shared/src/openspec-activity-detector.ts` and `packages/server/src/event-wiring.ts`). Caveman style, ≤ 200 chars.
- [x] 4.3 Run `openspec validate fix-uuid-rename-bug --strict` — expect `valid`.
