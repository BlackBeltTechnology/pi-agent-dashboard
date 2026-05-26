# Design — add-worktree-lifecycle-actions

## Context

`add-worktree-spawn-dialog` (archived 2026-05-26 once shipped) introduced creation. This change handles every other step in a worktree's lifecycle, plus the failure mode that arises when a worktree disappears from under a running session.

## D1 — Where actions live on the card

**Option A (rejected)**: Add a dropdown menu to the kebab on every session card.
- Pro: discoverable. Con: bloats the kebab for every session, pollutes the menu with worktree-only items.

**Option B (chosen)**: Render a `WorktreeActionsMenu` inline in the WORKSPACE subcard, but only when `session.gitWorktree` is set.
- Pro: zero impact on non-worktree sessions, contextually grouped with the branch/pill, mirrors how `jj-plugin` puts its action bar in the same subcard.
- Con: takes vertical space on worktree cards. Mitigated by rendering as a single icon row (`↗ Push`, `🔀 Merge`, `🗑 Close`, etc.) at the bottom of the subcard.

## D2 — Pre-removal session guard (push the work to the client)

When the user clicks "Close worktree" and there's a running pi session inside it, we have three options:

**Option A (rejected)**: Server auto-kills sessions then removes.
- Risk: destructive side-effect from a single HTTP call. If the user clicks "Close" by accident there's no recovery.

**Option B (rejected)**: Server refuses; client error toast says "kill sessions first".
- Bad UX: user has to manually abort N sessions then come back.

**Option C (chosen)**: Server returns `409 { error: "active_sessions", sessionIds: [...] }`. Client renders an explicit confirm dialog ("This will end N pi sessions: <names>. Continue?"). On confirm, client iterates `shutdown` → re-invokes remove.
- Single round-trip per session for shutdown; final remove only after all sessions ack `session_end`. Client owns the destructive sequencing.

## D3 — Cwd-loss detection — three probe sites, one field

`cwdMissing` is set by *any* of three probe sites and cleared only by the next probe that finds the dir again. Probes:

1. **Bridge git tick** (30 s) — `existsSync(cwd)`. Fires `cwd_missing` message; bridge process likely dies shortly after if cwd is truly gone, so this is best-effort.
2. **Server session scanner** — every time an ended session enters the listing during the scanner pass. Cheap, one stat per ended session, only runs at server boot or on rescan.
3. **Lifecycle endpoint** — `worktree/remove` optimistically stamps `cwdMissing: true` on every session under the path before invoking `git worktree remove`. If remove fails the next bridge tick / scanner pass clears it.

Why three sites: each closes a different gap.
- Without #1 the bridge stays alive in a deleted cwd until the next user action (rare but possible on macOS, where deleted dirs can be lazily noticed).
- Without #2 ended sessions never refresh their broken state after a server restart.
- Without #3 there's a window between `git worktree remove` succeeding and the next 30 s tick where the card looks healthy but isn't.

## D4 — Why not unify with jj `.shadow/` workspace remove?

`jj-plugin` has its own fold-back / forget UI for `.shadow/<name>/` workspaces. We **don't** unify because:
- jj workspaces and git worktrees have different semantics (workspaces share commits; worktrees share refs).
- The actions differ: jj fold-back is closer to "abandon workspace", git worktree close is closer to "delete branch".
- The plugin boundary is intentional — jj is a plugin, this lives in core because git worktrees are first-class.

Both can co-exist on the same card when both apply (rare). The card stacks `JjActionBar` (from the plugin) and `WorktreeActionsMenu` (from core) as siblings in WORKSPACE subcard.

## D5 — Push + PR composition

`Open PR` requires the branch be pushed. We have two options:

**Option A (rejected)**: Separate buttons. User pushes first, then opens PR.
- Pro: explicit. Con: friction for the common case.

**Option B (chosen)**: `Open PR` button auto-pushes when remote-tracking branch is missing (`git rev-parse --abbrev-ref <branch>@{upstream}` fails). The `Push` button remains as an explicit affordance for users who want to push without opening a PR yet.
- The PR endpoint internally runs `pushBranch` if no upstream exists, then `gh pr create`. Stderr from either step surfaces with stable `code`.

## D6 — Merge strategy = `--no-ff`

Default to `git merge --no-ff` so the merge commit always exists and the branch's history is preserved. Power users who want ff/squash use the terminal. v2 may add a dropdown.

## D7 — Tool-registry dependencies

- `git` — already declared in `tool-registry/definitions.ts`. No change.
- `gh` — already declared. The PR endpoint resolves it via the registry; surfaces `tool_not_found` if missing. No fallback.

## D8 — Error envelope stability

Every new endpoint returns the standard ApiResponse shape with stable string `code`:

| Endpoint | Codes |
|---|---|
| `worktree/remove` | `active_sessions`, `dirty_worktree`, `branch_not_merged` (when `--force` absent), `cwd_invalid`, `not_a_worktree`, `git_failed` |
| `worktree/merge` | `dirty_main`, `merge_conflict`, `base_not_found`, `nothing_to_merge`, `cwd_invalid`, `git_failed` |
| `worktree/push` | `no_remote`, `auth_failed`, `non_fast_forward`, `cwd_invalid`, `git_failed` |
| `worktree/pr` | `gh_not_found`, `gh_not_authed`, `pr_exists`, `base_not_found`, `cwd_invalid`, `pushed_but_pr_failed` |

`stderr` is included verbatim in the response body (already standard via the `ApiResponse.stderr` field added in `add-worktree-spawn-dialog`).

## D9 — Why no persistence of `cwdMissing`

The field is recomputable from a single `existsSync` call. Persisting it would only matter across server restarts — and the scanner re-probes during its boot pass anyway. Keeping it ephemeral avoids stale-write race conditions when the user re-creates a worktree at the same path.

## D10 — Mobile rendering

`WorktreeActionsMenu` renders as a horizontal icon row on desktop; on mobile (`useMobile() === true`) it collapses into a single `⋯` button that opens an action sheet. Same component, different layout. Pattern matches `JjActionBar`'s existing mobile branch.
