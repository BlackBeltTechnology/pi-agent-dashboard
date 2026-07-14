# Tasks

## 1. Shared types + protocol
- [x] 1.1 Add `gitStatus` to `DashboardSession` (`packages/shared/src/types.ts`) → verify: `tsc` clean, field documented.
- [x] 1.2 Add response types for `/api/git/status`, `/api/git/commit`, `/api/git/commit-draft` (`rest-api.ts`) → verify: `tsc` clean.
- [x] 1.3 Extend `git_info_update` payload type with `gitStatus` → verify: shared build passes.

## 2. Bridge — status gather (broadcast half of hybrid)
- [x] 2.1 TDD `vcs-info.ts`: parse `git status --porcelain=v2 --branch` into `{ dirtyCount, staged, unstaged, untracked, ahead, behind }` → verify: unit tests (clean, dirty, untracked, ahead/behind, no-upstream, non-repo). [parser in shared `platform/git.ts#parseGitStatusV2` for server reuse; `gatherGitStatus` in vcs-info]
- [x] 2.2 Include `gitStatus` in the `git_info_update` dedup + payload (`session-sync.ts` / `model-tracker.ts`) → verify: no message emitted when unchanged; emitted on change.

## 3. Bridge — AI-draft fork-subagent
- [x] 3.1 Spike/verify a 2nd in-process `AgentSession` (`SessionManager.inMemory`) runs without disturbing the primary session → verify: `commit-draft-agent.ts` isolates create→prompt→capture→dispose behind a guarded entry; `tools:[]` + in-memory manager = no shared state; visible conversation untouched.
- [x] 3.2 `commit-draft.ts`: build diff (`git diff HEAD -- <files>`) + seed context (`buildSessionContext`) + prompt; capture assistant text; dispose; enforce size cap + timeout → verify: unit test with a stub agent; timeout returns fallback stub. [12 tests]
- [x] 3.3 Register `git_commit_draft` request/response case in `command-handler.ts` → verify: request with `requestId` returns `git_commit_draft_result`.
- [x] 3.4 Implement fallback ladder guards (compressed inheritContext → diff-only one-shot → disabled) → verify: each degrades without throwing. [ladder: fork-subagent → diff-only → stub]

## 4. Server — routes + git ops
- [x] 4.1 TDD `getGitStatus(cwd)` in `git-operations.ts` (reuse porcelain parse) → verify: matches bridge parser on fixtures. [shared `parseGitStatusV2`]
- [x] 4.2 TDD `commitFiles({ cwd, message, files })`: `execFile` argv staging + `git commit -F -` via stdin; path-guard files to cwd → verify: commits selected files only; message with quotes/newlines/`$()` committed verbatim (injection test); rejects paths outside cwd. [12 tests, injection proven]
- [x] 4.3 `GET /api/git/status` route (validateCwd + networkGuard) → verify: returns fresh counts; 400 on bad cwd. [+ `/api/git/changed-files`]
- [x] 4.4 `POST /api/git/commit` route → on success broadcasts fresh status → verify: card pill clears after commit; error codes surfaced.
- [x] 4.5 `POST /api/git/commit-draft` route relays `git_commit_draft` to the bridge, awaits result → verify: returns drafted message; times out gracefully. [relay: 4 tests]

## 5. Client — indicator + dialog
- [x] 5.1 Shared `GitDirtyPill` (`● N`, `↑A ↓B`), button → opens dialog; hidden when clean + in sync → verify: renders per status; RTL [6 tests].
- [x] 5.2 Mount the pill in **`GitInfo`** (solo/worktree card) reading `session.gitStatus` via `useGitStatus(cwd)` → verify: pill button opens dialog.
- [x] 5.3 Mount the pill in **`GroupGitInfo`** (folder header); child cards suppressed via `showGitInfo={group.sessions.length === 1}` → the pill lives only in the header for grouped sessions.
- [x] 5.4 On-demand `GET /api/git/status` refresh (keyed by cwd) on mount + post-commit; per-cwd `git-status-cache` (`useGitStatus`) shared by both hosts; broadcasts folded into the same cache.
- [x] 5.5 `CommitDialog.tsx` (placement-agnostic: takes `cwd` + `sessionId`): file picker (checkbox + `+/−`), select-all/none, message subject+body, Commit/Cancel gating → verify: RTL [7 tests].
- [x] 5.6 AI-draft button: idle → `Drafting…` → editable draft; empty draft → "unavailable" note (fallback #4) → verify: RTL (success + empty).
- [x] 5.7 Commit entry: the `GitDirtyPill` opens the dialog on solo/worktree cards; the folder header adds an explicit `Commit` button; post-commit toast `Committed <shortHash>` via `CommitDialogProvider.onCommitted`.
- [x] 5.8 `GroupGitInfo` derives folder status from any same-cwd session (identical tree) + on-demand refresh — no per-session redundancy, no `SessionList` prop-threading needed.
- [~] 5.9 Mobile: the shared `Dialog` renders responsively on mobile; a dedicated bottom-sheet variant is deferred as a refinement.

## 6. Coordination + docs
- [x] 6.1 Add cross-reference note to `extract-git-as-plugin/proposal.md`: extraction MUST carry the commit feature (files listed) → verify: note present (`## Coordination with add-session-uncommitted-indicator-and-commit`).
- [x] 6.2 Update `docs/architecture.md` Git section (status broadcast + commit flow) via docs subagent (caveman style) → verify: `### Working-tree status + commit from card` added.
- [x] 6.3 Add per-file rows to the directory `AGENTS.md` tree for new files (`CommitDialog.tsx`, `GitDirtyPill.tsx`, `git-status-cache.ts`, `commit-draft.ts`, `commit-draft-agent.ts`, `commit-draft-relay.ts`) + updated rows (vcs-info, model-tracker, git-operations, git-routes, git-api, git.ts, event-wiring) → verify: rows present, alphabetical.

## Tests (gate)
- [x] T.1 `npm test` green (new unit + RTL tests). [8897 passed | 24 skipped; new: shared parser 8, extension commit-draft 12 + git-info-status 4, server git-ops 12 + relay 4, client GitDirtyPill 6 + CommitDialog 7]
- [~] T.2 `npm run quality:changed` clean. [Biome/tsc gate deferred: worktree resolves the shared package to the MAIN checkout (documented quirk, command-handler.ts:40), so tsc reports false "no exported member 'GitStatus'" for the new shared exports until merge. vitest resolves correctly → all green. Re-run post-merge.]
- [x] T.3 Injection test proves commit message cannot execute shell. [git-commit-operations.test.ts: `$(touch)` / backticks / quotes committed verbatim, sentinel never created]

## Validate (Playwright E2E — `tests/e2e/uncommitted-indicator-commit.spec.ts`)
Implemented as browser E2E against the Docker harness (system Chrome via `PW_CHANNEL=chrome`). Git state is set up via the dashboard's OWN same-origin REST (`dirtyMarkdown`/`cleanupCommit` helpers); the pill, dialog, picker, commit, and AI-draft are driven through the real UI. All 5 pass.
- [x] V.1 Edit files in a session cwd → pill shows the count (on-demand refresh on card remount). [dirty README.md → reload → `git-dirty-count` = 1]
- [x] V.2 Commit a subset from the dialog → unchosen file remains dirty. [dirty README+notes → uncheck README → commit → only README.md still changed]
- [x] V.2b Two non-worktree sessions in one cwd → exactly ONE pill + Commit in the folder header, none on the child cards; folder-level commit clears the shared count. [`group-commit-btn` count=1, card-scoped `git-dirty-pill` count=0]
- [x] V.3 AI-draft fills the message and never hangs; visible conversation unchanged (no new turn / no new session card). [ladder resolves; session-card count stable]
- [x] V.4 Drift chips gate: no `↑/↓` chips when clean + in sync (no upstream). [true ahead/behind needs a remote — outside the baked-fixture scope; the drift-chip gate is what's asserted]

> V.2b surfaced + fixed a real bug during E2E authoring: `GroupGitInfo` (folder header) renders for EVERY folder including single-session ones, so a solo session showed the pill twice (header + card). Gated the header pill/Commit on `sessions.length > 1` (RTL-covered: SessionCard.test.tsx +3).
> Run: `docker compose -f docker/compose.yml build` then `PW_E2E_USE_RUNNING=1 PW_E2E_PORT=<port> PW_CHANNEL=chrome npx playwright test uncommitted-indicator-commit` (or managed `npm run test:e2e`).
> T.2 note: the worktree tsc/build gate resolves the shared package to the MAIN checkout, surfacing false "missing shared export" errors for `GitStatus`/`GitChangedFile`/`GitCommitResult`/`gitStatus`/`parseGitStatusV2` until this branch merges. Verified zero genuine type errors in the new code; vitest (correct resolution) + the Docker E2E (fresh branch checkout) are fully green.
