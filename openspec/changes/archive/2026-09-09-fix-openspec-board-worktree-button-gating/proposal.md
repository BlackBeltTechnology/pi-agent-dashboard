# Fix OpenSpec board `New worktree` button gating

## Why

The board's `New worktree` card action silently disappears whenever no **live** session happens to sit in the board's own cwd. The gate is derived per-render from session liveness:

```js
// packages/client/src/App.tsx:1712
isGitRepo={Array.from(sessions.values())
  .some((s) => s.cwd === openspecBoardCwd && !!s.gitBranch)}
```

`gitBranch` is populated only for non-ended sessions (the folder-HEAD poll work-set is `pinned dirs ∪ non-ended session cwds`). So the moment every session in the main checkout ends — and all live work moved into `.worktrees/...` — the board decides the repo "is not a git repo" and every card loses its worktree button. That is exactly the reported symptom: the button was there yesterday and gone today, with nothing about the repo having changed.

Three defects converge here:

1. **Liveness leak.** "Is this folder a git repo?" is a static property of the folder. Deriving it from session liveness makes a stable fact flicker.
2. **Wrong source.** The server already owns a persisted, non-live `isGitRepo` tri-state (`DashboardSession.isGitRepo`, mirrored into `.meta.json`, restored on cold start by `session-scanner`) plus a server-pushed per-folder git HEAD map (`git_head_update` → client `folderGitMap`). The board discards both and invents its own liveness-coupled derivation.
3. **Three divergent rules for one question.** The same "can this folder take a worktree?" question is answered three different ways in three places:

   | Surface | Site | Rule | Zero-session folder |
   |---|---|---|---|
   | Board card action | `App.tsx:1712` | `some(cwd match && gitBranch)` | hidden |
   | Sidebar `+ New Worktree` | `SessionList.tsx:1550` | `some(s => s.isGitRepo !== false)` | hidden (fails **closed**) |
   | Sidebar `Manage worktrees` | `SessionList.tsx:274` `folderIsGitRepo` | `!some(s => s.isGitRepo === false)` | shown (fails **open**) |

   None consults `folderGitMap`, which is the only signal that covers a folder with no sessions at all.

Additionally the failure is **unexplainable**: the button just vanishes. Even when worktrees are genuinely unavailable (non-git folder, or `gitWorktreeEnabled: false`), the user gets no reason.

## What Changes

- **One shared pure helper** resolves worktree availability for a folder, consumed by every surface that asks the question — the board card action, the board's `NewProposalDialog` worktree option, the sidebar `+ New Worktree` button, and the sidebar `Manage worktrees` menu item.
- **Availability rule** (git state, in order):
  1. a **non-null** server-reported HEAD for the folder in `folderGitMap` ⇒ git;
  2. otherwise a session of that folder with `isGitRepo === false` (live **or ended**) ⇒ not git;
  3. otherwise unknown ⇒ git (fail-open).

  A `folderGitMap` value of `null` is **not** evidence of non-git — `folder-head-poll.ts` returns `null` for a non-git folder, an unborn/empty repo, *and* a read error alike, and a stale `null` is never re-polled for an unpinned folder with no live sessions. It is therefore treated as *unknown* and falls through.
- **Key normalization.** Lookups go through the shared `pathKey` used to build `folderGitMap` server-side, so the board's raw route-param cwd and the sidebar's resolved `group.cwd` cannot resolve differently inside the "shared" helper.
- **Preference gate.** `gitWorktreeEnabled === false` makes the action unavailable regardless of git state, and takes precedence in the reported reason. While the preference is still loading it is treated as enabled, so no wrong "disabled in Settings" state flashes on cold load.
- **Explainable unavailability on the board.** The board renders `New worktree` disabled with a reason (`This folder is not a git repository` / `Worktrees are disabled in Settings`) instead of removing it from the DOM.
- No new protocol field, no new server poll, no new persistence — this change only stops the client from discarding server state it already receives.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `openspec-board`: the `Card actions` requirement gains an explicit availability rule for `New worktree` — derived from the folder's static git state, never from session liveness, rendered disabled-with-reason when unavailable, and agreeing with the sidebar's `+Worktree` availability for the same folder. The board's new-proposal dialog uses the same resolved availability.

## Discipline Skills

- `review-code` — non-trivial client change touching four call sites plus tests; run the inline review loop before commit.
- `code-simplification` — the change's whole point is collapsing three divergent gate derivations into one helper; verify the result is actually simpler, not a fourth path.

Not triggered: no auth/untrusted-input/secrets/PII (`security-hardening`), no latency budget (`performance-optimization`), no new endpoint/job/external call (`observability-instrumentation`).

## Impact

- `packages/client/src/lib/git/folder-worktree-availability.ts` — **new** pure helper (+ its `AGENTS.md` row).
- `packages/client/src/App.tsx` — board availability prop derivation (line ~1712); `folderGitMap` must be passed to the board branch as it already is to `SessionList`.
- `packages/client/src/components/openspec/OpenSpecBoardView.tsx` — `ProposalCard` action rendering (line ~1117) becomes disabled-with-reason; `NewProposalDialog` worktree gate (line ~613) consumes the same availability.
- `packages/client/src/components/session/SessionList.tsx` — `FolderSpawnButtons.showWorktree` (line ~1550) and `folderIsGitRepo` (line ~274) both delegate to the helper. **Behaviour change:** the sidebar `+ New Worktree` button now appears for a pinned git folder with zero sessions (today it is hidden).
- Tests: `SessionList.worktree-per-change.test.tsx` (two assertions currently assert *absence*), `OpenSpecBoardView.test.tsx`, `ManageWorktreesMenu.test.tsx`, plus new unit tests for the helper.
- i18n: two new strings for the disabled reasons.
- No server, shared-protocol, or persistence changes.
