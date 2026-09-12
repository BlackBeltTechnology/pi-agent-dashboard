# Test Plan — apply-checkout-root-to-worktree-ops

Stage: apply   Generated: 2026-06-15

## Clarifications

- [x] **C1** — RESOLVED. `/remove-batch` latency is a **per-item** budget, not a
      whole-batch one, because the item cap itself becomes configurable (D8) —
      a threshold tied to "50 items" would go stale the moment an operator
      changes the cap. P2 below asserts p95 per item over a full batch at
      whatever cap is configured.

> No open clarifications. Every row is fully specified.

---

## Scenarios

Fixture source for every L1 row that needs a real git state:
`packages/shared/src/test-support/git-fixtures.ts` → `buildGitFixtures()`
(normal, deep subdir, linked worktree, superproject, submodule,
worktree-of-submodule, bare hub, worktree-of-bare, `--separate-git-dir`,
a checkout named `app.git`, non-repo).

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 anchor (D1 table) | EP over git states | L1 | automated | each of the 9 fixture states | `resolveMainPath(cwd)` | returns exactly the D1 "new" column: normal/subdir/linked → `<r>/normal`; submodule + worktree-of-submodule → the submodule working tree; separate-git-dir → the checkout; bare + worktree-of-bare → `null`; non-repo → `null` |
| E2 | R1 `.git`-segment rejection | BVA (exact component equality) | L1 | automated | a repo whose repo-local `core.worktree` points inside `.git/`, and the `app.git` fixture checkout | `resolveMainPath(cwd)` | `null` for the `.git`-segment path; a real path for `app.git` (a `.git` SUFFIX is not a segment) |
| E3 | R1 explicit timeout | invariant assertion | L1 | automated | any repo fixture, `checkoutRoots` spied | `resolveMainPath(cwd)` | the spy receives `timeout: 400`; it is never called with `undefined`/the 15 s default |
| E4 | R2 tri-state classification | decision table | L1 | automated | the 5 resolver results (no result; not-linked; linked+`thisCheckout` null; linked+`mainCheckout` null; linked+plausible) injected via `resolveCheckoutRootsFrom` probes | classify `cwd` | verdicts `unresolved`, `main`, `unresolved`, `unresolved`, `removable` — one verdict per row, no default branch |
| E5 | R2 main refused | state-transition (illegal edge) | L1 | automated | `cwd` = the main checkout | `POST /api/git/worktree/remove` | `{ success: false, code: "is_main_worktree" }`, HTTP 400, no `git worktree remove` invoked, directory intact |
| E6 | R2 unresolved refused | state-transition (illegal edge) | L1 | automated | `cwd` = worktree of the bare hub | `POST /api/git/worktree/remove` | `{ success: false, code: "main_checkout_unresolved" }`, HTTP 400, worktree directory still on disk |
| E7 | R2 subdir is main | BVA (path depth) | L1 | automated | `cwd` = `<main>/src` | `POST /api/git/worktree/remove` | code `is_main_worktree`, HTTP 400, no git removal invoked |
| E8 | R2 submodule is main | EP | L1 | automated | `cwd` = the submodule working tree | `POST /api/git/worktree/remove` | code `is_main_worktree`, HTTP 400 |
| E9 | R2 removable still works | state-transition (legal edge) | L1 | automated | `cwd` = an ordinary linked worktree | `POST /api/git/worktree/remove` | removal proceeds and succeeds exactly as before the change |
| E10 | R2 batch per item | decision table | L1 | automated | batch of 3: ordinary linked worktree, main checkout, worktree-of-bare | `POST /api/git/worktree/remove-batch` | 3 results in input order with codes success, `is_main_worktree`, `main_checkout_unresolved`; the batch does not abort after item 2 |
| E11 | R2 inconclusive refused | fault injection into a probe | L1 | automated | linked worktree whose `--show-toplevel` probe yields nothing while `core.worktree` still resolves a main checkout | `POST /api/git/worktree/remove` | code `main_checkout_unresolved`, HTTP 400, nothing deleted (NOT classified `removable`) |
| E12 | R4 bare hub never main | EP | L1 | automated | bare hub with one linked worktree, called from the worktree | `GET /api/git/worktrees` | the hub entry is `{ isMain: false, bare: true }` and NO entry has `isMain: true` |
| E13 | R4 submodule lists own checkout | EP | L1 | automated | `cwd` inside the submodule | `GET /api/git/worktrees` | the submodule working-tree entry has `isMain: true`; no entry under `<super>/.git/` has `isMain: true` |
| E14 | R4 parser stops stamping | invariant assertion | L1 | automated | porcelain text with 3 records | `parsePorcelainWorktrees(text)` | every returned record has `isMain: false`, including the first |
| E15 | R4 `.git` segment on isMain | BVA | L1 | automated | repo whose `core.worktree` resolves to a path equal to a GITDIR record | `GET /api/git/worktrees` | that record is NOT `isMain`; no entry is `isMain` |
| E16 | R3 create anchors in submodule | EP | L1 | automated | `cwd` inside the submodule, no explicit `path` | `POST /api/git/worktree` | derived path is under the submodule working tree, never under `<super>/.git/` |
| E17 | R3 create refuses unresolved | EP × explicit-path flag | L1 | automated | `cwd` in a bare hub — once WITHOUT `path`, once WITH an explicit `path` | `POST /api/git/worktree` | both return `not_a_repo`; no directory is created on disk in either case |
| E18 | R3 exclude location | EP | L1 | automated | submodule and `--separate-git-dir` checkouts | `POST /api/git/worktree` succeeds | `.worktrees/` is appended to `info/exclude` inside the repository's COMMON GIT DIR, not `<checkout>/.git/info/exclude`; appending twice does not duplicate the line |
| E19 | R6 config-root per state | EP | L1 | automated | submodule, worktree-of-submodule, separate-git-dir, bare-with-`.pi/settings.json`, non-git-with-settings, non-git-without, nested non-git child | `resolveConfigRoot(cwd)` | submodule/worktree-of-submodule → the submodule tree; separate-git-dir → the checkout; bare → `null` (no fall-through to `cwd`); non-git+settings → `cwd`; non-git without → `null`; child does NOT inherit the parent's settings |
| E20 | R6 null not coerced | invariant assertion | L1 | automated | a bare repo containing `.pi/settings.json`, readiness path | the config-root lookup returns `null` | the consumer skips the probe; it never probes under `cwd`; the lookup's type permits `null` (no `?? cwd`) |
| E21 | R1 merge/diff-stat code | state-transition | L1 | automated | `cwd` = worktree of a bare hub | `POST /api/git/worktree/merge`, `GET /api/git/worktree/diff-stat` | both return code `not_a_worktree` with HTTP 400 — not the previous `git_failed`/HTTP 500 |
| E22 | R1 push/pr exempt | EP (negative) | L1 | automated | `cwd` = worktree of a bare hub | `POST /api/git/worktree/push`, `POST /api/git/worktree/pr` | both proceed against `cwd` as today; neither is refused with `not_a_worktree`; no main-checkout resolution gates them |
| E23 | R5 anchor is resolved checkout | EP | L1 | automated | `cwd` inside the submodule, orphan dir inside the submodule working tree, all other guards passing | `POST /api/git/worktree/orphan-cleanup` | `{ ok: true }`, the directory is deleted |
| E24 | R5 cleanable from a sibling | EP | L1 | automated | `cwd` = a linked worktree; orphan dir under the MAIN checkout | `POST /api/git/worktree/orphan-cleanup` | `{ ok: true }` — the anchor is the resolved main checkout, not the request `cwd` |
| E26 | R7 default cap | BVA | L1 | automated | no batch cap configured | `POST /api/git/worktree/remove-batch` with 50 items, then 51 | 50 accepted; 51 rejected with `batch_too_large` — unset config is identical to today |
| E27 | R7 configured cap boundary | BVA | L1 | automated | batch cap configured to 10 | post 10 items, then 11 | 10 accepted; 11 rejected with `batch_too_large`; no git command runs for the rejected batch |
| E28 | R7 invalid cap falls back | EP (invalid partition) | L1 | automated | cap configured to `0`, `-1`, `2.5`, `"many"`, `null` | post a batch | effective cap is the default for every invalid value: the endpoint neither rejects all batches nor accepts an unbounded one |
| E29 | R7 message names effective cap | invariant assertion | L1 | automated | cap configured to a non-default value | post an oversized batch | the error message states the EFFECTIVE cap, not a hardcoded 50 |
| E25 | R5 guard order preserved | decision table | L1 | automated | a path that is BOTH registered in `git worktree list` AND contains a top-level `.git` entry | `POST /api/git/worktree/orphan-cleanup` | code `not_orphan` (the code it returns today), not `looks_like_worktree` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | R1 once per distinct cwd | spawn-count invariant | L1 | automated | one `POST /api/git/worktree/remove`, then one `/remove-batch` with 3 distinct cwds | resolver invocations = 1 for `/remove`; = 3 (one per distinct item cwd) for the batch; never 2× per cwd | single request |
| P2 | D7 + D8 batch latency | tail-latency (cap-independent) | L2 | automated | `/remove-batch` filled to the CONFIGURED cap (default 50) with real worktrees | p95 < 100 ms per item, measured as total wall-clock ÷ item count; the figure SHALL NOT be expressed against a fixed 50 | one full batch, 5 repetitions |
| P3 | R1 timeout bound | fault injection (delay) + threshold | L1 | automated | a git probe stubbed to hang | `resolveMainPath` returns within ~400 ms × probe count, never the 15 s batch budget; the event loop is not blocked past that bound | single call |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R4 client default view | state-transition | L1 | automated | worktree entries where NO entry has `isMain` (bare hub + one linked worktree) | `WorktreeList` renders in its default view | both registered entries are visible; the list does not converge to empty; no reveal/out-of-tree control is required to see them |
| F2 | R4 no removal affordance | decision table | L1 | automated | entry `{ bare: true, isMain: false }` alongside an ordinary linked worktree | `WorktreeList` renders | the bare entry exposes neither a per-row Remove control nor a selection checkbox; the ordinary worktree exposes both |
| F3 | R4 selection consistency | state-convergence | L1 | automated | the same bare-hub entry set | attempt to select every row, then read the batch bar | the set the batch bar counts equals the set of rows that rendered a checkbox — no row can be selected that the batch bar excludes |
| F4 | R4 dialog tolerates no main | state-transition (illegal edge) | L1 | automated | `worktrees` response with zero `isMain` entries | `WorktreeSpawnDialog` opens | renders without error; no dereference of an absent main entry |
| F5 | R4 ordinary repo unregressed | state-convergence | L3 | automated | the docker harness repo (ordinary checkout + a linked worktree) | open the worktree manage surface, remove the linked worktree | the list shows exactly one `isMain` row; removal succeeds and the row disappears — the `isMain` rederivation did not regress the common path |
| F6 | R6 submodule banner fixed | state-convergence | L3 | automated | a session whose cwd is a submodule checkout carrying `.pi/settings.json` | open the folder/session surface | the "Not a pi project yet — Set up" banner is ABSENT and the declared hook is reported instead |
| M1 | R2 refusal copy | human judgment | — | manual-only | the two refusal codes `is_main_worktree` and `main_checkout_unresolved` surfaced in the UI | a human reads both messages | [judgment: each message states a reason that is TRUE for the state that produced it, and a user can tell the two apart — the proposal's "false reasons become support load" concern] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R5 symlink escape | fault injection (crafted FS) | L1 | automated | `path` is inside the resolved main checkout but is a symlink whose target resolves outside it | `POST /api/git/worktree/orphan-cleanup` | code `outside_repo`, HTTP 400; neither the link nor its target is deleted |
| X2 | R5 missing path | fault injection (absent target) | L1 | automated | `path` is inside the anchor but does not exist | same | code `not_a_directory`; NOT `outside_repo`; no unhandled `ENOENT` escapes |
| X3 | R5 unreadable target | fault injection (abort) | L1 | automated | symlink resolution fails with a non-not-found error (EACCES / ELOOP) | same | code `fs_failed`; nothing deleted; the failure is never treated as a pass |
| X4 | R5 TOCTOU | fault injection (race) | L1 | automated | target deleted between the existence check and symlink resolution | same | code `not_a_directory`; no success response; the later guards are not evaluated |
| X5 | R5 no anchor | EP (negative) | L1 | automated | `cwd` inside a bare repo / worktree of a bare hub | same | code `outside_repo`, HTTP 400; nothing deleted |
| X6 | R1 probe failure fails closed | fault injection (abort) | L1 | automated | every checkout-root probe stubbed to fail | create, from-pr, merge, prune, diff-stat, remove, orphan-cleanup | each refuses with its own established code; NO endpoint substitutes `cwd`, `thisCheckout`, or `dirname(--git-common-dir)`; nothing is created or deleted |
| X7 | R3 from-pr refuses | EP (negative) | L1 | automated | `cwd` for which no main checkout resolves | `POST /api/git/worktree/from-pr` | `not_a_repo`; no directory created on disk |

---

## Coverage summary

- Requirements covered: 7/7 (R1 anchor, R2 removal guard, R3 create, R4 list, R5 orphan-cleanup, R6 config root, R7 configurable batch cap)
- Scenarios by class: edge 29 · perf 3 · frontend 7 · error 7
- Scenarios by level: L1 40 · L2 1 · L3 2 · manual-only 1
- Scenarios by disposition: automated 45 · manual-only 1

## New infra needed

None. Every level already exists: L1 vitest suites in
`packages/server/src/__tests__/` and `packages/client/src/components/__tests__/`,
the nine-state fixture builder in `packages/shared/src/test-support/`, L2 in
`qa/tests/`, L3 Playwright in `tests/e2e/` against the docker harness (read the
port from `.pi-test-harness.json` → `dashboardPort`; never hardcode `:18000`).
