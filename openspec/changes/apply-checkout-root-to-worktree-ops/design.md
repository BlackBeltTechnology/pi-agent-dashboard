# Design — Apply Checkout-Root Resolution to Worktree Operations

## Context

See `proposal.md` — Why. Only the state that shapes the approach:

- The shared resolver `checkoutRoots({ cwd, timeout? })`
  (`packages/shared/src/platform/git.ts`) returns
  `{ thisCheckout, isLinkedWorktree, mainCheckout } | null`. Its behaviour per
  git state is pinned by the measured table in `docs/architecture.md` →
  "Git checkout-root resolution"; fixtures in
  `packages/shared/src/test-support/git-fixtures.ts` pin the rows.
- `resolveMainPath(cwd)` in `packages/server/src/git-worktree/git-operations.ts`
  still computes `path.dirname(git rev-parse --git-common-dir)`. It returns a
  path for EVERY state where `--git-common-dir` succeeds, including the states
  where that path is unrelated to any checkout (submodule → `…/.git/modules`,
  `--separate-git-dir` → the sidecar's parent, bare/worktree-of-bare → the
  hub's parent).
- The superseded derivation has **two populations**, and the distinction is
  load-bearing for the migration plan:

  **(a) Seven call sites of `resolveMainPath`** (verified):
  `pruneWorktrees` (git-operations.ts:545), `resolveConfigRoot` (:910),
  `removeWorktree` (:977), `mergeWorktree` (:1117), `worktreeDiffStat` (:1199),
  `createPullRequest` (:1282), `isMainWorktree` (git-routes.ts:641).
  Of these, `createPullRequest`'s `mainPath` is assigned and **never read** —
  dead code, not a consumer.

  **(b) Three sites that inline their OWN
  `tryRun("git rev-parse --git-common-dir") + path.dirname` copy** and do NOT
  call `resolveMainPath`: `addWorktree` (:657), `orphanCleanup` (:1444),
  `addWorktreeFromPr` (:1711). Each branches on its own `commonDirRaw` with its
  own error code (`not_a_repo` / `outside_repo`). Rewrapping `resolveMainPath`
  does **not** reach them; they are explicit conversions.

  Two consumers never resolve a main checkout at all and are NOT in scope:
  `pushBranch` (:1228, runs entirely from `cwd`) and `branchOfWorktree`
  (takes an already-resolved `mainPath` from its caller).

- Jobs the single name hides: **(1) anchor for a filesystem write/delete** —
  `addWorktree`, `addWorktreeFromPr`, `sweepResidualWorktreeDir`,
  `orphanCleanup`; **(2) cwd/base to run a git command in** — `removeWorktree`,
  `mergeWorktree`, `pruneWorktrees`, diff-stat; **(3) identity comparison** —
  `isMainWorktree` (git-routes), `resolveConfigRoot`.
- `listWorktrees` does not call `resolveMainPath` at all. `isMain` is stamped
  **positionally by the pure parser** `parsePorcelainWorktrees`
  (`git-worktree.ts:98`, `isMain: out.length === 0`) — the first record wins.
  For a bare hub, a submodule and a `--separate-git-dir` checkout, the first
  record is the GITDIR, not a checkout.
- `path-containment.ts`'s `gitRoot()` holds a **fourth** inline copy of the
  superseded derivation. It is deliberately NOT in scope here — it is owned by
  the sibling change `widen-containment-to-resolved-checkout`. Naming it so the
  omission is a decision, not an oversight.
- Two consumers end in a recursive delete (`orphanCleanup` directly,
  `sweepResidualWorktreeDir` via `removeWorktree`).

## Goals / Non-Goals

**Goals:**

- One derivation of "which checkout does this cwd belong to" across the server,
  matching the measured table.
- Every converted consumer fails CLOSED: a git state the resolver cannot answer
  SHALL narrow or refuse an operation, never widen one.
- Close the `git-operations-api` spec/code divergence on the `orphan-cleanup`
  containment anchor, and state the anchor in resolved-checkout terms.
- Fix the "Not a pi project yet — Set up" banner on a submodule session
  (`resolveConfigRoot`'s half of the bug).
- `listWorktrees.isMain` reports a checkout, never a GITDIR.

**Non-Goals:**

- Changing the resolver itself. `packages/shared/src/platform/git.ts` is input
  here; a resolver defect is a change-1 follow-up, not this change.
- Supporting worktree CREATION where no main checkout resolves — a bare hub and
  a worktree of a bare hub. Those become explicit refusals, not new features.
  (A submodule, a superproject and a `--separate-git-dir` CHECKOUT all resolve
  a main checkout and keep working; only their anchor moves.)
- Caching/memoising git probes beyond what already exists
  (`directory-service.ts` memoises `resolveConfigRoot` per cwd).
- Client REDESIGN. Response shapes stay unchanged (same fields, same types) and
  no new client surface is built. The one exception is deliberate and owned
  here: D4 narrows `isMain` from "exactly one" to "at most one", and the
  `WorktreeList` reads that assumed an always-present main entry are corrected
  in this change (see D4). Treating the client as fully out of scope would ship
  those regressions.

## Decisions

### D1 — `resolveMainPath` returns the resolved MAIN CHECKOUT, or `null`

`resolveMainPath(cwd)` becomes a thin wrapper over
`checkoutRoots({ cwd })?.mainCheckout ?? null`, plus the consumer-side
`.git`-segment rejection (`hasGitPathSegment`) that the resolver deliberately
leaves to consumers.

Resulting behaviour change per git state (superseded → new):

| cwd state | old `resolveMainPath` | new |
|---|---|---|
| normal checkout / subdir | `<r>/normal` | `<r>/normal` (unchanged) |
| linked worktree | `<r>/normal` | `<r>/normal` (unchanged) |
| submodule | `<r>/super/.git/modules/models` (dirname of the git dir) | `<r>/super/models/sub` |
| worktree of submodule | `<r>/super/.git/modules/models` | `<r>/super/models/sub` |
| `--separate-git-dir` | parent of the sidecar | `<r>/sepco` |
| bare repo | parent of the hub | `null` |
| worktree of bare hub | parent of the hub | `null` |
| non-repo | `null` | `null` |

*Why not a new name?* A parallel `resolveCheckoutMain` would leave the existing
call sites free to keep the wrong one, and the wrong one is the delete anchor.
One name, one meaning. Population (a) already branches on `null`, so the change
there is behavioural-only; population (b) must be **rewritten** to call
`resolveMainPath` and to drop its private `commonDirRaw` branch — that is real
work, not a rename, and the migration plan schedules it as such.

`resolveMainPath` SHALL pass an explicit `timeout` to `checkoutRoots` (see D7);
it SHALL NOT inherit the recipes' batch-job default.

*Why keep a server-local wrapper at all rather than calling `checkoutRoots`
inline?* The `.git`-segment rejection is an authorization-grade check that must
not be optional at a delete boundary, and the wrapper is where it lives once.

**Alternative rejected:** returning `thisCheckout` when `mainCheckout` is
`null`. That silently turns "this repo has no main checkout" into "this
worktree IS the main checkout" — the exact inversion D3 exists to prevent.

### D2 — `null` is a REFUSAL at every consumer, never a fallback

Every converted consumer already branches on `null`; the conversion widens WHEN
`null` occurs (bare hub, worktree of bare hub, inconclusive probe) and each
branch must remain a refusal:

- `addWorktree` / `addWorktreeFromPr` → `not_a_repo`, no path derivation
  (replacing their private `commonDirRaw` branch, which already returns
  `not_a_repo` — the code is preserved, the condition widens);
- `pruneWorktrees` → `not_a_worktree` (already its behaviour today; unchanged);
- `removeWorktree` → the tri-state guard (D3) owns its refusal codes
  (`is_main_worktree` / `main_checkout_unresolved`). Its own `not_a_worktree`
  branch stays as a defence-in-depth backstop but is unreachable once the route
  classifies first — the endpoint SHALL NOT surface `not_a_worktree` for an
  unresolved main checkout, because the guard's codes are the truthful ones;
- `mergeWorktree`, diff-stat → `not_a_worktree`. **This is a client-visible
  code change:** both return `git_failed` today (git-operations.ts:1118, :1200),
  which `git-routes.ts` maps to HTTP 500. `MergeCode` must be widened to carry
  `not_a_worktree` and the route must map it to HTTP 400. A refusal caused by
  an unresolvable checkout is a 4xx, not a server error;
- `createPullRequest` → **the dead `mainPath` assignment is DELETED, not
  converted.** `gh pr create` runs in `cwd` and needs no main checkout;
  making it refuse on `mainCheckout === null` would newly break PR creation
  from a worktree of a bare hub, which works today. Same for `pushBranch`,
  which never resolved a main checkout — both are explicitly OUT of the
  refusal set;
- `sweepResidualWorktreeDir` → unreachable (its caller refuses first), and it
  keeps its own `.worktrees/` containment guard regardless;
- `orphanCleanup` → `outside_repo`;
- `resolveConfigRoot` → `null` → init-status reports `hasHook: false`.

No consumer may substitute `cwd`, `thisCheckout`, or `dirname(commonDir)` for a
`null` main checkout. A delete or a write anchored at a guessed root is the
failure mode this change exists to remove.

### D3 — `isMainWorktree` is derived from `isLinkedWorktree`, and refuses when unresolved

This is the regression named in the proposal. The guard protects
`POST /api/git/worktree/remove` and `/remove-batch` from deleting the main
checkout; today it is `mainPath != null && resolve(mainPath) === resolve(cwd)`.
A naive conversion makes a worktree-of-bare-hub cwd resolve `mainPath = null`
→ `false` → "not the main worktree, proceed".

New derivation, from the resolver's own signal instead of a path equality:

| resolver result | verdict | route behaviour |
|---|---|---|
| `null` (no result / non-repo / probe failure) | `unresolved` | refuse, code `main_checkout_unresolved` |
| `isLinkedWorktree === false` | `main` | refuse, code `is_main_worktree` |
| linked, `thisCheckout === null` (inconclusive `--show-toplevel`) | `unresolved` | refuse, code `main_checkout_unresolved` |
| linked, `mainCheckout === null` | `unresolved` | refuse, code `main_checkout_unresolved` |
| linked, `mainCheckout` carries a `.git` segment | `unresolved` | refuse, code `main_checkout_unresolved` |
| linked, `mainCheckout` plausible | `removable` | proceed |

Two properties this buys beyond fail-closed:

- a cwd in a SUBDIRECTORY of the main checkout is now `main` (it is not a
  linked worktree), where the old path equality said "not main" and handed the
  request to git;
- a submodule, a `--separate-git-dir` checkout and a bare repo are all
  `isLinkedWorktree === false` → `main` → refused, instead of being removable.

The helper is expressed as a tri-state (`"main" | "removable" | "unresolved"`),
not a boolean: a boolean forces the caller to pick which of the two refusal
reasons to collapse into, and the two are not the same message to a user.

The `thisCheckout === null` row is not redundant with the `mainCheckout === null`
row: the resolver can return a **plausible `mainCheckout` from `core.worktree`
or the dirname rule while `--show-toplevel` failed or timed out**
(`resolveCheckoutRootsFrom`, git.ts:423-446 — `thisCheckout` is set at :424
independently of the `core.worktree` rule at :430-437 and the dirname rule at
:444-447). The extension consumer already
treats that combination as inconclusive and refuses; letting the most
destructive boundary in the server call it `removable` would treat the same
signal two ways. Fail closed.

**Alternative rejected:** keep the boolean and return `true` on unresolved.
The refusal would be correct but the surfaced reason ("this is the main
worktree") would be false, and false reasons at a delete boundary become
support load and, later, someone "fixing" the guard.

### D4 — `listWorktrees.isMain` is resolved, not positional

The positional stamp lives in the PURE parser `parsePorcelainWorktrees`
(`git-worktree.ts:98`, `isMain: out.length === 0`), not in `listWorktrees`.
Therefore: the **parser stops deciding** — it emits `isMain: false` for every
record — and `listWorktrees` assigns `isMain` afterwards by comparing each
entry's path with the resolved `mainCheckout` via `samePath`. Leaving the
parser's stamp in place and "overwriting" it would leave the first record
`true` on every code path that forgets to overwrite.

The same `.git`-segment rejection D1 applies to the operational anchor applies
here: `mainCheckout` is returned verbatim from user-controlled `core.worktree`,
so a crafted value equal to a GITDIR row must not mark that row `isMain` —
which is exactly the bug D4 exists to remove. Reuse `resolveMainPath`, not a
raw `checkoutRoots` call, so the rejection cannot be forgotten.

When no main checkout resolves (bare hub), NO entry is `isMain` — the shape
becomes "at most one", not "exactly one". The `bare` flag already distinguishes
the hub record, so a client that wants "the repo's anchor row" has a signal.

**This is a semantic break, not an additive change.** The response *shape*
(fields, types) is unchanged, but "there is always a main entry" stops holding.
The audited client call sites, and their real exposure:

- `WorktreeSpawnDialog.tsx:193,200` — `find((w) => w.isMain)` behind an
  `if (!main)` guard. Already null-safe; no change needed.
- `WorktreeList.tsx:106` — `find((e) => e.isMain)?.path ?? null`. Already
  null-safe.
The remaining reads are BOOLEAN uses of `isMain`, not `find` calls — a
`.find(w => w.isMain)` audit structurally cannot locate them, so the audit is
specified as "every read of `isMain` in `packages/client/`":

- `WorktreeList.tsx:117` — `matchesDefault = row.entry.isMain ||
  (!row.entry.detached && row.inTree)`. **This is the worst of them.** `inTree`
  comes from `isInTree(path, mainPath)`, which returns `false` unconditionally
  when `mainPath` is `null` (:47-49), and `mainPath` comes from the `isMain`
  entry (:106). With no `isMain` entry, EVERY row fails the default predicate
  and the bare-hub list renders **empty** by default — reachable only via the
  out-of-tree reveal chip. A blank list is a worse outcome than the wrong
  `isMain` it replaced. Fix: when `mainPath` is `null`, the default view SHALL
  fall back to showing every non-detached registered entry rather than
  filtering on an unresolvable `.worktrees/` prefix.
- `WorktreeList.tsx:199` — `selectable = visible.filter((r) => !r.entry.isMain
  && !r.missing)`; `:397` — the per-row selection checkbox, rendered on
  `!entry.isMain && !row.missing`; `:440` — the per-row Remove button,
  rendered when `!entry.isMain`. All three treat "not main" as "removable".
  Today the bare hub's record is positionally `isMain: true` and is excluded
  from each; after D4 no record is `isMain`, so the hub row gains a checkbox, a
  Remove button, and batch-selectability. The server refuses it (D3 →
  `is_main_worktree`, since a bare cwd is not a linked worktree), so these are
  UI-honesty defects rather than delete hazards — but offering a doomed action
  is a regression this change introduces and therefore owns.

The correction is one shared predicate, not three edits: a row is removable
when it is neither `isMain` NOR `bare` (and not missing). `:199`, `:397` and
`:440` SHALL all consume it, so the checkbox, the batch bar and the button
cannot disagree — today `toggle()` (:203) has no guard of its own, so a
divergence between the checkbox and `selectable` would leave a row selected
that the batch bar does not count.

`listWorktrees` gains one resolver call. It is invoked from `orphanCleanup`
and `computeOrphanLikely`, so the resolution SHALL be passed in or resolved
once per request, not re-derived per entry (D7).

### D5 — `resolveConfigRoot` drops the `isGitRepo` probe

Current: `isGitRepo(cwd) ? resolveMainPath(cwd) : <non-git .pi check>`.
`isGitRepo` is `--is-inside-work-tree`, which is FALSE inside a bare repo — so
a bare repo currently falls into the NON-git branch and can adopt
`<bare>/.pi/settings.json` as a config root.

New: a single `checkoutRoots(cwd)` call decides both questions.

- result non-`null` → the cwd IS in a repository → return `mainCheckout`
  (possibly `null`; a bare hub has no config root, and does NOT fall through);
- result `null` → not a repository → the existing `cwd/.pi/settings.json`
  check, no upward walk.

This removes the bare-repo fall-through and fixes the submodule banner: a
submodule now resolves to its own checkout, where `.pi/settings.json` actually
lives. (It is one probe *call* instead of two, not fewer spawns — see D7.)

**The `null` must survive its consumer.** `directory-service.ts:358-369`
memoises `resolveConfigRoot` per cwd and then coerces
`readinessConfigRoots.get(cwd) ?? cwd` — so a `null` config root becomes the
cwd itself, and the readiness path probes `<bare>/.pi/skills/…`. That is
precisely the adoption D5 forbids, re-entered through the back door. The
coercion SHALL be removed: `configRootFor` returns `string | null` and its
callers skip the probe on `null` rather than substituting `cwd`. The memo also
caches `null` for the process lifetime; that is accepted (it matches today's
behaviour for every other value) and noted as a trade-off, not fixed here.

### D6 — `orphanCleanup` anchors at the resolved main checkout AND realpaths the target

Two defects, one call site:

1. **Spec/code divergence.** The spec says `path` must be "inside `cwd`"; the
   code contains it to `dirname(--git-common-dir)`. Resolution: the spec is
   corrected to the code's INTENT (a repository-root anchor, so an orphan can
   be cleaned from any worktree of the repo), with the anchor restated as the
   resolved main checkout. `null` → `outside_repo`.
2. **Symlink escape.** The containment test is `path.resolve` only, while the
   sibling delete boundary (`sweepResidualWorktreeDir`) realpaths both sides. A
   symlink inside the repo root pointing outside it therefore passes
   containment and is recursively deleted. The target and the anchor SHALL both
   be realpath-resolved before the prefix test, matching the sweep.

   **Order of operations is pinned**, because `fs.realpathSync` throws `ENOENT`
   on a missing path and would otherwise convert a clean `not_a_directory`
   refusal into an unspecified error: (i) resolve the anchor, (ii) `path.resolve`
   the target and apply the logical containment test, (iii) `statSync` the
   target → `not_a_directory` when absent or not a directory, (iv) realpath BOTH
   sides and re-apply containment → `outside_repo` on failure, (v) the remaining
   guards **in their existing relative order** — registered-worktree
   (`not_orphan`, git-operations.ts:1474-1487) before the `.git`-entry check
   (`looks_like_worktree`, ~:1498) before the file-count / file-size caps — so
   an input matching several keeps the code it returns today. A realpath that
   throws for a reason other than "not found" is refused with the endpoint's
   existing `fs_failed` code (:1393), never passed.

The file-count / file-size / `.git`-entry / registered-worktree guards are
unchanged.

### D7 — Probe budget: accept, do not cache

`checkoutRoots` costs up to five sync `git` spawns where the old derivation
cost one. Every converted call site is a user-initiated, localhost-gated admin
action (create/remove/merge/prune/cleanup) or already memoised
(`directory-service.ts` for `resolveConfigRoot`). No new cache: a cache keyed
on cwd at a delete boundary is a staleness hazard for a marginal win on a
non-hot path.

Two things the naive accounting misses, both addressed rather than accepted:

1. **Per-request de-duplication.** `/remove` would resolve TWICE under the
   naive conversion — once in the route's tri-state guard and once inside
   `removeWorktree`. (`branchOfWorktree` runs its own porcelain exec at
   git-operations.ts:1033; it takes an already-resolved `mainPath` and adds no
   third resolution.) The resolution SHALL happen ONCE per request and be
   threaded to the operation (the classification already carries the resolved
   `mainCheckout`). The unit is ONE PER CWD, not one per HTTP request:
   `/remove-batch` classifies per item by design (each item is an independent
   delete decision against live git state), so it resolves once per distinct
   item cwd. `/remove-batch` (cap 50) is the multiplier that makes this matter:
   50 × 5 spawns is acceptable, 50 × 10 is not.
2. **Explicit timeout.** `checkoutRoots` defaults to the recipes' batch budget
   (`GIT_TIMEOUT`, 15 s) per probe; on a hung filesystem that is a multi-minute
   synchronous stall on the event loop. The established precedent for a
   request-path consumer is `kb-routes`' `checkoutRoots({ cwd, timeout: 400 })`,
   and the resolver's own docstring says a request-path guard "must not inherit
   a batch-job budget". `resolveMainPath` SHALL pass `timeout: 400`.

Each item of `/remove-batch` remains an independent delete decision evaluated
against live git state — no cross-item reuse.

### D8 — The `/remove-batch` cap moves from a constant to configuration

`REMOVE_BATCH_CAP = 50` is a module-level const in `git-routes.ts:721`. D7
makes the cap the multiplier that decides whether the per-request resolution
count matters, so the number stops being an implementation detail and becomes
the knob an operator turns when 50 blocking removals per request is the wrong
trade for their machine.

It becomes a `DashboardConfig` numeric field following the established
`readinessTimeoutMs` pattern in `packages/shared/src/config.ts`: a default (50,
so an unset config is byte-identical to today), a clamp into a bounded range,
and a fallback to the default on anything non-numeric or non-positive. The
clamp is not decoration — a cap of 0 disables the batch endpoint the manage-
worktrees UI depends on, and an unbounded cap turns one HTTP request into an
unbounded run of `execSync` removals on the event loop, which is the exact
hazard the original constant existed to bound.

The `batch_too_large` code and the per-item semantics are untouched; only the
source of the number and the message text change.

*Why here and not a separate change?* D7 is the reason the cap is load-bearing:
the latency budget is stated per ITEM precisely because the item count is about
to stop being fixed at 50. Splitting them would leave this change asserting a
budget against a number another change is removing.

## Risks / Trade-offs

- **Behaviour change for `--separate-git-dir` / bare users** → a previously
  "working" (wrong-anchored) create or remove now refuses with a stable code.
  Mitigation: refusals are explicit codes, not silent no-ops; the states are
  documented in the measured table.
- **`/remove` gains a new error code** (`main_checkout_unresolved`) → clients
  must not treat an unknown code as success. Mitigation: the client already
  renders unknown codes as a generic failure; the code is additive and covered
  by the spec delta.
- **`merge` and `diff-stat` change an existing code** (`git_failed` → 
  `not_a_worktree`) and with it the HTTP status (500 → 400). Mitigation: the
  new code is more truthful and the union widening is compile-checked; the
  route's code→status map is updated in the same step.
- **`isMain` "exactly one" → "at most one"** → the `find` consumers are already
  null-safe, but `WorktreeList.tsx:199`'s `!isMain` selectable filter newly
  offers the bare hub row for batch removal. Mitigation: add the `bare`
  exclusion in this change (a task, not a follow-up); the previous `isMain`
  value was a GITDIR, i.e. already unusable as a checkout path.
- **Probe latency** → up to five spawns per resolution, multiplied by
  `/remove-batch`'s cap of 50. Mitigation: D7 — one resolution per request
  threaded through, plus an explicit `timeout: 400` so a hung filesystem cannot
  stall the event loop for minutes.
- **A misconfigured batch cap changes endpoint availability** → an operator
  setting 0 (or a huge value) alters behaviour the UI depends on. Mitigation:
  D8's clamp + default fallback; neither end is reachable by configuration.
- **`configRootFor` loses its `?? cwd` coercion** → every caller must handle
  `null`. Mitigation: the type changes to `string | null`, so the compiler
  enumerates the call sites.
- **`realpath` tightening in `orphanCleanup`** → a legitimately symlinked
  `.worktrees` parent could now refuse where it previously accepted.
  Mitigation: this is the fail-closed direction, and it matches the sweep's
  existing, shipped behaviour.
- **Two recursive-delete boundaries move under a new derivation** → an `Audit`
  subagent pass over the diff is mandatory before ship, per the proposal.

## Migration Plan

Order is load-bearing, with one honest caveat: step 1 changes
`resolveMainPath` itself, and two of its seven existing call sites
(`removeWorktree`, `isMainWorktree`) are on the delete path. Step 1 therefore
does move the delete anchor — it cannot not. What the ordering buys is that
step 1 is a pure, fixture-covered swap of ONE function whose behaviour is
pinned by the measured table BEFORE any call site is restructured, and that
every later step's *structural* change (new codes, new guards, converted
inline copies) lands on read-only surfaces first. The delete boundaries'
restructuring is last:

1. `resolveMainPath` rewrapped (D1) with `timeout: 400` (D7) + unit coverage
   over the fixture matrix. Population (a) inherits the new behaviour here.
2. `resolveConfigRoot` (D5) — read-only; fixes the banner. Includes removing
   `directory-service.ts`'s `?? cwd` coercion.
3. `listWorktrees.isMain` (D4) — read-only. Includes moving the stamp out of
   `parsePorcelainWorktrees`, and auditing EVERY read of `isMain` in
   `packages/client/` (not just `.find` calls — the boolean reads at
   `WorktreeList.tsx:117/397/440` are the ones that regress): the
   `mainPath === null` default-view fallback plus the shared
   not-main-and-not-bare removable predicate.
4. `isMainWorktree` → tri-state guard (D3) + route wiring + the new code.
5. Non-destructive lifecycle ops: `mergeWorktree` + diff-stat (code widening),
   `pruneWorktrees` (no-op), and the population-(b) conversions `addWorktree` /
   `addWorktreeFromPr`. Delete `createPullRequest`'s dead `mainPath` line.
6. Delete boundaries last: `removeWorktree` / `sweepResidualWorktreeDir`
   (single-resolution threading per D7), then `orphanCleanup` (D6 — conversion
   AND realpath ordering AND `fs_failed`). `Audit` pass over the combined diff.
7. `/remove-batch` cap → configuration (D8). Independent of the resolver work;
   lands after the delete boundaries so a config regression cannot be confused
   with an anchor regression.
8. Spec hygiene: the base `Create worktree endpoint` requirement mandates the
   superseded `dirname(--git-common-dir)` derivation in its step 2 and assumes
   `<repo-root>/.git/info/exclude` in its step 5. Both are corrected by this
   change's MODIFIED block — without it, sync/archive would leave the main
   spec demanding the derivation the change exists to remove.

Rollback: each step is an independent revert; the resolver itself is untouched,
so reverting a step restores the superseded derivation at that call site only.

## Open Questions

None that can be deferred. The `isMainWorktree` inversion (D3), the
`orphanCleanup` anchor (D6) and the `isMain` cardinality change (D4) are all
resolved above because each would otherwise change the specs.

Accepted trade-offs, recorded rather than fixed here:

- `directory-service.ts` memoises a `null` config root for the process
  lifetime, so a directory that becomes a repository mid-session keeps its
  earlier answer. Pre-existing for every other value; out of scope.
- A non-repo cwd reaching `/remove` classifies as `unresolved`
  (`main_checkout_unresolved`) rather than `not_a_repo`. Deliberate: the guard
  runs before any repo probe, and collapsing the two would reintroduce the
  untruthful-reason problem D3 exists to remove.
