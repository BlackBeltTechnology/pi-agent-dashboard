## 1. Lock the repro (red test first)

- [x] 1.1 In `packages/server/src/__tests__/session-tags-persistence.test.ts`, add a test: `register()` a session → `update({ sessionFile, status: "ended" })` → `update({ tags: ["feature"] })` → `flushAll()` (tags on disk) → `register({ id, cwd, source, startedAt, registerReason: "reattach" })`.
- [x] 1.2 Assert `mgr.get(id)?.tags` equals `["feature"]` after the reattach register (in-memory survival). Confirm RED against current code.
- [x] 1.3 Assert, after `flushAll()`, `readSessionMeta(sessionFile)?.tags` equals `["feature"]` (the reattach `onChange` save did not wipe disk). Confirm RED against current code.

## 2. Fix the carry-over

- [x] 2.1 In `packages/server/src/session/memory-session-manager.ts` `register()`, add `tags: existing.tags,` to the `existing ?` carry-over block, adjacent to `attachedProposal`.
- [x] 2.2 Verify the fix does NOT run on first register (no `existing`): a spawn/new session with no prior record carries no tags. Add/confirm a test asserting first register leaves `tags` undefined.

## 3. Regress

- [x] 3.1 The new reattach-survival test (1.1–1.3) passes.
- [x] 3.2 Existing `session-tags-persistence.test.ts` cases still pass (unrelated-save-no-wipe; cold-scan round-trip).
- [x] 3.3 `npm test` green for server + shared. (All 4 `session-tags-persistence` tests pass; the 59 failures in `/tmp/pi-test.log` are pre-existing, unrelated: `pi-image-fit-extension` native-dep/jimp, fs-watch integration, CP1250 csv, and a deliberately-red `.spike.test.ts` — none touch `session-tags`/`memory-session-manager`.)

## 4. Follow-up audit (document only, do NOT implement here)

- [x] 4.1 Record in design.md (done) the other user/route-set fields absent from the reattach whitelist (`goalId`, `displayPrefsOverride`, `processDrawerCollapsed`, `unread`, `nameSource`, `lifecyclePolicy`, `gitWorktree*`) and that each needs a per-field reattach-survival decision. Do not blind-add them.

## 5. Verify

- [x] 5.1 `openspec validate fix-tags-lost-on-bridge-reattach --strict`.
- [x] 5.2 Manual: tag a session, `POST /api/restart`, confirm tags survive; then simulate reboot-resume (bridge reattach) and confirm tags survive both in the UI and in `.meta.json`.
