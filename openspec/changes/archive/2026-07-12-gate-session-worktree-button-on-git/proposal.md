## Why

The session-card `+Worktree` button is offered in folders that are not git repositories, where `git worktree add` cannot succeed. The obvious one-line fix — gate on `session.gitBranch` — is **unsound** (rejected in doubt review). `gitBranch` is a *data-arrival* signal, not a *is-a-git-repo* signal:

- It is set **only** by the `git_info_update` bridge message (`event-wiring.ts:1141`), which arrives *after* `session_register` → new-session render race, button flickers.
- `gatherGitInfo()` returns `undefined` on any git probe failure (timeout ≥15s, missing binary, permissions) → a real git repo gets a falsy `gitBranch`.
- `SessionMeta` has **no** `gitBranch` field and `sessionFromMeta` never restores it → after a server restart every cold/ended session in a real git repo would **permanently** lose the button.

The correct fix needs a signal that (1) is arrival-independent (carried on `session_register`, no race), (2) survives restarts (persisted in `.meta.json`), and (3) distinguishes *confirmed non-git* from *unknown* so a failed probe never hides the button for a real repo.

## What Changes

- Add a **tri-state** `isGitRepo?: boolean` signal: `true` = confirmed git repo, `false` = confirmed non-git, `undefined` = unknown (probe inconclusive / legacy).
- The bridge computes it from `git rev-parse --is-inside-work-tree` via the existing `git.isGitRepo()` `Result`:
  - `ok` → the boolean value (`true` / `false`);
  - `error kind:"exit" code:128` → `false` (git ran, definitively not a repo);
  - any other error (spawn ENOENT, timeout, signal) → leave `undefined` (unknown — never a false negative).
- The bridge includes `isGitRepo` in the **`session_register`** payload (synchronous at register → no flicker), and refreshes it on `git_info_update`.
- The server persists `isGitRepo` to `.meta.json` and `sessionFromMeta` restores it → survives restart for cold/ended sessions.
- The session-card `+Worktree` button (and, for consistency, the folder-header `+Worktree` button) is hidden **only on `isGitRepo === false`** — confirmed non-git. Unknown (`undefined`) keeps today's show behavior, so no git repo ever loses the button.

Precedence rationale: hide only on positive non-git confirmation. This is the direct encoding of the doubt-review lesson — *unknown ≠ non-git*.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `git-context`: add a persistent, arrival-independent `isGitRepo` tri-state carried on `session_register`, persisted in `.meta.json`, restored on cold start.
- `session-card-subcards`: the "+Worktree button on session card" requirement gains a `isGitRepo !== false` precondition (hide only on confirmed non-git), replacing the unsound `gitBranch` idea.

## Impact

- **Code**:
  - `packages/shared/src/protocol.ts` — `isGitRepo?: boolean` on the `session_register` message and on `DashboardSession`.
  - `packages/shared/src/session-meta.ts` — `isGitRepo?: boolean` on `SessionMeta`.
  - `packages/extension/src/vcs-info.ts` — new `detectIsGitRepo(cwd): boolean | undefined` (tri-state via `git.isGitRepo()` Result + exit-128 discrimination); the bridge register path (`session-sync.ts` / `model-tracker.ts`) attaches it to `session_register`.
  - `packages/server/src/event-wiring.ts` — `session_register` handler stores `isGitRepo` on the session + persists via existing `mergeSessionMeta`/`writeSessionMeta`; `git_info_update` refreshes it.
  - `packages/server/src/session-scanner.ts` — `sessionFromMeta` restores `meta.isGitRepo`.
  - `packages/client/src/components/SessionCard.tsx` — button gate adds `&& session.isGitRepo !== false`.
  - `packages/client/src/components/SessionList.tsx` — folder-header `showWorktree` uses `group.sessions.some((s) => s.isGitRepo !== false)` in place of the `gitBranch` heuristic.
- **Migration**: none. All new fields optional. Legacy `.meta.json` lacks `isGitRepo` → `undefined` → lenient show (== today).
- **Compatibility**: older bridge (no `isGitRepo` on register) → `undefined` → show; older server ignores the field; older client ignores it. Forward/backward compatible.
- **Rollback**: revert the client gate for immediate UI rollback; the plumbing is additive and inert if unused.

## Discipline Skills

- `doubt-driven-review` — already applied; disproved the naive `gitBranch` gate and drove this design.
- `systematic-debugging` — if the tri-state misbehaves across the bridge→server→meta→client path, trace each hop with a single session.
