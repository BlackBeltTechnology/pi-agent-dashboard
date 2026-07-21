# Design — per-turn workspace checkpointing + time-travel revert

## Origin

Flagship candidate ① from the t3code feature-adaptation research
(`docs/research/t3code-feature-adaptation.md`). t3code's Checkpointing
(`CheckpointStore.ts` / `CheckpointDiffQuery.ts` / `CheckpointReactor.ts`, command
`thread.checkpoint.revert`) captures workspace state over time, diffs turns, and restores
earlier points. This change adapts it onto the dashboard's bridge/server/client split.

## What already ships (build on, don't rebuild)

A coherence + grounding pass established the dashboard already owns the *diff* half:

| Capability | Where | Reuse |
|---|---|---|
| Per-turn changed-file summary | `packages/client/src/lib/lineDelta.ts::buildTurnSummaries` | Timeline entry's changed-file count + file list |
| Server per-file diff w/ git | `packages/server/src/session-diff.ts` (`git diff`/`numstat` vs cwd) | Diff rendering data path |
| Diff rendering | `DiffPanel` / `DiffViewer` (client) | Timeline "Diff vs previous/current" |
| "cwd is a git repo" flag | `packages/shared/src/diff-types.ts` | Enable/disable checkpointing per session |
| `turn_end` hook + live cwd + git emit | `packages/extension/src/bridge.ts:2639`, `sendGitInfoIfChanged` | Snapshot capture point |

Missing, and added here: (1) restorable snapshot at `turn_end`, (2) revert action, (3)
timeline UI + revert control.

## The snapshot mechanism — private shadow ref via temp index

On `turn_end`, capture the **full working tree** without disturbing the user's git state:

```
GIT_INDEX_FILE=$tmp git add -A            # stage tracked + untracked (respects .gitignore)
tree=$(GIT_INDEX_FILE=$tmp git write-tree)
commit=$(git commit-tree $tree -p <prevSnapshot?> -m "pi-checkpoint s=<sid> turn=<n>")
git update-ref refs/pi-checkpoints/<sessionId>/<turn> $commit
```

- Uses a **throwaway index file**, so the user's real index/staging is untouched.
- Writes only to `refs/pi-checkpoints/<sessionId>/*` — never `HEAD`, branches, or `git stash`.
- Objects **dedupe** against the existing store: unchanged files cost nothing; a snapshot is a
  tree + a commit. Cheap even on large repos.
- `.gitignore` is respected by `git add -A`, so `node_modules`/build artifacts stay out.

**Diff between turns:** `git diff refs/pi-checkpoints/<sid>/<a> refs/pi-checkpoints/<sid>/<b>`.

**Revert to turn N:**
```
# 1. pre-revert safety snapshot of the CURRENT tree (so revert is reversible)
capture(<turn=current+ε, label="pre-revert">)
# 2. restore working tree to snapshot N's tree
git restore --source=refs/pi-checkpoints/<sid>/<n> --worktree --staged -- :/
# 3. delete files that exist now but not in snapshot N (added-after cleanup)
```
Step 3 uses the diff `N..current` to know which paths to remove (checkout-index / rm for
adds), keeping the tree an exact match of snapshot N.

## Design decisions

### D1 — Capture + revert live on the BRIDGE (workspace-authoritative)
Snapshot and restore mutate/read the real working tree, which lives where the pi session runs
= the bridge host. The server-side `session-diff.ts` works today only because the server shares
the fs in the local case; checkpointing must be correct for the future SSH-remote path too, so
git ops run bridge-side. The **server persists checkpoint metadata + orchestrates the UI**;
the bridge does the git. Consequence: capture/revert ride bridge control messages, not
server-local git.

### D2 — Revert is non-destructive by construction (pre-revert safety snapshot)
The hardest open question was "what happens to manual edits interleaved with agent edits on
revert." Answer: **always snapshot the current tree before reverting.** Revert then becomes
reversible (redo = revert to the pre-revert snapshot). This dissolves the mixed-edit problem
without a partial-revert engine: full-tree revert is simple and predictable, and nothing is
ever truly lost because the prior state is a checkpoint.

### D3 — Snapshot tracked + untracked, skip ignored
Agent-created new files must be captured (and removed on revert), so untracked is included via
`git add -A`. Ignored artifacts are excluded (cost + noise). This matches what a user means by
"the workspace as of turn N."

### D4 — Git-only; non-git sessions disable the feature gracefully
No git object store ⇒ no cheap snapshot. Reuse the existing `diff-types.ts` git-repo flag to
gate the timeline off with a clear "checkpointing needs a git repo" note. (t3code likewise
assumes git.)

### D5 — Capture is async, off the turn's critical path
`turn_end` already does work; snapshotting must not add perceptible latency. Fire capture
asynchronously after the turn is reported; a slow/failed snapshot degrades to "no checkpoint
for this turn," never blocks or fails the turn. Measure `write-tree` cost on a large repo
(`performance-optimization`).

### D6 — Worktree interaction composes
Sessions may run inside a worktree. `refs/pi-checkpoints/<sessionId>/*` is keyed by session and
snapshots that worktree's working tree; the shared object DB dedupes. Worktree isolation
(cross-session) and checkpointing (intra-session time-travel) are orthogonal and compose.

### D7 — Retention = last-N cap + prune on session end
Per-turn refs accumulate. Keep the last N per session (configurable); delete the session's ref
namespace on archive/removal. Prevents unbounded ref/object growth. Objects GC naturally once
refs drop (or via periodic `git gc`).

### D8 — Revert gated behind auth + confirm (remote exposure)
Revert rewrites the working tree and is reachable when the dashboard is tunnel-exposed (zrok).
Gate it behind the existing auth (bearer-auth/pairing) like other mutating ops, plus an
explicit user confirm. Snapshot/restore paths are confined to `refs/pi-checkpoints/*` + the
session cwd — never an arbitrary path.

## Open questions

1. **Empty/no-op turns.** Skip snapshot when the tree is unchanged vs the previous snapshot
   (compare tree oids) to avoid timeline noise. Lean: skip identical trees.
2. **Very large working trees / binaries.** `write-tree` hashes changed content; unchanged is
   free. Confirm the worst case (first snapshot of a huge dirty tree) stays acceptable; if not,
   offer a per-session size cap that disables capture with a surfaced reason.
3. **Concurrent external git ops.** If the user runs `git checkout` mid-session, snapshot refs
   still capture the working tree faithfully; revert restores tree state, not branch state.
   Document that checkpointing tracks *working-tree content*, not branch/HEAD position.
4. **Server metadata vs ref as source of truth.** Refs are the durable store; server metadata
   (turn↔ref, timestamps, file counts) is a cache rebuildable by listing the ref namespace.
   Confirm rebuild-on-reconnect behavior.

## Alternatives considered

- **`git stash create` per turn.** Rejected: does not include untracked files, and pushes into
  stash semantics; the temp-index `write-tree` is cleaner and fully private.
- **Server-side capture (reuse `session-diff.ts` git).** Rejected as the primary path: breaks
  for remote workspaces and couples time-travel to the server's fs assumption. Bridge-side is
  workspace-authoritative (D1).
- **A separate snapshot database (copy files out).** Rejected: reinvents content-addressed
  storage git already provides for free, and bloats disk. Git object dedup is the whole point.
- **Partial / per-file revert in v1.** Deferred: the pre-revert safety snapshot + diff view
  covers the common need without a selective-restore engine; add later if demanded.
