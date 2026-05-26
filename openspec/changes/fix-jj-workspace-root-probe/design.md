# Design: Derive parent repo root in the jj probe

## Context

Discovered while applying `add-jj-workspace-plugin` Phase 4c: the new
`workspaceRoot`-based group-key collapse compiled, tested, and shipped, but
real workspace sessions still appeared as separate top-level folder cards
in the sidebar because the probe value never differs from `cwd`.

Two layers contribute:

1. **Recipe layer** (`packages/shared/src/platform/jj.ts`). `JJ_WORKSPACE_ROOT`
   shells out to `jj workspace root`, which jj documents as "the working
   copy's root directory" — i.e. the **current workspace's** cwd, not the
   shared repo root.
2. **Probe layer** (`packages/extension/src/vcs-info.ts`). `gatherJjInfo`
   takes the recipe output verbatim and assigns it to `JjState.workspaceRoot`.

The spec (Decision 15) treats `workspaceRoot` as the **parent repo root**
(the path that hosts `.git` in a colocated setup, and that all sibling
workspaces share). Aligning the probe to that contract is the smallest
change that activates the already-shipped grouping.

## Prior art — git worktree

`git worktree` solves the structurally identical problem (one repo, many
checkouts, each with its own working directory). Its primitives map onto
jj's almost one-to-one, and the patterns it has converged on over years of
field use are the right baseline:

| Concern | git worktree | jj equivalent used here |
|---|---|---|
| "Parent / shared root for all checkouts" | parent of `git rev-parse --git-common-dir` | `jj root` |
| "Current checkout's working dir" | `git rev-parse --show-toplevel` | `jj workspace root` |
| "Linked checkout's private metadata dir" | `.git` is a **file** → `<main>/.git/worktrees/<name>` | `.jj/repo` is a **file** → main `.jj` dir |
| "Enumerate all checkouts (machine-readable)" | `git worktree list --porcelain` | `jj workspace list` |
| "Path A == Path B?" | always canonicalize via `realpath` first (symlinks, `/tmp`→`/private/tmp` on macOS, trailing `/`, case) | applied here — see Decision 4 |

Two lessons inform the decisions below:

1. The canonical primitive for "parent root" is the dedicated subcommand
   (`--git-common-dir` ↔ `jj root`), not the working-copy root. Tools that
   read `--show-toplevel` and try to climb up are fragile; tools that ask
   git/jj directly are not.
2. Every cross-checkout path comparison canonicalizes both sides before
   string-equality. Skipping this step is the single most common source of
   "works on Linux, fails on macOS" worktree bugs.

## Decisions

### Decision 1 — Use `jj root` (the repo root command), not `jj workspace root`

**What:** Replace the `JJ_WORKSPACE_ROOT` recipe call inside `gatherJjInfo`
with `jj root --no-pager` (or equivalent). `jj root` returns the **repo
root** — the parent directory shared by all workspaces in the same repo —
which is exactly what `JjState.workspaceRoot` should carry per Decision 15.

**Why:** This is the canonical jj primitive for "what's the parent of all
workspaces in this repo?", and the direct structural analog of
`git rev-parse --git-common-dir`'s parent in the git-worktree world (see
Prior art above). For default workspaces it equals the working copy root
(no behaviour change). For non-default workspaces it returns the parent,
which is what the grouping logic expects.

**Add a new recipe** `JJ_REPO_ROOT` in `platform/jj.ts` rather than mutating
`JJ_WORKSPACE_ROOT`'s semantics — other call sites (e.g. fold-back
operations that genuinely need the workspace's own cwd) keep their existing
semantics. The probe simply switches which primitive it consults.

**Field naming clarification:** The shipped name `workspaceRoot` is now
arguably a misnomer — it carries the *repo* root, not the workspace's own
root. We keep the name as-is to avoid a breaking change to the protocol
type. The doc comment on `JjState.workspaceRoot` is updated to read
"absolute path of the **parent repo root** (== cwd for default workspace)".
A future change can rename the field if needed.

### Decision 2 — Fallback chain on hard error

**What:** If `jj root` fails for any reason (older jj version without that
subcommand, unexpected error), the probe falls back through a two-step
chain before giving up:

1. **`jj root`** — primary. Direct answer to "what's the parent repo root?".
2. **`jj workspace list` default-row parse** — mirrors
   `git worktree list --porcelain`: parse the `default: <path>` row,
   whose path is the parent repo root by construction. More robust than
   step 3 because it still distinguishes default from non-default
   workspaces, and it works on jj versions where `jj root` is missing or
   misbehaves.
3. **`jj workspace root`** — last resort, preserves the prior
   (broken-but-non-empty) behaviour rather than returning `undefined`.

Each failure is recorded in `lastError` so the diagnostic trail survives.

**Why:** `JjState.workspaceRoot` being non-empty is part of the predicate
gating the badge and the workspace list UI. The chain keeps those features
working in degenerate environments while staying faithful to the spec
contract whenever possible. The spec already permits `lastError` for
diagnostic info.

### Decision 4 — Canonicalize the emitted path (realpath before assign)

**What:** The probe canonicalizes the path returned by any step of the
fallback chain (Decision 2) before assigning it to
`JjState.workspaceRoot`. Canonicalization resolves symlinks, collapses
`.`/`..`, and normalizes trailing separators — the same hardening
`git worktree` applies to every path it compares.

**Why:** Decision 15's group-key collapse hinges on
`pathKey(workspaceRoot) === pathKey(cwd)`. On macOS, `/tmp` is a symlink
to `/private/tmp`; `jj root` and the session's `cwd` can disagree on which
form they emit, silently breaking the collapse the same way the original
probe bug did. Git worktree has lived this exact failure mode and the fix
is universal: canonicalize once, at the source.

If `pathKey` already canonicalizes (verify in Phase 1), no probe-side
normalization is needed; otherwise it must be added at the probe boundary
so every downstream consumer sees a stable value.

### Decision 3 — Live integration test, skip when `jj` is absent

**What:** Add `packages/extension/src/__tests__/vcs-info-jj-probe.test.ts`
that:

1. Skips when `jj` isn't on PATH or the registry resolution fails.
2. Creates a tmp dir, runs `git init` + `jj git init --colocate`.
3. Calls `gatherJjInfo` from the tmp root → asserts `workspaceRoot` equals
   the tmp root.
4. Runs `jj workspace add ./.shadow/probe-test` → calls `gatherJjInfo`
   from the new workspace cwd → asserts `workspaceRoot` equals the **tmp
   root** (parent), not the workspace cwd.

**Why:** Pure unit tests against the spec's contract values are insufficient
— they hide exactly the kind of probe/spec mismatch this proposal exists to
fix. A live test catches future regressions.

The skip-when-absent guard is consistent with the existing `jj`-resolution
unit test (Phase 1, Task 5).

## Alternatives Considered

- **Read `.jj/repo` directly from the filesystem.** For a non-default
  workspace, `.jj/repo` is a file pointing to the main repo's `.jj`
  directory; the parent of that path is the parent repo root. Structurally
  identical to reading `.git` as a file in a linked git worktree. This
  avoids a subprocess but couples to jj's on-disk layout, which the
  project has been deliberately treating as opaque. Rejected.
- **Parse `jj workspace list` as the primary strategy** (mirroring
  `git worktree list --porcelain`). More information per call (every
  workspace, default flag, paths), and the closest analog to the pattern
  most git tooling has standardized on. Rejected as *primary* because the
  probe only needs one path and `jj root` is cheaper and more direct, but
  adopted as a **fallback step** in Decision 2 to get the robustness
  benefit without the per-call overhead.
- **Add a parallel `repoRoot?: string` field to `JjState` and consume it
  from the grouping logic.** Cleaner naming, but requires a protocol bump
  and dual-population during the transition. The cost outweighs the
  benefit since the field's value is what matters, not its name. Captured
  as a possible future cleanup.
