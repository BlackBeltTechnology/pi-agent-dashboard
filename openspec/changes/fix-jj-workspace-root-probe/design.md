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
jj's almost one-to-one, and the patterns it has converged on over years
of field use inform this design:

| Concern | git worktree | jj equivalent |
|---|---|---|
| "Parent / shared root for all checkouts" | parent of `git rev-parse --git-common-dir` | parent of resolved `.jj/repo` storage dir |
| "Current checkout's working dir" | `git rev-parse --show-toplevel` | `jj workspace root` (alias `jj root`) |
| "Linked checkout's private metadata dir" | `.git` is a **file** → `<main>/.git/worktrees/<name>` | `.jj/repo` is a **file** → main `.jj/repo` |
| "Enumerate all checkouts (machine-readable)" | `git worktree list --porcelain` | `jj workspace list` (no paths in default output) |
| "Path A == Path B?" | always canonicalize via `realpath` first | applied here — see Decision 4 |

**Important finding during implementation**: `jj root` was initially
proposed as the structural analog of `git rev-parse --git-common-dir`'s
parent, but **`jj root` is documented as "shortcut for `jj workspace
root`"** — it returns the **current workspace's** working-copy root, not
the parent repo root. So the canonical "parent root" derivation in jj is
NOT a subcommand at all. The closest jj subprocess equivalent is
`jj workspace root --name default` (which works only when the conventional
"default" workspace still exists), and even then it has a startup cost
every probe pays.

The filesystem layout is the canonical answer: `.jj/repo` is a file in
non-default workspaces (pointing at the shared storage's `.jj/repo`) and
a directory in the default workspace. This is the **same** mechanism
`git` uses for linked worktrees (`.git`-as-file vs `.git`-as-directory),
and the same mechanism most git tooling reads directly in practice when
performance matters. The original "on-disk layout is opaque" rejection
was based on the false premise that `jj root` did the job; with that
ruled out, on-disk reading becomes the strongest option.

Two lessons that survive the correction:

1. Trust the **shared metadata location**, not the working-copy root.
   Whether expressed as a subcommand (`--git-common-dir`) or a file
   pointer (`.git`-as-file / `.jj/repo`-as-file), the parent root is
   defined by where the shared storage lives.
2. Every cross-checkout path comparison canonicalizes both sides before
   string-equality. Skipping this step is the single most common source
   of "works on Linux, fails on macOS" worktree bugs.

## Decisions

### Decision 1 — Derive the parent repo root from the `.jj/repo` filesystem entry

**What:** Replace the `jj.workspaceRoot()` subprocess call inside
`gatherJjInfo` with a pure filesystem read of `<cwd>/.jj/repo`. The
derivation:

1. `stat .jj/repo`.
2. If it is a **directory**, cwd is the original (default) workspace;
   the parent repo root equals `cwd`.
3. If it is a **file**, read its contents (a relative path like
   `../../../.jj/repo`), resolve against `<cwd>/.jj/` to get the absolute
   path of the shared storage `.jj/repo` directory, and take its parent
   directory — that's the parent repo root.

**Why:** This is the canonical mechanism jj uses internally to link
workspaces back to their shared storage, and it is the direct structural
analog of `git`'s `.git`-as-file in linked worktrees (which `git rev-parse
--git-common-dir` is just a query interface for). Properties:

- **Zero subprocess overhead** — keeps the probe's fast-path lightweight.
  The existing fast-path gate (`<cwd>/.jj/` exists) already touches the
  filesystem; reading `.jj/repo` is one additional `stat` + at most one
  small `readFile`.
- **No dependency on workspace naming** — works regardless of whether
  the conventional "default" workspace exists.
- **Stable across jj versions** — the `.jj/repo`-as-file convention has
  been in place since jj added workspace support.
- **Robust to where workspaces live on disk** — derives the parent from
  the actual storage location, not from a heuristic on path layout.

**Why `jj root` was rejected:** initial revisions of this design assumed
`jj root` returned the parent repo root, by analogy with
`git rev-parse --git-common-dir`. **It does not.** `jj root --help` is
explicit: "shortcut for `jj workspace root`". Verified with jj 0.40: both
commands return the current workspace's working-copy directory, which for
a non-default workspace equals the workspace's own cwd (the exact value
that made the original probe broken). `jj root` cannot be the fix.

**Field naming clarification:** The shipped name `workspaceRoot` is now
arguably a misnomer — it carries the *repo* root, not the workspace's
own root. We keep the name as-is to avoid a breaking change to the
protocol type. The doc comment on `JjState.workspaceRoot` is updated to
read "absolute path of the **parent repo root** (== cwd for default
workspace)". A future change can rename the field if needed.

### Decision 2 — Fallback to `jj workspace root` on filesystem read error

**What:** If reading `.jj/repo` fails (corruption, permission, transient
I/O), the probe falls back to `jj.workspaceRoot()` to preserve the prior
(broken-but-non-empty) behaviour rather than returning `undefined`. The
failure is recorded in `lastError` so the diagnostic trail survives.

**Why considered, then rejected, a `jj workspace list` middle step:** an
earlier revision of this design proposed parsing `jj workspace list` as a
middle fallback, by analogy with `git worktree list --porcelain`. The
analogy breaks down at the data layer: `jj workspace list`'s default
output is `<name>: <change-id> <commit-id> <markers> <desc>` — it **does
not include workspace paths**, so it cannot recover the parent repo root
by parsing alone. (`git worktree list --porcelain` does emit paths, which
is why the git-side pattern works.) Recovering paths in jj requires a
custom template whose exact syntax varies across jj versions — too
brittle to be a fallback for robustness. Captured in Alternatives Considered below.

**Why:** `JjState.workspaceRoot` being non-empty is part of the predicate
gating the badge and the workspace list UI. A fallback keeps those
features working in degenerate environments while logging the error to
`lastError`. The spec already permits `lastError` for diagnostic info.

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

- **Use `jj root` (initial proposal).** Rejected during implementation
  after verifying `jj root --help`: "shortcut for `jj workspace root`".
  Returns the current workspace's working-copy directory — exactly the
  value that made the original probe broken. Documented in Decision 1.
- **Use `jj workspace root --name default` subprocess.** Works (returns
  the default workspace's path, which is the parent repo root in
  conventional setups), but pays subprocess cost every probe and fails
  when `jj workspace forget default` has been run. The `.jj/repo` file
  read in Decision 1 covers both cases without subprocess overhead.
- **Parse `jj workspace list` as a fallback step** (mirroring
  `git worktree list --porcelain`). The git-worktree porcelain analog
  was an attractive middle step. **Rejected** after verification:
  `jj workspace list`'s default output format is
  `<name>: <change-id> <commit-id> <markers> <desc>` — it does not
  contain workspace paths. Recovering paths requires a custom template
  whose exact syntax is not stable across jj versions; too brittle to
  depend on for robustness. Kept in the Prior-art table as the
  enumeration analog only — not as a value source for `workspaceRoot`.
- **Add a parallel `repoRoot?: string` field to `JjState` and consume it
  from the grouping logic.** Cleaner naming, but requires a protocol bump
  and dual-population during the transition. The cost outweighs the
  benefit since the field's value is what matters, not its name. Captured
  as a possible future cleanup.
