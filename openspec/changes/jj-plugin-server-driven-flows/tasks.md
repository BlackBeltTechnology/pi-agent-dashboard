## 1. Server-side endpoints (no client wiring yet)

- [ ] 1.1 Add the new `POST /api/jj/workspace/fold-back` handler to the existing `packages/server/src/routes/jj-routes.ts`. The other four routes (`add`, `forget`, `list`, `init-colocated`) already live there and are modified in-place by later tasks. Do **not** move routes into `packages/jj-plugin/src/server/` — they need `browserGateway` / `pendingAttachRegistry` / `headlessPidRegistry` / `networkGuard` which are dashboard-internal singletons, not exposed via `ServerPluginContext`.
- [ ] 1.2 Create `packages/jj-plugin/src/shared/error-codes.ts` exporting the closed enum: `NOT_COLOCATED`, `EMPTY_WORKING_COPY`, `CONFLICTS_PRESENT`, `DIRTY_INDEX`, `BOOKMARK_EXISTS`, `REBASE_CONFLICT`, `PUSH_FAILED`, `TRUNK_PUSH_BLOCKED`, `INVALID_NAME`, `INVALID_SESSION`, `SESSION_BUSY`, `SESSION_NOT_HEADLESS`, `NO_SESSION_FILE`, `WORKSPACE_EXISTS`, `INVALID_MODE`, `UNFOLDED_WORK`
- [ ] 1.3 Create `packages/jj-plugin/src/server/preflight.ts` — pure functions for the four checks (colocated, conflicts, empty-WC, dirty-index) returning `{ ok: true } | { ok: false, code, data?, message }`
- [ ] 1.4 Add unit tests for `preflight.ts` covering each refusal code and the happy path with mocked `jj`/`git` invocations
- [ ] 1.5 Create `packages/jj-plugin/src/server/fold-back.ts` — orchestrator: preflight → bookmark-create (refuse on `BOOKMARK_EXISTS`) → capture pre-rebase op id → rebase → conflict-check + rollback → push. Emits progress via injected `emitProgress(jobId, event)` callback
- [ ] 1.6 Add unit tests for `fold-back.ts`: happy path, each preflight refusal, bookmark conflict, rebase conflict triggers `jj op restore` rollback and bookmark deletion, push failure preserves local bookmark
- [ ] 1.7 Modify the existing `add` handler in `packages/server/src/routes/jj-routes.ts`: require `sessionId`, validate it resolves to a live session inside `fromCwd`, headless precondition (`headlessPidRegistry.getPid(sessionId) !== undefined` — else `SESSION_NOT_HEADLESS`), busy-check (`session.status === "streaming"` — same gate as `handleHeadlessReload` — else `SESSION_BUSY`), check `session.sessionFile` exists (else `NO_SESSION_FILE`), then after `jj workspace add` call `headlessPidRegistry.killBySessionId(sessionId)` and `spawnPiSession(realDestPath, { sessionFile: session.sessionFile, mode: "continue", strategy: "headless" })`. Strategy is hardcoded `"headless"` because `killBySessionId` only operates on headless PIDs; mismatched strategies would orphan spawn semantics. Remove the existing `pendingAttachRegistry.enqueue(realDestPath, name)` call (line ~206) — the respawn path re-uses the same `sessionId`, so `attachedProposal` is preserved automatically by `memorySessionManager.register` re-hydration.
- [ ] 1.8 Add unit/integration tests for the modified `add` handler: happy path (sessionId preserved, cwd updated), `INVALID_NAME`, `INVALID_SESSION`, `SESSION_NOT_HEADLESS` (session not in `headlessPidRegistry`), `SESSION_BUSY`, `NO_SESSION_FILE`, `WORKSPACE_EXISTS`, baseRev resolution from current bookmark, baseRev fallback to `trunk()`. Mock `spawnPiSession` and `headlessPidRegistry.killBySessionId` and assert call order + arguments (`strategy: "headless"`, `mode: "continue"`, no `pendingAttachRegistry.enqueue`).
- [ ] 1.9 Create `packages/jj-plugin/src/server/workspace-forget.ts` — orchestrator: enumerate unfolded commits via `fork_point(ws@, trunk()) .. ws@`, refuse with `UNFOLDED_WORK` unless `force === true`, then `jj workspace forget` + `fs.rm({ recursive: true, force: true })`
- [ ] 1.10 Add unit tests for `workspace-forget.ts`: refuse on unfolded, succeed on clean, succeed with force on unfolded, files actually removed
- [ ] 1.11 Wire the existing `jj-routes.ts` to delegate to `fold-back.ts`, `workspace-forget.ts`, and the modified inline `add` handler; register a job-id allocator + progress dispatcher that publishes `jj:fold-back-progress` events to the WS gateway. Keep all routes in `jj-routes.ts` (do not split into the plugin package).
- [ ] 1.12 Add integration test exercising `POST /api/jj/workspace/fold-back` against a temp jj-colocated repo: full happy path, full preflight-failure paths, full conflict + rollback path

## 2. WebSocket progress event contract

- [ ] 2.1 Add `jj:fold-back-progress` to the plugin-namespaced WS message types in `packages/jj-plugin/src/shared/`
- [ ] 2.2 Wire the dashboard's browser WS gateway to forward plugin-namespaced events scoped by originating browser (correlation by `jobId`); reuse existing `subscribe`/`broadcast` plumbing — no new transport
- [ ] 2.3 Confirm via test that browser A receives every event for its own job and zero events for browser B's job

## 3. Client-local dialog components (added but not yet wired)

- [ ] 3.1 Define WS event-payload types in `packages/jj-plugin/src/shared/ws-events.ts`: `JjFoldBackProgressEvent = { type: "jj:fold-back-progress"; jobId: string; phase: "preflight" | "bookmark" | "rebase" | "push" | "done"; status: "started" | "ok" | "error"; data?: unknown }`. No PromptBus prompt-types; PromptBus is not used (see design Decision 3).
- [ ] 3.2 Create `packages/jj-plugin/src/client/dialogs/JjWorkspaceCreateDialog.tsx` — controlled dialog (open/close via parent state); name input with `/^[a-z0-9-]+$/` validation, submit → `POST /api/jj/workspace/add` with `{ fromCwd, name, sessionId }`, render error code copy.
- [ ] 3.3 Create `packages/jj-plugin/src/client/dialogs/JjFoldBackProgressDialog.tsx` — controlled dialog; on open, POST `/api/jj/workspace/fold-back` to obtain `jobId`, subscribe to `jj:fold-back-progress` via `usePluginContext()` filtered by `jobId`, render phase-by-phase status, render structured error copy (esp. `DIRTY_INDEX` actionable text).
- [ ] 3.4 Create `packages/jj-plugin/src/client/dialogs/JjForgetConfirmDialog.tsx` (rewrite of existing component) — receives `unfolded` commit list from parent, lists them, on confirm re-POSTs `forget` with `force: true`.
- [ ] 3.5 Export the three dialogs from `packages/jj-plugin/src/client/index.tsx` so `JjActionBar` can import them. No registration in `prompt-component-registry` (it's for bridge-originated PromptBus prompts only).
- [ ] 3.6 Add component tests for each dialog covering happy path, validation, error rendering, and (for fold-back) progress event subscription + render.

## 4. Re-wire JjActionBar to new dialogs

- [ ] 4.1 Replace `+ Workspace` handler in `packages/jj-plugin/src/client/JjActionBar.tsx`: remove `window.prompt`; add `[workspaceCreateOpen, setWorkspaceCreateOpen]` state; mount `<JjWorkspaceCreateDialog open={workspaceCreateOpen} onClose={...} fromCwd={session.cwd} sessionId={session.id} />`.
- [ ] 4.2 Replace `Fold back` handler: replace the old `<JjFoldBackDialog />` (clipboard model) with `<JjFoldBackProgressDialog open={foldBackOpen} onClose={...} workspaceName={...} cwd={session.cwd} />` (POST + WS-progress model).
- [ ] 4.3 Replace `Forget` handler: keep first POST; on `409 UNFOLDED_WORK` set local `forgetConfirm = { workspaceName, unfolded }` state and mount the rewritten `<JjForgetConfirmDialog />` reading from that state. Same control flow as before; only the dialog implementation changes.
- [ ] 4.4 Update `packages/jj-plugin/src/__tests__/JjActionBar.test.tsx` to assert the new dialogs mount with the expected props on each button click, and that the `forget` flow opens the confirm dialog only after the 409 response.

## 5. Delete dead code

- [ ] 5.1 Delete the original `packages/jj-plugin/src/client/JjFoldBackDialog.tsx` (clipboard-skill model). The replacement lives at `packages/jj-plugin/src/client/dialogs/JjFoldBackProgressDialog.tsx`.
- [ ] 5.2 Delete the original `packages/jj-plugin/src/client/JjForgetConfirmDialog.tsx`. The replacement lives at `packages/jj-plugin/src/client/dialogs/JjForgetConfirmDialog.tsx`.
- [ ] 5.3 Delete `buildFoldBackPrompt` (search workspace, remove all callers and the helper itself).
- [ ] 5.4 Delete `packages/jj-plugin/src/__tests__/JjFoldBackDialog.test.tsx` after confirming new dialog tests cover its assertions.
- [ ] 5.5 Run `tsc -b` and full test suite; fix any orphan imports flagged by the compile

## 6. Skill rewrite

- [ ] 6.1 Move existing `.pi/skills/jj-workspace-fold-back/SKILL.md` body to `.pi/skills/jj-workspace-fold-back/legacy-bash/fold-back.sh` (extract the bash, add a header comment explaining when to use it)
- [ ] 6.2 Rewrite `.pi/skills/jj-workspace-fold-back/SKILL.md` as a one-paragraph pointer: name the endpoint, list required args, list refusal codes verbatim, reference `legacy-bash/fold-back.sh` as fallback
- [ ] 6.3 Update the "Shipping work back to trunk" section in `.pi/skills/jj-workspace/SKILL.md` to point at the endpoint
- [ ] 6.4 Verify both skill files via `openspec` skill spec check (no executable bash flow remains in SKILL.md bodies)

## 7. Documentation

- [ ] 7.1 Update `docs/file-index-plugins.md`: amend the `packages/jj-plugin/` row to mention server-driven fold-back, client-local dialogs, WS progress events; add new file rows for `fold-back.ts`, `workspace-forget.ts`, `preflight.ts`, the three new dialog components under `client/dialogs/`, and the shared `error-codes.ts` / `ws-events.ts` files. Note: routes stay in `packages/server/src/routes/jj-routes.ts` (no new file there).
- [ ] 7.2 Update `docs/architecture.md` (or add a new section) documenting the plugin → server-endpoint → WS-progress flow as the canonical pattern for plugin-driven server operations with multi-phase UX
- [ ] 7.3 Update `docs/research/openspec-jj-bridge.md` to mark Decision 5 reversed and reference this change
- [ ] 7.4 Add a row to `AGENTS.md` "Key Files" only if `packages/jj-plugin/src/server/fold-back.ts` becomes architecturally backbone — otherwise leave AGENTS.md alone (per Documentation Update Protocol)

## 8. Validation and rollout

- [ ] 8.1 Manual end-to-end: spin up dashboard, create a temp jj-colocated repo, click `+ Workspace`, verify session respawns into workspace cwd with conversation history intact
- [ ] 8.2 Manual end-to-end: click `Fold back`, verify dialog shows phase progression and final commit + remote branch
- [ ] 8.3 Manual end-to-end: induce a rebase conflict, verify dialog surfaces conflict + restored state, workspace `@` matches pre-rebase
- [ ] 8.4 Manual end-to-end: stage a file with `git add`, verify `Fold back` refuses with `DIRTY_INDEX` and shows the actionable copy
- [ ] 8.5 Manual end-to-end: with two sessions in same repo, fold-back from one, verify only the originating browser receives progress events
- [ ] 8.6 Run `openspec validate jj-plugin-server-driven-flows` — must pass
- [ ] 8.7 Run full test suite (`npm test`) — must pass with zero failures
- [ ] 8.8 Run `npm run reload:check` — must type-check + reload all pi sessions cleanly
