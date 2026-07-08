# Tasks

## 1. Shared protocol + types (test-first)

- [ ] 1.1 In `packages/shared/src/protocol.ts`, add `isGitRepo?: boolean` to the `session_register` message interface and to `DashboardSession`. JSDoc: tri-state — `true` confirmed repo, `false` confirmed non-git, `undefined` unknown.
- [ ] 1.2 In `packages/shared/src/session-meta.ts`, add `isGitRepo?: boolean` to `SessionMeta` with the same tri-state JSDoc and a `See change:` note.
- [ ] 1.3 Unit test the `SessionMeta` round-trip (`mergeSessionMeta` preserves `isGitRepo`) in the existing session-meta test file.

## 2. Bridge detection

- [ ] 2.1 In `packages/extension/src/vcs-info.ts`, add `export function detectIsGitRepo(cwd: string): boolean | undefined`. Call `git.isGitRepo({ cwd })` (the `Result` variant, NOT `isGitRepoOr`). Map: `ok` → `res.value`; `error` with `kind === "exit" && code === 128` → `false`; any other error → `undefined`. JSDoc states the tri-state contract and why `undefined` (not `false`) on inconclusive probe.
- [ ] 2.2 Unit test `detectIsGitRepo` in `packages/extension/src/__tests__/` (locate the vcs-info test via `grep -rln "detectBranch\|gatherGitInfo" packages/extension/src/__tests__`). Mock the runner to return: ok-true → `true`; ok-false → `false`; exit-128 error → `false`; spawn/timeout error → `undefined`. Confirm tests fail before 2.1.
- [ ] 2.3 In the bridge register path (`packages/extension/src/session-sync.ts` — locate the `session_register` send, and `model-tracker.ts` for the reconnect state-sync), attach `isGitRepo: detectIsGitRepo(cwd)` to the `session_register` payload. Refresh it alongside `git_info_update` if cheap; register is the authority.

## 3. Server persistence

- [ ] 3.1 In `packages/server/src/event-wiring.ts` `session_register` handler, set `isGitRepo` on the in-memory session (when the message carries it) and persist via the existing `mergeSessionMeta`/`writeSessionMeta` path used for other register-time meta fields. In the `git_info_update` handler, refresh `isGitRepo` when present.
- [ ] 3.2 In `packages/server/src/session-scanner.ts` `sessionFromMeta`, restore `isGitRepo: meta.isGitRepo` (mirrors the `unread` / `gitWorktree` restore lines).
- [ ] 3.3 Contract test in the server event-wiring / scanner test suite: a `session_register` with `isGitRepo: false` persists to `.meta.json`; a cold `sessionFromMeta` with `meta.isGitRepo === false` yields `session.isGitRepo === false`; absent field → `undefined`.

## 4. Client gate

- [ ] 4.1 In `packages/client/src/components/SessionCard.tsx`, extend the `+Worktree` render gate to `onSpawnWorktree && !session.gitWorktree && session.isGitRepo !== false && (`. Update the adjacent comment + `See change:`.
- [ ] 4.2 In `packages/client/src/components/SessionList.tsx`, change `FolderSpawnButtons` `showWorktree` to `group.sessions.some((s) => s.isGitRepo !== false) && gitWorktreeEnabled && !!onSpawnSession`.
- [ ] 4.3 Client tests: `+Worktree` ABSENT when `isGitRepo === false`; PRESENT when `isGitRepo === true`; PRESENT when `isGitRepo === undefined` (legacy / unknown — no regression). Same three cases for the folder-header button.

## 5. Documentation

- [ ] 5.1 Update the per-file `AGENTS.md` rows for the touched files (`vcs-info.ts`, `protocol.ts`, `session-meta.ts`, `SessionCard.tsx.AGENTS.md`, `session-scanner` dir, `event-wiring` dir) noting the `isGitRepo` tri-state + `See change: gate-session-worktree-button-on-git`. Caveman style. (Non-`docs/` tree rows — edit directly.)

## 6. Verification

- [ ] 6.1 `npm test 2>&1 | tee /tmp/pi-test.log`; `grep -nE 'FAIL|✗' /tmp/pi-test.log` clean across shared / extension / server / client.
- [ ] 6.2 `npx openspec validate gate-session-worktree-button-on-git --strict`.
- [ ] 6.3 Manual smoke (client + server + bridge changed ⇒ full rebuild: `npm run build`, `curl -X POST /api/restart`, `npm run reload`): (a) session in a non-git folder → `+Worktree` absent on card AND folder header; (b) session in a git repo → present; (c) restart the server, DON'T reconnect the bridge, reload an ended git-repo session → `+Worktree` still present (isGitRepo restored from meta); (d) a git repo on a slow mount whose probe times out → `isGitRepo` undefined → button still present (no regression).
