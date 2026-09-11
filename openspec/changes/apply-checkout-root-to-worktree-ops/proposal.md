# Apply Checkout-Root Resolution to Worktree Operations

> **Planned.** `design.md` (D1–D8), both spec deltas, `test-plan.md` (45
> automated scenarios + 1 manual-only) and `tasks.md` are complete;
> `doubt-driven-review` ran 3 cycles (single-model + cross-model) and its
> findings are folded. Change 2 of 3. Depends on
> `add-git-checkout-root-resolver` (shipped).

## Why

`add-git-checkout-root-resolver` introduced the shared resolver
(`checkoutRoots` in `packages/shared/src/platform/git.ts`) and converted only
the three READ-ONLY consumers holding a private copy of
`path.dirname(git rev-parse --git-common-dir)`.

`resolveMainPath` still uses that superseded derivation, and it has **twelve**
consumers. Two are recursive-delete boundaries, which is precisely why the work
was split rather than landed at once: each security boundary earns its own
review surface.

The residual user-visible symptom is the **"Not a pi project yet — Set up"
banner** on a submodule session, which is `resolveConfigRoot`'s half of the bug.
Change 1 fixed the folder-card header and the KB badge; this fixes the banner.

## What Changes

Convert `resolveMainPath` and its consumers to the shared resolver:

- `resolveConfigRoot` — fixes the residual "Not a pi project yet" symptom;
- `addWorktree`, `createWorktreeFromPr`, `pruneWorktrees`, `mergeWorktree`,
  `createPr`, `isMainWorktree`, diff-stat;
- **`orphanCleanup` and `removeWorktree` → `sweepResidualWorktreeDir`** — the two
  recursive-delete boundaries. These carry the change's real risk.

Also owned here:

- the pre-existing `git-operations-api` spec/code divergence on the
  `orphan-cleanup` boundary ("inside `cwd`" vs the derived root);
- the `isGitRepo` / bare rewiring `resolveConfigRoot` needs;
- **`listWorktrees()`**, which parses `git worktree list --porcelain`
  independently of the resolver and reports the GITDIR as the main worktree for
  submodule, bare and `--separate-git-dir` repos. Cause is understood and
  recorded; the fix belongs here. Its `isMain` narrows from "exactly one" to
  "at most one", which regresses three `WorktreeList` reads (an empty default
  view, and a removal affordance offered on a bare hub) — corrected here, not
  deferred.
- **the `/remove-batch` item cap**, today the module-level constant
  `REMOVE_BATCH_CAP = 50`. The resolver work makes the cap the multiplier that
  decides whether the per-request probe budget matters, so the number moves
  into `DashboardConfig` (default 50, clamped, invalid → default) and the perf
  budget is stated per ITEM rather than against a fixed 50. See design D8.

## Known regression to design for

A worktree of a bare hub resolves `mainCheckout = null`. Naively converted,
`isMainWorktree` would flip to `true` for such a cwd — a delete boundary reading
"this IS the main checkout" is the wrong direction to fail. The design must state
the fail-closed behaviour explicitly before any consumer is converted.

## Impact

- `packages/server/src/lib/git-operations.ts` and every `resolveMainPath` caller.
- Spec deltas for `git-operations-api` and `worktree-init-hook`.
- Two recursive-delete boundaries → an `Audit` subagent pass is mandatory.

## Discipline Skills

- `security-hardening`: two recursive-delete boundaries consume the resolved
  root. Every git state must fail CLOSED, and "no main checkout resolves" must
  never widen a delete scope.
- `doubt-driven-review`: required BEFORE implementation. The `isMainWorktree`
  regression above is exactly the class of thing that surfaces only under
  adversarial review, and change 1's three cycles were spent on change 1's
  narrowed artifact, not this one.
- `systematic-debugging`: if a git state disagrees with the measured table in
  `docs/architecture.md` → "Git checkout-root resolution", the fixture is the
  evidence and the table is the hypothesis. Re-measure with
  `packages/shared/src/test-support/git-fixtures.ts`.
- `review-code`: standard pre-commit review, covering in particular that no
  converted call site reintroduces a shell-string interpolation of a cwd-derived
  path.
- `performance-optimization`: D7 pins a request-path probe budget
  (`timeout: 400`, one resolution per distinct cwd) and D8 makes the batch cap
  configurable, so `/remove-batch` carries a measured per-item latency budget
  (`test-plan.md` P1/P2/P3) rather than an accepted hand-wave.
- `observability-instrumentation` not triggered: no new endpoint, job, or
  external call.
