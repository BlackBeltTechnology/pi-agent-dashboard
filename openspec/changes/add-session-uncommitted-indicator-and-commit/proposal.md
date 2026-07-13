## Why

A session card shows the session's git branch / PR / worktree, but gives **no signal that the working tree has uncommitted changes**. A user watching an agent work has no way to tell — from the card — that the agent produced edits that are not yet committed, nor how far the branch has drifted from its upstream. To commit, they must leave the dashboard for a terminal or editor.

This change surfaces the working-tree state **on the card** and lets the user commit **from the card** — with an AI-drafted, editable commit message generated from the session's own context. For an agent dashboard, "the agent changed these files → review → commit, with a message written from the conversation that produced the change" is a natural, high-value loop that currently has no home in the UI.

## What Changes

- **NEW** — dirty / drift indicator, rendered on **whichever git surface the shell already shows** (see Placement below):
  - `● N` amber pill = N uncommitted files (staged + unstaged + untracked).
  - `↑A ↓B` = commits ahead / behind upstream (shown only when non-zero).
  - Pill is a button → opens the Commit dialog. Hidden when the tree is clean and in sync.
- **NEW** — `CommitDialog.tsx`: a file-picker (per-file checkbox + `+adds/−dels`), a subject+body message field, an **AI draft** button, and Commit / Cancel.
- **NEW** — AI-drafted commit message via an **ephemeral in-process fork-subagent** (see `design.md`): the bridge seeds a throwaway `AgentSession` with the live session's full context (`buildSessionContext()`) + the staged diff, prompts once for a conventional-commit message, returns it, and discards the subagent. **The visible conversation gets no turn — zero pollution.** Documented fallbacks: compressed `inheritContext`, then raw diff-only one-shot.
- **NEW** — session status shape on `DashboardSession`: `gitStatus?: { dirtyCount, staged, unstaged, untracked, ahead, behind }`.
- **NEW** — data delivery is **hybrid**, keyed by cwd (not by session): the bridge's existing 30 s VCS tick broadcasts `gitStatus` via `git_info_update` (no new polling loop) for solo/worktree cards; the **folder header** reads its count from the existing server-side folder-head poll (`folderGitMap`) so N sessions in one cwd don't each carry a redundant status. A new `GET /api/git/status?cwd=` gives an on-demand fresh read when a card/folder is focused/expanded and immediately after a commit.
- **NEW** — server routes: `GET /api/git/status`, `POST /api/git/commit` (`{ cwd, message, files[] }`), `POST /api/git/commit-draft` (relays the `git_commit_draft` bridge command and returns the drafted message).
- **NEW** — git operations: `getGitStatus(cwd)` and `commitFiles({ cwd, message, files })` in `git-operations.ts` (argv-based, no shell interpolation of the message).
- **NEW** — bridge command `git_commit_draft` (request/response with `requestId`) in a self-contained `commit-draft.ts` module.

### Placement — one working tree, one git surface

The indicator + commit must attach to the surface the shell **already** renders, never duplicated per card:

| Case | Existing git surface | Indicator + Commit host |
|---|---|---|
| 1 session in a folder | per-card `GitInfo` (GIT subcard) | the card |
| **2+ non-worktree sessions, same cwd** | **folder header `GroupGitInfo`** (per-card git block is suppressed by `showGitInfo={group.sessions.length === 1}`) | **the folder header** |
| worktree session | per-card `GitInfo` (its own cwd) | the card |

Sessions sharing a cwd share one working tree — branch, dirty count, and ahead/behind are identical for all of them. Rendering the pill per card would be redundant and could flicker conflicting transient values. Committing is therefore a **folder-level** action for grouped sessions: one shared tree = one commit (the file picker disambiguates what is staged). A per-card Commit in that case would falsely imply independent commits when every card commits the same pooled changes.

### Scope (v1)

- Placement: indicator + commit follow the existing git surface — per-card `GitInfo` for solo/worktree sessions, folder-header `GroupGitInfo` for grouped same-cwd sessions.
- Commit scope: **file picker** (stage a chosen subset), not commit-all.
- Indicator includes **ahead/behind** (unpushed commits), not only working-tree dirtiness.
- Out of scope: push/PR from the dialog (existing `pushBranch` / PR flows already cover that), hunk-level staging, amend, sign-off.

## Capabilities

### New Capabilities

- `session-uncommitted-indicator` — the card surfaces uncommitted-file count and ahead/behind drift, sourced hybrid (bridge broadcast + on-demand refresh).
- `session-commit-action` — commit a chosen subset of changed files from the card with an AI-draftable, editable message.

### Modified Capabilities

- `git-info-display` (if a spec exists at extraction time) — gains the dirty/drift pill.

## Coordination with `extract-git-as-plugin`

`extract-git-as-plugin` (proposal-only, no `tasks.md`, not implemented) plans to **move** `GitInfo`, `git-operations.ts`, and `git-routes.ts` into `packages/git-plugin/`. This change lands on exactly those files. Decision (user-confirmed): **build in core now, keep every new artifact self-contained and plugin-ready** (`CommitDialog.tsx`, `commitFiles`/`getGitStatus`, `commit-draft.ts`, the new routes) so a later `git mv` is clean. Both proposals must cross-reference: **the git-plugin extraction MUST carry the commit feature along.** A cross-reference note is added to `extract-git-as-plugin/proposal.md` under this change.

## Discipline Skills

- `security-hardening` — the commit endpoint and bridge command construct `git` invocations from a user/AI-supplied message and a client-supplied file list; must use argv/`execFile` (no shell), validate `cwd`, and path-guard the file list.
- `observability-instrumentation` — new endpoints + a new bridge request/response command; needs structured logging and failure surfacing (draft timeout, commit failure, non-git cwd).
- `doubt-driven-review` — `git commit` is a state mutation; review the staging + argv construction before it stands.

## Impact

- `packages/shared/src/types.ts` — add `gitStatus` to `DashboardSession`.
- `packages/shared/src/rest-api.ts` — response types for status / commit / commit-draft.
- `packages/extension/src/vcs-info.ts` — gather status counts (`git status --porcelain=v2 --branch`).
- `packages/extension/src/session-sync.ts` / `model-tracker.ts` — include `gitStatus` in `git_info_update` dedup + payload.
- `packages/extension/src/commit-draft.ts` — NEW fork-subagent draft command.
- `packages/extension/src/command-handler.ts` — register the `git_commit_draft` case.
- `packages/server/src/git-operations.ts` — `getGitStatus`, `commitFiles`.
- `packages/server/src/routes/git-routes.ts` — three new routes.
- `packages/client/src/components/SessionCard.tsx` (`GitInfo` **and** `GroupGitInfo`) — dirty/drift pill + Commit button on both surfaces.
- `packages/client/src/components/SessionList.tsx` — pass folder-level status/commit props into the `GroupGitInfo` folder header; source the folder count from the existing folder-head poll (`folderGitMap`) rather than a child session's `gitStatus`.
- `packages/client/src/components/CommitDialog.tsx` — NEW.
- `packages/client/src/lib/git-api.ts` (or equivalent) — client fetch helpers.
- Tests: `git-operations`, `vcs-info`, `CommitDialog`, route handlers.
- `docs/architecture.md` — Git section: status broadcast + commit flow.

## Mockups

See [`mockups/index.html`](mockups/index.html) — theme-tokened, matches the real dashboard card. Panels: (1) indicator states on the card (clean / dirty / ahead-behind / mixed), (2) the Commit dialog with file-picker + AI-draft states (idle → drafting → drafted/editable), (3) mobile layout. Preview with `serve_mockup`.

## References

- Card surface: `packages/client/src/components/SessionCard.tsx` (`GitInfo`, `GitSubcard`).
- Existing git ops: `packages/server/src/git-operations.ts` (`getDirtyFiles`, `pushBranch`).
- Bridge VCS tick: `packages/extension/src/git-poll.ts`, `vcs-info.ts`.
- SDK for the fork-subagent: `node_modules/@earendil-works/pi-coding-agent/docs/sdk.md` (`createAgentSession`, `SessionManager.inMemory`, `buildSessionContext`).
- Coordination: `openspec/changes/extract-git-as-plugin/proposal.md`.
