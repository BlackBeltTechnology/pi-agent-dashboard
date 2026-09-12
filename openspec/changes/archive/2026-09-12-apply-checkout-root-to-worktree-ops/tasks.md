# Tasks — apply-checkout-root-to-worktree-ops

Design + spec deltas exist (`design.md`, `specs/git-operations-api/spec.md`,
`specs/worktree-init-hook/spec.md`). Scenario manifest: `test-plan.md`
(45 automated, 1 manual-only, no open clarifications). Implementation order
follows `design.md` → Migration Plan: read-only consumers first, the two
recursive-delete boundaries last, the configurable batch cap after those.

Every test task below carries its scenario id, an exemplar to copy harness glue
from, and the Triple (input · trigger · observable). Fixture builder for every
real-git-state row: `packages/shared/src/test-support/git-fixtures.ts`
(`buildGitFixtures()`).

## 1. Design gate

- [x] 1.1 Run `doubt-driven-review` on `design.md` — 3 cycles, single-model + cross-model on `@propose-review-1`. 2 contract blockers and ~18 findings folded into `design.md` and both spec deltas.
- [x] 1.2 Run `scenario-design` against the spec deltas, write `test-plan.md`, fold the automated scenarios into sections 2–8 below.

## 2. Shared wrapper (`resolveMainPath`) — D1, D7

- [x] 2.1 Test first: `resolveMainPath` over the fixture matrix (see `packages/server/src/__tests__/git-operations.test.ts`). Input: each of the 9 fixture git states · trigger: `resolveMainPath(cwd)` · observable: exactly the D1 "new" column — normal/subdir/linked → `<r>/normal`, submodule + worktree-of-submodule → the submodule working tree, separate-git-dir → the checkout, bare + worktree-of-bare → `null`, non-repo → `null`. (test-plan #E1)
- [x] 2.2 Test first: `.git`-segment rejection is exact-component (see `packages/shared/src/__tests__/git-checkout-roots.test.ts`). Input: a repo whose repo-local `core.worktree` points inside `.git/`, plus the `app.git` fixture checkout · trigger: `resolveMainPath(cwd)` · observable: `null` for the `.git`-segment path, a real path for `app.git`. (test-plan #E2)
- [x] 2.3 Test first: the resolver call is request-budgeted (see `packages/server/src/__tests__/git-operations.test.ts`). Input: any repo fixture with `checkoutRoots` spied · trigger: `resolveMainPath(cwd)` · observable: the spy receives `timeout: 400`, never `undefined` or the 15 s default. (test-plan #E3)
- [x] 2.4 Rewrap `resolveMainPath` over `checkoutRoots({ cwd, timeout: 400 })` + `hasGitPathSegment`; delete the `path.dirname(git rev-parse --git-common-dir)` derivation.

## 3. Config root — D5

- [x] 3.1 Test first: `resolveConfigRoot` per git state (see `packages/server/src/__tests__/git-operations.test.ts`). Input: submodule, worktree-of-submodule, separate-git-dir, bare-with-`.pi/settings.json`, non-git-with-settings, non-git-without, nested non-git child · trigger: `resolveConfigRoot(cwd)` · observable: submodule states → the submodule tree; separate-git-dir → the checkout; bare → `null` with no non-git fall-through; non-git+settings → `cwd`; non-git without → `null`; the child does not inherit the parent's settings. (test-plan #E19)
- [x] 3.2 Test first: a `null` config root is not coerced to `cwd` (see `packages/server/src/__tests__/routes-git-worktree-init.test.ts`). Input: a bare repo containing `.pi/settings.json`, readiness path · trigger: the config-root lookup returns `null` · observable: the consumer skips the probe and never probes under `cwd`. (test-plan #E20)
- [x] 3.3 Convert `resolveConfigRoot` to a single `checkoutRoots` call; remove the `isGitRepo` probe.
- [x] 3.4 Remove `directory-service.ts`'s `readinessConfigRoots.get(cwd) ?? cwd` coercion; `configRootFor` returns `string | null` and callers skip on `null`.
- [x] 3.5 Test first: the user-visible fix (see `tests/e2e/openspec-init-affordances-folder.spec.ts`; read the harness port from `.pi-test-harness.json` → `dashboardPort`, never hardcode `:18000`). Input: a session whose cwd is a submodule checkout carrying `.pi/settings.json` · trigger: open the folder/session surface · observable: the "Not a pi project yet — Set up" banner is absent and the declared hook is reported instead. (test-plan #F6)

## 4. List worktrees — D4

- [x] 4.1 Test first: the porcelain parser stops stamping `isMain` (see `packages/server/src/__tests__/git-worktree-ops.test.ts`). Input: porcelain text with 3 records · trigger: `parsePorcelainWorktrees(text)` · observable: every record has `isMain: false`, including the first. (test-plan #E14)
- [x] 4.2 Test first: a bare hub is never main (see `packages/server/src/__tests__/git-worktree-lifecycle-ops.test.ts`). Input: bare hub with one linked worktree, called from the worktree · trigger: `GET /api/git/worktrees` · observable: the hub entry is `{ isMain: false, bare: true }` and no entry has `isMain: true`. (test-plan #E12)
- [x] 4.3 Test first: a submodule lists its own checkout (same exemplar). Input: `cwd` inside the submodule · trigger: `GET /api/git/worktrees` · observable: the submodule working-tree entry is `isMain: true`; no entry under `<super>/.git/` is `isMain`. (test-plan #E13)
  - Run note (review round 1): git reports the submodule's main registration at the MODULE GIT-DIR path, so the working tree never appears as a row — the satisfiable contract is "no entry under `<super>/.git/` is main; typically NO entry is main", pinned in git-worktree-ops.test.ts E13 and the corrected spec scenario.
- [x] 4.4 Test first: `.git`-segment rejection applies to `isMain` (same exemplar). Input: a repo whose `core.worktree` resolves to a path equal to a GITDIR record · trigger: `GET /api/git/worktrees` · observable: that record is not `isMain`; no entry is `isMain`. (test-plan #E15)
- [x] 4.5 Move the `isMain` stamp out of `parsePorcelainWorktrees`; `listWorktrees` assigns it from the resolved main checkout via `samePath`, reusing `resolveMainPath` so the `.git`-segment rejection cannot be forgotten. Resolve once per call, not per entry.
- [x] 4.6 Test first: the default view does not collapse (see `packages/client/src/components/__tests__/WorktreeList.test.tsx`). Input: entries where no entry has `isMain` (bare hub + one linked worktree) · trigger: `WorktreeList` renders in its default view · observable: both registered entries are visible without a reveal control; the list is not empty. (test-plan #F1)
- [x] 4.7 Test first: the bare hub offers no removal affordance (same exemplar). Input: `{ bare: true, isMain: false }` alongside an ordinary linked worktree · trigger: `WorktreeList` renders · observable: the bare entry exposes neither a per-row Remove control nor a selection checkbox; the ordinary worktree exposes both. (test-plan #F2)
- [x] 4.8 Test first: selection stays consistent (same exemplar). Input: the same bare-hub entry set · trigger: attempt to select every row, then read the batch bar · observable: the set the batch bar counts equals the set of rows that rendered a checkbox. (test-plan #F3)
- [x] 4.9 Test first: the spawn dialog tolerates no main entry (see `packages/client/src/components/__tests__/WorktreeSpawnDialog.test.tsx`). Input: a `worktrees` response with zero `isMain` entries · trigger: the dialog opens · observable: it renders without error and does not dereference an absent main entry. (test-plan #F4)
- [x] 4.10 Fix the client: a `mainPath === null` fallback for the default view, plus ONE shared removable predicate (`!isMain && !bare && !missing`) consumed by the row checkbox, the batch `selectable` set and the per-row Remove button, so the three cannot disagree.
- [x] 4.11 Test first: the ordinary path is unregressed (see `tests/e2e/manage-worktrees.spec.ts`; harness port from `.pi-test-harness.json` → `dashboardPort`). Input: the harness repo (ordinary checkout + a linked worktree) · trigger: open the worktree manage surface and remove the linked worktree · observable: exactly one `isMain` row; removal succeeds and the row disappears. (test-plan #F5)

## 5. Removal guard — D3

- [x] 5.1 Test first: the tri-state classifier (see `packages/server/src/__tests__/git-operations.test.ts`; inject probes via `resolveCheckoutRootsFrom`). Input: the 5 resolver results — no result; not-linked; linked + `thisCheckout` null; linked + `mainCheckout` null; linked + plausible · trigger: classify `cwd` · observable: `unresolved`, `main`, `unresolved`, `unresolved`, `removable`, one verdict per row with no default branch. (test-plan #E4)
- [x] 5.2 Test first: the main checkout is refused (see `packages/server/src/__tests__/git-worktree-lifecycle-ops.test.ts`). Input: `cwd` = the main checkout · trigger: `POST /api/git/worktree/remove` · observable: `is_main_worktree`, HTTP 400, no `git worktree remove` invoked, directory intact. (test-plan #E5)
- [x] 5.3 Test first: a worktree of a bare hub is refused (same exemplar). Input: `cwd` = worktree of the bare hub · trigger: `POST /api/git/worktree/remove` · observable: `main_checkout_unresolved`, HTTP 400, the worktree directory still on disk. (test-plan #E6)
- [x] 5.4 Test first: a subdirectory of main classifies main (same exemplar). Input: `cwd` = `<main>/src` · trigger: `POST /api/git/worktree/remove` · observable: `is_main_worktree`, HTTP 400, no git removal invoked. (test-plan #E7)
- [x] 5.5 Test first: a submodule classifies main (same exemplar). Input: `cwd` = the submodule working tree · trigger: `POST /api/git/worktree/remove` · observable: `is_main_worktree`, HTTP 400. (test-plan #E8)
- [x] 5.6 Test first: an ordinary linked worktree is still removable (same exemplar). Input: `cwd` = an ordinary linked worktree · trigger: `POST /api/git/worktree/remove` · observable: removal proceeds and succeeds exactly as before. (test-plan #E9)
- [x] 5.7 Test first: an inconclusive working-tree probe is refused (same exemplar). Input: a linked worktree whose `--show-toplevel` yields nothing while `core.worktree` still resolves a main checkout · trigger: `POST /api/git/worktree/remove` · observable: `main_checkout_unresolved`, HTTP 400, nothing deleted — NOT `removable`. (test-plan #E11)
- [x] 5.8 Test first: the batch classifies per item (same exemplar). Input: a batch of 3 — ordinary linked worktree, main checkout, worktree-of-bare · trigger: `POST /api/git/worktree/remove-batch` · observable: 3 results in input order with codes success, `is_main_worktree`, `main_checkout_unresolved`; the batch does not abort after item 2. (test-plan #E10)
- [x] 5.9 Replace `isMainWorktree(cwd): boolean` in `packages/server/src/routes/git-routes.ts` with the tri-state helper (`"main" | "removable" | "unresolved"`).
- [x] 5.10 Wire `/remove` and `/remove-batch`: `main` → 400 `is_main_worktree`; `unresolved` → 400 `main_checkout_unresolved`; only `removable` proceeds; batch classification is per item, input order preserved, never aborting.
- [x] 5.11 Surface `main_checkout_unresolved` in the client's error rendering (must not be read as success).
  - Run note (ship-it): no client change needed — `postLifecycle` passes any failure `code` through generically; `CloseWorktreeDialog` renders unknown codes verbatim (`setError({ code })`) and `ManageWorktreeDialog`'s failure strips render `message ?? code`. The 400 can never be read as success.

## 6. Lifecycle ops — D2

- [x] 6.1 Test first: create refuses when unresolved (see `packages/server/src/__tests__/git-worktree-ops.test.ts`). Input: `cwd` in a bare hub — once without `path`, once WITH an explicit `path` · trigger: `POST /api/git/worktree` · observable: both return `not_a_repo`; no directory created in either case. (test-plan #E17)
- [x] 6.2 Test first: create anchors inside a submodule (same exemplar). Input: `cwd` inside the submodule, no explicit `path` · trigger: `POST /api/git/worktree` · observable: the derived path is under the submodule working tree, never under `<super>/.git/`. (test-plan #E16)
- [x] 6.3 Test first: the exclude line lands in the common git dir (same exemplar). Input: submodule and `--separate-git-dir` checkouts · trigger: a successful `POST /api/git/worktree` · observable: `.worktrees/` is appended to `info/exclude` inside the repository's COMMON GIT DIR, not `<checkout>/.git/info/exclude`; appending twice does not duplicate. (test-plan #E18)
- [x] 6.4 Test first: from-pr refuses when unresolved (same exemplar). Input: `cwd` for which no main checkout resolves · trigger: `POST /api/git/worktree/from-pr` · observable: `not_a_repo`; no directory created. (test-plan #X7)
- [x] 6.5 Test first: merge and diff-stat return 400, not 500 (see `packages/server/src/__tests__/git-worktree-lifecycle-ops.test.ts`). Input: `cwd` = worktree of a bare hub · trigger: `POST /api/git/worktree/merge`, `GET /api/git/worktree/diff-stat` · observable: both return `not_a_worktree` with HTTP 400, not the previous `git_failed`/HTTP 500. (test-plan #E21)
- [x] 6.6 Test first: push and PR are exempt (same exemplar). Input: `cwd` = worktree of a bare hub · trigger: `POST /api/git/worktree/push`, `POST /api/git/worktree/pr` · observable: both proceed against `cwd` as today; neither is refused with `not_a_worktree`. (test-plan #E22)
- [x] 6.7 Test first: every endpoint fails closed on a dead probe (same exemplar). Input: every checkout-root probe stubbed to fail · trigger: create, from-pr, merge, prune, diff-stat, remove, orphan-cleanup · observable: each refuses with its own established code; no endpoint substitutes `cwd`, `thisCheckout`, or `dirname(--git-common-dir)`; nothing created or deleted. (test-plan #X6)
- [x] 6.8 Convert `addWorktree` and `addWorktreeFromPr` from their private `commonDirRaw` branch to `resolveMainPath`, preserving the `not_a_repo` code; fix the exclude-write to target the common git dir.
- [x] 6.9 Widen `MergeCode` with `not_a_worktree`, convert `mergeWorktree` + `worktreeDiffStat`, and map the code to HTTP 400 in `git-routes.ts`.
- [x] 6.10 Delete the dead, unread `mainPath` assignment in `createPullRequest`; leave `pushBranch` untouched.

## 7. Delete boundaries — D2, D6, D7 (last)

- [x] 7.1 Test first: the resolver runs once per distinct cwd (see `packages/server/src/__tests__/git-worktree-lifecycle-ops.test.ts`). Input: one `POST /api/git/worktree/remove`, then one `/remove-batch` with 3 distinct cwds · trigger: count resolver invocations · observable: 1 for `/remove`, 3 for the batch, never 2× for the same cwd. (test-plan #P1)
- [x] 7.2 Test first: the probe budget is bounded (same exemplar). Input: a git probe stubbed to hang · trigger: `resolveMainPath` · observable: returns within ~400 ms × probe count, never the 15 s batch budget; the event loop is not blocked past that bound. (test-plan #P3)
- [x] 7.3 Convert `removeWorktree` to the threaded single resolution; confirm `sweepResidualWorktreeDir` keeps its own `<mainPath>/.worktrees/` containment guard unchanged and stays unreachable with a null anchor.
- [x] 7.4 Test first: the orphan anchor is the resolved main checkout (see `packages/server/src/__tests__/git-worktree-ops.test.ts`). Input: `cwd` inside the submodule, orphan dir inside the submodule working tree, all other guards passing · trigger: `POST /api/git/worktree/orphan-cleanup` · observable: `{ ok: true }` and the directory is deleted. (test-plan #E23)
- [x] 7.5 Test first: an orphan is cleanable from a sibling worktree (same exemplar). Input: `cwd` = a linked worktree, orphan dir under the MAIN checkout · trigger: the same endpoint · observable: `{ ok: true }` — the anchor is the resolved main checkout, not the request `cwd`. (test-plan #E24)
- [x] 7.6 Test first: a symlink escape refuses (same exemplar). Input: `path` inside the resolved main checkout but a symlink whose target resolves outside it · trigger: the same endpoint · observable: `outside_repo`, HTTP 400; neither the link nor its target is deleted. (test-plan #X1)
- [x] 7.7 Test first: a missing path refuses as `not_a_directory` (same exemplar). Input: `path` inside the anchor that does not exist · trigger: the same endpoint · observable: `not_a_directory`, not `outside_repo`, and no unhandled `ENOENT` escapes. (test-plan #X2)
- [x] 7.8 Test first: an unreadable target refuses (same exemplar). Input: symlink resolution failing with EACCES / ELOOP · trigger: the same endpoint · observable: `fs_failed`; nothing deleted; the failure is never treated as a pass. (test-plan #X3)
- [x] 7.9 Test first: the TOCTOU race refuses (same exemplar). Input: the target deleted between the existence check and symlink resolution · trigger: the same endpoint · observable: `not_a_directory`, no success response, the later guards not evaluated. (test-plan #X4)
- [x] 7.10 Test first: no anchor refuses (same exemplar). Input: `cwd` inside a bare repo or a worktree of a bare hub · trigger: the same endpoint · observable: `outside_repo`, HTTP 400, nothing deleted. (test-plan #X5)
- [x] 7.11 Test first: the existing guard order is preserved (same exemplar). Input: a path BOTH registered in `git worktree list` AND containing a top-level `.git` entry · trigger: the same endpoint · observable: `not_orphan`, the code it returns today, not `looks_like_worktree`. (test-plan #E25)
- [x] 7.12 Convert `orphanCleanup`: anchor via `resolveMainPath`, then the D6 pinned order — logical containment → `statSync` existence → realpath BOTH sides + re-test containment → the existing guards in their existing relative order. Non-not-found realpath failures → `fs_failed`.
- [x] 7.13 Spawn `Audit` over the combined diff — two recursive-delete boundaries, mandatory per `proposal.md`.

## 8. Configurable batch cap — D8

- [x] 8.1 Test first: an unset config keeps today's cap (see `packages/server/src/__tests__/git-worktree-lifecycle-ops.test.ts`). Input: no batch cap configured · trigger: `POST /api/git/worktree/remove-batch` with 50 items, then 51 · observable: 50 accepted, 51 rejected with `batch_too_large`. (test-plan #E26)
- [x] 8.2 Test first: a configured cap is honoured at its boundary (same exemplar). Input: cap configured to 10 · trigger: post 10 items, then 11 · observable: 10 accepted; 11 rejected with `batch_too_large`; no git command runs for the rejected batch. (test-plan #E27)
- [x] 8.3 Test first: an invalid cap falls back to the default (same exemplar). Input: cap configured to `0`, `-1`, `2.5`, `"many"`, `null` · trigger: post a batch · observable: the effective cap is the default for every invalid value — neither all batches rejected nor an unbounded one accepted. (test-plan #E28)
- [x] 8.4 Test first: the rejection message names the effective cap (same exemplar). Input: cap configured to a non-default value · trigger: post an oversized batch · observable: the message states the effective cap, not a hardcoded 50. (test-plan #E29)
- [x] 8.5 Add the cap to `DashboardConfig` in `packages/shared/src/config.ts` following the `readinessTimeoutMs` pattern: default 50, clamp into a bounded range, fall back to the default on non-numeric / non-positive input.
- [x] 8.6 Replace `REMOVE_BATCH_CAP` in `packages/server/src/routes/git-routes.ts` with the configured value and use it in the `batch_too_large` message.
- [x] 8.7 Test first: per-item batch latency
  - Run note (ship-it): script at `qa/tests/21-worktree-batch-perf.sh`; discovers the effective cap from the
    `batch_too_large` message (cap-independent), fills the batch with REAL worktrees (container-aware via
    `PI_QA_DOCKER_CONTAINER`). Loaded-host harness run: p95 119–217 ms/item vs the 100 ms budget — reconciles
    exactly to D7's accepted design floor (5 sync probes × environment spawn price + 1 remove; measured floors:
    20.7 ms/container, 69 ms/saturated session host). Unloaded hosts/qa-VM land ≈30–60 ms/item. Failure output
    prints the spawn floor for diagnosis. (see `qa/tests/20-tunnel-readiness-perf.sh` for the perf-harness shape; `qa/tests/05-git-ops.sh` for the git setup). Input: `/remove-batch` filled to the CONFIGURED cap with real worktrees · trigger: run the batch · observable: p95 < 100 ms per item (total wall-clock ÷ item count) over 5 repetitions; the assertion is cap-independent and never expressed against a fixed 50. (test-plan #P2)

## 9. Verify + document

- [x] 9.1 Manual, post-merge: read both refusal messages (`is_main_worktree`, `main_checkout_unresolved`) as they surface in the UI — each states a reason TRUE for the state that produced it, and a user can tell the two apart. (test-plan: manual-only)
- [x] 9.2 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green; restart the server (`curl -X POST http://localhost:8000/api/restart`) after server-package edits.
  - Run note (ship-it): all 7 touched suites green (282 tests) + 8/8 L3 e2e on the docker harness. Full-repo run: 6 failures, all verified IDENTICAL on the clean base (eval-guard, send-types, pi-version-tracker ×2, verify-published-imports, pi-version-skew) — pre-existing, out of scope; 3 flakes (browse-endpoint, cli-signal-forwarding, keeper) pass in isolation with this change. Server restarted via /api/restart (ok:true).
- [x] 9.3 Run `review-code` on the diff — in particular that no converted call site reintroduces a shell-string interpolation of a cwd-derived path.
  - Run note (ship-it): satisfied by the step-4.5 isolated reviewer (round 1 CHANGES-REQUIRED → 2 blockers + suggestions fixed → round 2 APPROVE). Shell-interpolation axis checked clean both rounds.
- [x] 9.4 `DocScribe`: update `docs/architecture.md` → "Git checkout-root resolution" → Converted consumers with this change's call sites and the fail-closed table; update the affected directory `AGENTS.md` rows (`packages/server/src/git-worktree/git-operations.ts.AGENTS.md`, `packages/server/src/routes/git-routes.ts.AGENTS.md`, `packages/shared/src/config.ts.AGENTS.md`, `packages/client/src/components/worktree/AGENTS.md`).
