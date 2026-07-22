## 1. Lock the repro (red test first)

- [ ] 1.1 In `packages/server/src/__tests__/session-tags-persistence.test.ts`, add a test: `register()` a session → `update({ sessionFile, status: "ended" })` → `update({ tags: ["feature"] })` → `flushAll()` (tags on disk) → `register({ id, cwd, source, startedAt, registerReason: "reattach" })`.
- [ ] 1.2 Assert `mgr.get(id)?.tags` equals `["feature"]` after the reattach register (in-memory survival). Confirm RED against current code.
- [ ] 1.3 Assert, after `flushAll()`, `readSessionMeta(sessionFile)?.tags` equals `["feature"]` (the reattach `onChange` save did not wipe disk). Confirm RED against current code.

## 2. Fix the carry-over

- [ ] 2.1 In `packages/server/src/session/memory-session-manager.ts` `register()`, add `tags: existing.tags,` to the `existing ?` carry-over block, adjacent to `attachedProposal`.
- [ ] 2.2 Verify the fix does NOT run on first register (no `existing`): a spawn/new session with no prior record carries no tags. Add/confirm a test asserting first register leaves `tags` undefined.

## 3. Regress

- [ ] 3.1 The new reattach-survival test (1.1–1.3) passes.
- [ ] 3.2 Existing `session-tags-persistence.test.ts` cases still pass (unrelated-save-no-wipe; cold-scan round-trip).
- [ ] 3.3 `npm test` green for server + shared: `npm test 2>&1 | tee /tmp/pi-test.log && grep -nE 'FAIL|Error|✗' /tmp/pi-test.log`.

## 4. Follow-up audit (document only, do NOT implement here)

- [ ] 4.1 Record in design.md (done) the other user/route-set fields absent from the reattach whitelist (`goalId`, `displayPrefsOverride`, `processDrawerCollapsed`, `unread`, `nameSource`, `lifecyclePolicy`, `gitWorktree*`) and that each needs a per-field reattach-survival decision. Do not blind-add them.

## 5. Verify

- [ ] 5.1 `openspec validate fix-tags-lost-on-bridge-reattach --strict`.
- [ ] 5.2 Manual: tag a session, `POST /api/restart`, confirm tags survive; then simulate reboot-resume (bridge reattach) and confirm tags survive both in the UI and in `.meta.json`.
