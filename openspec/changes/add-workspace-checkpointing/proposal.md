# Add per-turn workspace checkpointing + time-travel revert

## Why

The dashboard isolates work by **git worktree** but has no **intra-session time-travel**:
once an agent turn edits files, there is no one-click way to see "workspace as of turn N" or
to roll the working tree back to it. If a turn goes wrong three turns ago, recovery is manual
`git` surgery.

t3code ships this as **Checkpointing** (`CheckpointStore.ts`, `CheckpointDiffQuery.ts`,
`CheckpointReactor.ts`): it captures workspace state over time, diffs turns, and restores an
earlier point via `thread.checkpoint.revert`. This change adapts that to the dashboard.

**Key grounding: the dashboard already ships the "diff turns" half.** Verified enabling
facts (current code):

- **Per-turn change tracking already exists.** `packages/client/src/lib/lineDelta.ts::buildTurnSummaries`
  builds a per-turn changed-file summary from Write/Edit events; `packages/server/src/session-diff.ts`
  already runs `git diff`/`numstat` against the session cwd; `DiffPanel`/`DiffViewer` render
  the result; `packages/shared/src/diff-types.ts` already carries a "session cwd is a git
  repository" flag. The turn→files→diff pipeline is shipped.
- **The bridge fires at the turn boundary with workspace + git access.** `packages/extension/src/bridge.ts:2639`
  registers `pi.on("turn_end", …)`, already runs turn-end logic (auto-name, contextUsage
  enrichment), holds a live `ctx.cwd`, and already emits git state (`sendGitInfoIfChanged`).
  So a snapshot can be captured **in-process with the actual workspace** on every turn.
- **Git gives cheap, content-addressed snapshots for free.** A snapshot commit written to a
  **private ref namespace** `refs/pi-checkpoints/<sessionId>/<turn>` dedupes objects and
  never touches the user's `HEAD`, index, or `git stash` list.

What is therefore **missing** — and what this change adds — is only: (1) a restorable
**snapshot** captured at each `turn_end`, (2) a **revert** action, and (3) a **checkpoint
timeline** UI. The diff-rendering surface is reused, not rebuilt.

## What Changes

Introduce **workspace checkpointing**: a per-turn snapshot of the session's git working tree
with diff-between-turns and revert-to-turn.

- **Snapshot on `turn_end` (bridge, workspace-authoritative).** When a supervised git-repo
  session finishes a turn, the bridge writes a snapshot of the **full working tree**
  (tracked + untracked, respecting `.gitignore`) as a commit under
  `refs/pi-checkpoints/<sessionId>/<turn>`, using a temp index (`GIT_INDEX_FILE` +
  `write-tree` + `commit-tree`) so `HEAD`, the index, and the stash are untouched. Capture is
  bridge-side because the bridge is co-located with the workspace (this also makes it correct
  for the future SSH-remote path). Non-git sessions: checkpointing is disabled and surfaced
  as such (reuse the existing git-repo flag).
- **Checkpoint timeline (client).** A per-session timeline — one entry per turn: turn number,
  timestamp, changed-file count (from the existing turn summary), snapshot ref. Each entry
  offers **Diff vs previous / current** (reusing `DiffViewer`) and **Revert to here**.
- **Revert-to-turn (bridge), non-destructive by construction.** Revert first captures a fresh
  **pre-revert safety snapshot** of the current tree, then restores the working tree to the
  target snapshot's tree (`git restore --source=<ref> --worktree`/checkout-index semantics),
  deleting files added after the target. Because a pre-revert checkpoint always exists, revert
  is itself reversible (redo) — this is the contract that makes mixed manual+agent edits safe.
- **Diff any two turns.** `git diff <refA> <refB>` between snapshot refs, rendered through the
  existing diff surface.
- **Retention (basic).** Cap snapshots per session (keep last N, configurable); prune the
  session's `refs/pi-checkpoints/<sessionId>/` namespace on session archive/removal so the ref
  space and object store do not grow unbounded.

**Out of scope (follow-ups):**
- Non-git snapshotting (no working git object store to lean on).
- Per-file / partial revert (v1 reverts the whole working tree to a checkpoint; the pre-revert
  safety snapshot covers the "I only wanted one file" case via redo + diff).
- Cross-session or cross-worktree time-travel (snapshots are per-session).
- Snapshotting `.gitignore`d artifacts (kept out deliberately — cost + noise).
- Tuned retention/GC policy beyond a last-N cap.

## Capabilities

### Added Capabilities

- `workspace-checkpointing`: per-turn git working-tree snapshots under a private ref
  namespace captured at `turn_end`, a checkpoint timeline with diff-between-turns (reusing the
  existing diff surface), and a non-destructive revert-to-turn that always takes a pre-revert
  safety snapshot so any revert is reversible.

## Impact

- **Additive; opt-in per session; git-only.** A session with checkpointing off, or a non-git
  cwd, behaves exactly as today. No change to the existing diff/summary rendering.
- **Reuses the shipped diff pipeline.** Timeline diffs render through `DiffViewer`/`DiffPanel`;
  changed-file counts come from the existing turn summaries. New rendering is the timeline
  strip + revert control only.
- **New protocol (small, control-plane only):** the bridge reports a per-turn `checkpointRef`
  (extends the existing `turn_end` enrichment); a `checkpoint_revert { sessionId, ref }`
  control message flows client → server → bridge (same shape family as worktree-lifecycle
  actions). Diff data reuses existing endpoints.
- **New code:** a snapshot/restore git helper + `turn_end` capture + revert handler in
  `packages/extension`; a checkpoint-timeline component + revert control in `packages/client`;
  a small metadata/persistence + relay path in `packages/server`.
- **Git posture:** writes only to `refs/pi-checkpoints/*` and via a temp index — never mutates
  `HEAD`, the working index, the user's branches, or `git stash`. Snapshots dedupe against the
  existing object store (cheap even for large repos; measure on turn-end latency — see
  `design.md`).
- **Security surface (significant — revert is a destructive, remotely-reachable mutation):**
  revert rewrites the working tree. On a zrok/tunnel-exposed dashboard it MUST sit behind the
  existing auth gate (bearer-auth/pairing) like other mutating ops, and behind an explicit
  user confirm. The pre-revert safety snapshot bounds the blast radius. Threat model in
  `design.md`.

## Discipline Skills

- `security-hardening` — revert is a destructive working-tree mutation reachable when the
  dashboard is exposed; gate it behind auth + confirm, and confine snapshot/restore to
  `refs/pi-checkpoints/*` + the session cwd (no arbitrary path writes).
- `doubt-driven-review` — revert semantics are near-irreversible by nature; stress-test the
  restore + pre-revert-snapshot contract (untracked deletion, mixed manual edits, worktree
  interaction) before it stands.
- `performance-optimization` — snapshot runs on **every** `turn_end`; measure the temp-index
  `write-tree`/`commit-tree` cost on a large repo and keep it off the turn's critical path
  (async, non-blocking) so it never adds perceptible latency.
