# Tasks

## 1. Shared types + protocol
- [ ] 1.1 Add `gitStatus` to `DashboardSession` (`packages/shared/src/types.ts`) → verify: `tsc` clean, field documented.
- [ ] 1.2 Add response types for `/api/git/status`, `/api/git/commit`, `/api/git/commit-draft` (`rest-api.ts`) → verify: `tsc` clean.
- [ ] 1.3 Extend `git_info_update` payload type with `gitStatus` → verify: shared build passes.

## 2. Bridge — status gather (broadcast half of hybrid)
- [ ] 2.1 TDD `vcs-info.ts`: parse `git status --porcelain=v2 --branch` into `{ dirtyCount, staged, unstaged, untracked, ahead, behind }` → verify: unit tests (clean, dirty, untracked, ahead/behind, no-upstream, non-repo).
- [ ] 2.2 Include `gitStatus` in the `git_info_update` dedup + payload (`session-sync.ts` / `model-tracker.ts`) → verify: no message emitted when unchanged; emitted on change.

## 3. Bridge — AI-draft fork-subagent
- [ ] 3.1 Spike/verify a 2nd in-process `AgentSession` (`SessionManager.inMemory`) runs without disturbing the primary session → verify: manual run drafts a message; primary conversation gets no new turn.
- [ ] 3.2 `commit-draft.ts`: build diff (`git diff HEAD -- <files>`) + seed context (`buildSessionContext`) + prompt; capture assistant text; dispose; enforce size cap + timeout → verify: unit test with a stub agent; timeout returns fallback stub.
- [ ] 3.3 Register `git_commit_draft` request/response case in `command-handler.ts` → verify: request with `requestId` returns `git_commit_draft_result`.
- [ ] 3.4 Implement fallback ladder guards (compressed inheritContext → diff-only one-shot → disabled) → verify: each degrades without throwing.

## 4. Server — routes + git ops
- [ ] 4.1 TDD `getGitStatus(cwd)` in `git-operations.ts` (reuse porcelain parse) → verify: matches bridge parser on fixtures.
- [ ] 4.2 TDD `commitFiles({ cwd, message, files })`: `execFile` argv staging + `git commit -F -` via stdin; path-guard files to cwd → verify: commits selected files only; message with quotes/newlines/`$()` committed verbatim (injection test); rejects paths outside cwd.
- [ ] 4.3 `GET /api/git/status` route (validateCwd + networkGuard) → verify: returns fresh counts; 400 on bad cwd.
- [ ] 4.4 `POST /api/git/commit` route → on success broadcasts fresh status → verify: card pill clears after commit; error codes surfaced.
- [ ] 4.5 `POST /api/git/commit-draft` route relays `git_commit_draft` to the bridge, awaits result → verify: returns drafted message; times out gracefully.

## 5. Client — indicator + dialog
- [ ] 5.1 Shared `GitDirtyPill` (`● N`, `↑A ↓B`), button → opens dialog; hidden when clean + in sync → verify: renders per status; snapshot/RTL states.
- [ ] 5.2 Mount the pill in **`GitInfo`** (solo/worktree card) reading `session.gitStatus` → verify: RTL on a single-session card.
- [ ] 5.3 Mount the pill in **`GroupGitInfo`** (folder header) reading the folder-head status; NOT duplicated on the suppressed child cards → verify: RTL — 2+ same-cwd sessions show ONE pill in the header, none on the cards.
- [ ] 5.4 On-demand `GET /api/git/status` refresh (keyed by cwd) on card/folder focus/expand + post-commit; per-cwd cache shared by both hosts → verify: fresh count after external change; header + solo card at same path share one cache entry.
- [ ] 5.5 `CommitDialog.tsx` (placement-agnostic: takes `cwd` + files): file picker (checkbox + `+/−`), select-all/none, message subject+body, Commit/Cancel gating → verify: RTL — commit disabled until ≥1 file + subject; identical launched from card or header.
- [ ] 5.6 AI-draft button: idle → `Drafting…` → editable draft; re-draftable; disabled on fallback #4 → verify: RTL with mocked draft endpoint (success, timeout, error).
- [ ] 5.7 Commit button in **`GitSubcard`** and in the **`GroupGitInfo`** action row; both call `openCommitDialog(cwd)`; post-commit toast `Committed <shortHash>` → verify: RTL both hosts.
- [ ] 5.8 `SessionList.tsx`: thread folder-level status + `openCommitDialog` into `GroupGitInfo` → verify: grouped folder header shows pill + Commit; solo card path unchanged.
- [ ] 5.9 Mobile bottom-sheet dialog variant → verify: RTL mobile render.

## 6. Coordination + docs
- [ ] 6.1 Add cross-reference note to `extract-git-as-plugin/proposal.md`: extraction MUST carry the commit feature (files listed) → verify: note present.
- [ ] 6.2 Update `docs/architecture.md` Git section (status broadcast + commit flow) via docs subagent (caveman style) → verify: section added.
- [ ] 6.3 Add per-file rows to the directory `AGENTS.md` tree for new files (`CommitDialog.tsx`, `commit-draft.ts`) → verify: rows present, alphabetical.

## Tests (gate)
- [ ] T.1 `npm test` green (new unit + RTL tests).
- [ ] T.2 `npm run quality:changed` clean.
- [ ] T.3 Injection test proves commit message cannot execute shell.

## Validate (manual / QA)
- [ ] V.1 Live: edit files in a session cwd → pill shows count within 30 s (broadcast) and instantly on card focus (on-demand).
- [ ] V.2 Commit a subset from the dialog → pill decrements, unchosen files remain dirty.
- [ ] V.2b Two non-worktree sessions in one cwd → exactly ONE pill + Commit in the folder header, none on the child cards; committing there updates the shared count for both.
- [ ] V.3 AI-draft produces a sensible conventional-commit message; visible conversation unchanged (no new turn).
- [ ] V.4 Ahead/behind chips reflect `↑/↓` after commit / fetch.
