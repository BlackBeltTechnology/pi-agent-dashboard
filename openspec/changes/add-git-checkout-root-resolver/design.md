## Context

See `proposal.md` — Why. In short: `dirname(git rev-parse --git-common-dir)` is copied across
the repo and is wrong whenever the git directory does not sit inside the checkout it serves.

Four constraints shape the approach. The first was known at drafting; the rest came from
measurement during doubt-review and each one invalidated part of an earlier design:

1. A guard exists at `packages/server/src/lib/path-containment.ts:94` testing
   `basename(commonDir) === ".git"`, added by the archived `git-root-file-containment` change
   as a fail-closed containment check.
2. **That test is not a valid worktree discriminator.** Measured: a linked worktree *of a
   submodule* has `commonDir = <super>/.git/modules/<name>` (basename `<name>`), and a linked
   worktree *of a bare hub* has `commonDir = <hub>.git`. Both are real linked worktrees the
   basename test calls "not a worktree". The premise "a gitdir is named `.git` exactly when it
   sits inside its working tree" is false — `<super>/.git/modules/models/sub` **is** the
   submodule's gitdir. The correct signal is `--git-dir != --git-common-dir`, exact on all 9
   measured cases. As a fail-closed *containment* test the basename check is still sound; as a
   *classifier* it is not, which is why it must not simply be propagated.
3. **`gitWorktree.mainPath` is persisted and re-seeded on boot.** `session-to-meta.ts:66`
   writes it; `session-scanner.ts:138` reads it back at startup. Ended sessions never poll
   again, so a phantom written today survives every restart. It keys `session-grouping`,
   `session-ordering`'s order map, `folder-head-poll`, `kb-folder-slot`, and
   `openspec-locality`.
4. **`resolveMainPath` has twelve consumers, not one.** Beyond `resolveConfigRoot` it feeds
   `pruneWorktrees`, `removeWorktree` → `sweepResidualWorktreeDir` (a second recursive-delete
   boundary), `mergeWorktree`, diff-stat, `createPr`, and `isMainWorktree`. This is why the
   work is sequenced rather than landed at once (proposal — Sequence).

## Goals / Non-Goals

**Goals:**

- One shared, tested resolver for git checkout roots, correct across all measured states, with
  the states pinned by fixtures rather than by reasoning.
- Convert the three consumers that hold a private copy of the arithmetic and are read-only.
- Actively repair persisted phantom `mainPath` values rather than assuming they expire.

**Non-Goals:**

- `resolveMainPath` and its twelve consumers — change 2. Nothing here alters it.
- `path-containment.ts` — change 3. It keeps its inline fail-closed guard for now; that is a
  knowingly-retained duplicate, justified because changing it *widens a security boundary* and
  so needs its own deltas and tests.
- No superproject relationship surfaced; submodules do not nest under their parent.
- No repair of a phantom that coincides with a real working tree (Risks).

## Decisions

### D1 — Discriminate with `--git-dir != --git-common-dir`

A linked worktree is exactly the state where the per-worktree gitdir differs from the shared
common dir. Measured across normal, linked worktree, submodule, worktree-of-submodule, bare,
worktree-of-bare, `--separate-git-dir`, and subdirectories of several: correct in every case,
and unlike the basename test it does not depend on how anything is named.

*Alternatives considered:*

- **`basename(commonDir) === ".git"`** — the original design; rejected on measurement (it
  misclassifies two supported configurations). Retained only as a *fallback* for deriving a
  main checkout (D2 rule 2b), never as the worktree test.
- **`--show-superproject-working-tree`** — identifies submodules but answers a narrower
  question, costs a subprocess, and does not distinguish a linked worktree at all. Rejected.
- **`git worktree list --porcelain[0]`** — rejected on measurement: for a submodule, a bare
  hub, and a `--separate-git-dir` repo the first entry is the **gitdir**, not a checkout. This
  is also the root of the pre-existing `listWorktrees()` bug.

### D2 — Return three values, not one

```ts
type GitCheckoutRoots = {
  thisCheckout: string | null;   // --show-toplevel; null for a bare repo
  isLinkedWorktree: boolean;     // --git-dir !== --git-common-dir
  mainCheckout: string | null;   // primary working tree; null when the repo has none
};
```

`mainCheckout`:

1. **Not a linked worktree** → `thisCheckout`. A normal checkout, a submodule, and a
   `--separate-git-dir` checkout are each their own primary working tree.
2. **Linked worktree** → from the common dir:
   a. repository-**local** `core.worktree`, resolved relative to `commonDir`, when set — this
      recovers `/super/models/sub` for a worktree of a submodule;
   b. else `dirname(commonDir)` when `basename(commonDir) === ".git"`;
   c. else `null` — a bare hub has no working tree.

An earlier design returned a single value, arguing "this checkout" and "the primary checkout"
diverge only for a linked worktree. Sound, but built on the invalid discriminator: once
worktree-of-submodule and worktree-of-bare are classified correctly there are three states
where the two differ and one where the primary checkout does not exist. A single value cannot
express "is a worktree, but has no main checkout" without lying.

**Bare must be distinguishable from non-repo.** The required probes are exactly `--git-dir` and
`--git-common-dir`; both succeeding proves the cwd is in a repository. `--show-toplevel` is
*not* required — it fails by design in a bare repo, and that failure means `thisCheckout =
null`, not "no result". An earlier draft said "a required probe fails → no result", which made
bare indistinguishable from non-repo and contradicted this change's own bare scenarios.

### D3 — Probe form is part of the contract, not a per-package choice

`isLinkedWorktree` is an equality test between two probe outputs, so their *form* is
load-bearing. `--git-dir` reports the RELATIVE `.git` at a checkout root and an absolute path
from a subdirectory, and the repo already mixes conventions: `--path-format=absolute`
(`kb-routes.ts:76`, `path-containment.ts:88`) versus raw output plus manual `path.resolve`
(`git-operations.ts`, `vcs-info.ts:97`). A call site wiring one probe absolute and the other
relative yields `'/repo/.git' !== '.git'` — and **every normal checkout reports as a linked
worktree**, corrupting grouping and the kb guard at once.

Both probes therefore use `--path-format=absolute` (git ≥ 2.31, already this repo's
assumption), and comparison goes through the platform-aware path helpers (`samePath` in
`packages/shared/src/platform/paths.ts`), never raw `!==`. A fixture test with injected values
cannot catch a mis-wired thunk, so each site's wiring is asserted separately.

The resolver takes its git reads as injected thunks so each package keeps its invocation style
and the pure logic stays unit-testable without spawning git — but the *canonical form* is
required by the contract, not left to the caller.

### D4 — The `core.worktree` probe is argv-based and repository-local

Two independent hazards, both measured:

- **A merged read leaks global config.** `git --git-dir=<X> config --get core.worktree` returns
  a value set in `~/.gitconfig` (verified: returns `/POISONED` from a global setting). That
  would apply one stray setting to every linked worktree on the machine, and `mainCheckout`
  feeds an authorization anchor. The read is repository-local only.
- **Shell interpolation.** The server's `tryRun` is `execSync` over a **shell string**
  (`git-operations.ts:57`) and every command in that file today is a constant. This probe is
  the first to interpolate a runtime, cwd-derived path: a space in a repo path silently splits
  argv (probe reads as unset → wrong fallback branch), and a metacharacter in a session cwd is
  server-side command injection. Argv form only.

Note `--separate-git-dir` does **not** set `core.worktree` (measured: the gitdir config holds
only `repositoryformatversion`), so rule 2a does not rescue that state and the residual in
Risks stands.

### D5 — Persisted phantom repair is a three-condition shape test

The scanner drops a persisted `gitWorktree` whose `mainPath` is not a plausible working tree.
All three conditions are required: it exists, it contains no `.git` path segment, **and** it
directly contains a `.git` entry of its own.

The third is load-bearing, not belt-and-braces. A first draft used only the first two, which
cannot see the `--separate-git-dir` and bare phantoms at all — those resolve to a REAL,
EXISTING directory with no `.git` segment (`/tmp`, or an unrelated sibling). Those are exactly
the rows the proposal calls "the dangerous ones", so a filter blind to them would leave the
hardest-to-notice corruption on disk while appearing to satisfy the repair requirement. A
genuine working tree always carries its own `.git` entry — a directory in a normal checkout, a
file in a submodule or linked worktree — so the check is one `stat`, no subprocess.

"Contains a `.git` segment" is exact path-component equality, so a checkout legitimately at
`/work/app.git` is not dropped.

A record is dropped on **any** stat failure, not only not-found (decided). The simpler rule is
preferred over distinguishing `ENOENT` from `EACCES`/`EIO`/`ENOTCONN`; the accepted cost is
that a legitimate checkout on an unmounted volume is dropped and, for an ended session, its
grouping is not restored when the volume returns.

*Alternative considered:* a one-shot migration over `.meta.json` files. Rejected — rewriting
historical session metadata is riskier than an idempotent read-time filter, and the filter also
covers files restored from backup or synced in later.

## Risks / Trade-offs

- **The repair is shape-based, so some phantoms survive.** A phantom landing on a directory
  that is itself a working tree is indistinguishable from a legitimate value — a bare hub at
  `$HOME/bare.git` gives phantom `$HOME`, and if `$HOME` is a dotfiles repo it passes all three
  conditions (measured). → *Mitigation:* none; documented in the spec as a known limitation
  rather than presented as a complete repair. The alternative is re-probing git for every
  persisted session at startup, which is not worth the cost.

- **`--separate-git-dir` whose gitdir is named `.git`, reached from a linked worktree of that
  repo** — falls through to rule 2b and yields an unrelated directory. → *Mitigation:* fails
  identically today; the common non-worktree case is now correct via `--show-toplevel`. Not on
  the main path.

- **The kb guard becomes stricter** — a cwd previously admitted via a mis-derived sibling is now
  rejected; a worktree-of-bare (`mainCheckout = null`) is rejected unless independently known.
  → *Mitigation:* this is the intended security fix; such a cwd can still be admitted by being
  added as a known folder. Flagged because it is a user-visible behaviour change.

- **A cwd inside `.git`** — today the kb guard admits it via `dirname(commonDir)` = repo root;
  now `thisCheckout` is null there, so it is rejected. → *Mitigation:* safe direction and
  arguably correct (a `.git` internals path is not a project), but recorded as an intentional
  behaviour change rather than discovered later.

- **Inherited git environment variables** — `GIT_DIR` / `GIT_WORK_TREE` / `GIT_COMMON_DIR`
  exported into the server process redirect every probe. → *Mitigation:* pre-existing for
  `--git-common-dir`, but the new equality test fails in a new direction: an env-forced
  `GIT_DIR` makes `gitDir != commonDir` trivially true, so an ordinary checkout reports as a
  linked worktree. Accepted and documented — sanitizing the env for git probes is broader than
  this change, and the failure needs a deliberately unusual launch.

- **`core.worktree` is user-controlled and git does not validate it**, so rule 2a can yield a
  path that is nonexistent, outside the repo, or inside `.git`. → *Mitigation:* **validation
  lives in the consumers, not the resolver** (decided). The resolver reports what git says,
  verbatim; each consumer states its own check because the safe response differs by consumer —
  the bridge omits the worktree field (display), the kb guard rejects the request
  (authorization). The resolver deliberately does not sanitize, so no consumer can silently
  inherit a judgement it did not make. The cost is that every future consumer must add its own
  check; the spec states that obligation explicitly rather than leaving it implied.

- **Scenario names retained though they name a retired concept** — e.g. "Worktree identity is
  derived from git-common-dir vs toplevel" now describes the gitdir signal. → *Mitigation:*
  deliberate. Renaming a scenario inside a MODIFIED block makes `openspec archive` refuse the
  spec sync ("current spec contains scenario(s) not present in the modified block"), a known
  trap in this repo. Headings stay; bodies are corrected.

- **Fixture cost**: nine states need real repos, including submodule and bare-hub worktrees. →
  *Mitigation:* all nine are creatable with plain `git init` / `worktree add` / `submodule add`
  in a temp dir — already done during review, so the cost is measured. Submodule fixtures need
  `-c protocol.file.allow=always`; probe fixtures need `GIT_CONFIG_GLOBAL=/dev/null` so a
  developer's own global config cannot leak into the `core.worktree` assertions.

## Migration Plan

1. Land the resolver + fixture tests (no consumers converted; inert).
2. Convert `vcs-info.detectWorktree`, asserting canonical probe wiring (D3).
3. Convert the kb guard.
4. Add the scanner's phantom filter (D5).
5. Restart server + reload extensions per the rebuild matrix; live sessions re-probe on the
   next poll tick, and persisted phantoms are filtered at load.

Rollback is a revert: no schema change, no persisted-format change. The filter is read-time, so
a revert simply stops filtering.

## Open Questions

None blocking. D5's predicate is deliberately conservative; if a future state needs a different
rule it changes one pure function without touching the resolver, the specs, or the tasks.
