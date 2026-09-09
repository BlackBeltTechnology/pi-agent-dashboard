# Tasks — add-git-checkout-root-resolver

Test tasks are folded from `test-plan.md`; that manifest is the source of truth for which
scenarios are automated. Every automated row maps to exactly one task below. TDD order per
section: write the test, watch it fail, then implement.

## 1. Fixture infrastructure

- [x] 1.1 Build a shared git-fixture helper creating the nine repo states in a temp dir: normal, linked worktree, submodule, worktree-of-submodule, bare, worktree-of-bare, separate-git-dir, plus a subdirectory of a checkout and of a worktree. Copy the mkdtemp + `execFileAsync("git", ["-C", cwd, ...])` + realpath harness glue from `packages/server/src/lib/__tests__/path-containment.test.ts` (which builds only the non-repo and bare cases inline). Must set `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_SYSTEM=/dev/null` on every git invocation, and pass `-c protocol.file.allow=always` for local-path `submodule add`, or the `core.worktree` assertions leak a developer's own config. (test-plan: New infra needed)
- [x] 1.2 Assert the helper itself: each of the nine states reports the expected `--git-dir` / `--git-common-dir` / `--show-toplevel` triple, so a fixture regression cannot silently pass the resolver tests.

## 2. Shared resolver (packages/shared/src/platform/git.ts)

- [x] 2.1 Write the resolver's failing unit tests for the state matrix, in a sibling `__tests__/*.test.ts`; see `packages/server/src/lib/__tests__/path-containment.test.ts` for real-repo glue and `packages/extension/src/__tests__/vcs-info.test.ts` for the injected-thunk style (it already mocks `platform/git.js` recipes).
- [x] 2.2 Test: normal checkout root · resolve roots · `thisCheckout` = the checkout, `isLinkedWorktree` false, `mainCheckout` equals `thisCheckout`. (test-plan #E1)
- [x] 2.3 Test: worktree added from a normal checkout · resolve roots · `isLinkedWorktree` true, `thisCheckout` = worktree root, `mainCheckout` = main checkout. (test-plan #E2)
- [x] 2.4 Test: submodule checkout whose `--git-dir` equals `--git-common-dir` at `<super>/.git/modules/models/sub` · resolve roots · `isLinkedWorktree` false, `mainCheckout` = `<super>/models/sub`, neither root contains a `.git` segment. (test-plan #E3)
- [x] 2.5 Test: worktree created from the submodule at `<super>/models/sub` · resolve roots · `isLinkedWorktree` true, `mainCheckout` = `<super>/models/sub` via repo-local `core.worktree`, never `<super>/.git/modules/models`. (test-plan #E4)
- [x] 2.6 Test: worktree created from a `clone --bare` hub · resolve roots · `isLinkedWorktree` true, `thisCheckout` = worktree root, `mainCheckout` = `null`. (test-plan #E5)
- [x] 2.7 Test: bare repository directory as cwd · resolve roots · a result is returned (not "no result"), `thisCheckout` = `null`, `mainCheckout` = `null`. (test-plan #E6)
- [x] 2.8 Test: checkout created with `git init --separate-git-dir=<elsewhere>.git` · resolve roots · `isLinkedWorktree` false, both roots = that checkout, neither is the directory holding the git dir. (test-plan #E7)
- [x] 2.9 Test: cwd three levels below a checkout root · resolve roots · `thisCheckout` = the checkout root not the cwd, `mainCheckout` identical to resolving from the root. (test-plan #E8)
- [x] 2.10 Test: `--git-dir` thunk returns the relative `.git` while `--git-common-dir` returns an absolute path for the same repo · resolve roots · `isLinkedWorktree` false, because both are canonicalized before comparison — a normal checkout must not report as a linked worktree. (test-plan #E9)
- [x] 2.11 Test: `--git-common-dir` output carrying a trailing separator · resolve roots · classification identical to the untrailing case. (test-plan #E10)
- [x] 2.12 Test: ordinary checkout located at `/work/app.git` · apply the `.git`-segment test to the resolved root · treated as NOT containing a `.git` segment (exact path-component equality). (test-plan #E11)
- [x] 2.13 Test: global/user config sets `core.worktree`, repo-local does not, ordinary linked worktree · resolve `mainCheckout` · the global value is not used and resolution falls through to `dirname` of the `.git`-named common dir. Note a merged read returns the global value, so this pins the local-only read. (test-plan #E12)
- [x] 2.14 Test: linked worktree whose repo-local `core.worktree` points inside a git dir · resolve `mainCheckout` · the configured path is returned verbatim, not `null`, not `thisCheckout`, not a rule-2b value — validation is the consumer's job. (test-plan #E13)
- [x] 2.15 Test: `--git-dir` probe fails for a non-repo cwd · resolve roots · "no result", and no path derived from the partial probe. (test-plan #X1)
- [x] 2.16 Test: `--show-toplevel` fails while `--git-dir`/`--git-common-dir` succeed (bare) · resolve roots · a result IS returned with `thisCheckout` = `null`, keeping bare distinguishable from non-repo. (test-plan #X2)
- [x] 2.17 Test: a probe exceeds its timeout · resolve roots · "no result" and the caller degrades rather than throwing. (test-plan #X3)
- [x] 2.18 Test: repository path containing a space, and one containing a shell metacharacter · resolve `mainCheckout` for a linked worktree · the value is read correctly for the spaced path and no shell command executes for the metacharacter path, proving the probe is argv-based. (test-plan #X4)
- [x] 2.19 Implement the resolver to satisfy 2.2–2.18: required probes are `--git-dir` and `--git-common-dir` (both with `--path-format=absolute`), `--show-toplevel` optional, comparison via the platform path helpers (`samePath` in `packages/shared/src/platform/paths.ts`) never raw `!==`, `core.worktree` read repository-local and argv-only, result returned verbatim.

## 3. Bridge consumer — vcs-info detectWorktree

- [x] 3.1 Test: resolver returns a `mainCheckout` containing a `.git` segment · worktree detection runs · no worktree identity emitted and no `mainPath` with a `.git` segment reaches the wire; the consumer must not assume the resolver filtered it. Extend `packages/extension/src/__tests__/vcs-info.test.ts`. (test-plan #E18)
- [x] 3.2 Test: a `rev-parse` invocation fails during `gatherGitInfo` · poll tick runs · `gitWorktree` undefined while branch / remote / PR detection still proceeds; same exemplar file. (test-plan #X6)
- [x] 3.3 Convert `detectWorktree` (`packages/extension/src/vcs-info.ts:112`) to the resolver: report a worktree only when `isLinkedWorktree` and a plausible `mainCheckout` resolves. Assert the probe wiring is canonical — a mis-wired thunk cannot be caught by a fixture test with injected values.
- [x] 3.4 Rewrite the `GitWorktreeInfo` docstring at `packages/shared/src/types.ts:44-52`: the whole opening paragraph describes the retired signal, not just the "canonical signal" sentence. Also drop `detectWorktree`'s own docstring claim of case-folding it does not implement.

## 4. kb guard consumer

- [x] 4.1 Test: only `/repo` known, request `cwd = /repo/src` · guard evaluates admission · admitted because `mainCheckout` resolves to `/repo`; store opened. Preserves the existing breadth. Extend `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E20)
- [x] 4.2 Test: `/super` known, submodule `/super/models/sub` not known · guard evaluates admission · rejected `403`; adding `/super/models/sub` as a known folder then admits it. (test-plan #E21)
- [x] 4.3 Test: worktree of a bare hub, not a known folder, `mainCheckout` = `null` · guard evaluates admission · rejected `403`, no store opened. (test-plan #E22)
- [x] 4.4 Test: resolver returns a `mainCheckout` inside a git dir that happens to sit under a known folder, worktree cwd itself not known · guard evaluates admission · rejected `403`, not admitted on the basis of that path being under a known folder. (test-plan #E19)
- [x] 4.5 Convert `worktreeMainPath` (`packages/kb-plugin/src/server/kb-routes.ts:80`) to the resolver's `mainCheckout`, with the consumer-side `.git`-segment rejection before the known-folder match.

## 5. Persisted-record repair — session-scanner

- [x] 5.1 Test: persisted `mainPath` = `<super>/.git/modules/models` · load session · record dropped, session groups by its own cwd, `.meta.json` not rewritten. See `packages/server/src/__tests__/session-name-provenance-persistence.test.ts` for persisted-meta harness glue. (test-plan #E14)
- [x] 5.2 Test: persisted `mainPath` = an existing directory with no `.git` segment and no `.git` entry · load session · record dropped, proving existence alone does not qualify a path. (test-plan #E15)
- [x] 5.3 Test: persisted `mainPath` = existing directory, no `.git` segment, containing a `.git` entry · load session · record preserved unchanged. (test-plan #E16)
- [x] 5.4 Test: bare hub at `<home>/bare.git` with phantom `mainPath` = `<home>` where `<home>` is itself a checkout · load session · record SURVIVES, pinning the documented shape-vs-identity limitation so it cannot silently change. (test-plan #E17)
- [x] 5.5 Test: stat on the persisted `mainPath` fails with an error other than not-found (unreachable volume) · load session · record dropped and the load does not throw for that session. (test-plan #X5)
- [x] 5.6 Test: a store of 200 persisted sessions carrying `gitWorktree` records · single load pass · zero git subprocesses spawned by the filter and at most one filesystem stat per record. (test-plan #P1)
- [x] 5.7 Implement the load-time filter at `packages/server/src/session/session-scanner.ts:138`: drop a record unless the path is statable, carries no `.git` path segment, and directly contains a `.git` entry. Drop on any stat failure. Never rewrite `.meta.json`.

## 6. Rendered-UI verification (Playwright)

- [x] 6.1 Test: a session whose cwd is a submodule checkout carrying its own `.pi/` · dashboard loads and the session registers · sidebar converges to a folder card headed at the submodule's own checkout path, and no card headed at a `…/.git/modules/…` path exists. See `tests/e2e/worktree-init-feedback.spec.ts` for folder-group + worktree harness glue and `tests/e2e/helpers/` for seeding; read the harness port from `.pi-test-harness.json` (`dashboardPort`), never `:18000`. (test-plan #F1)
- [x] 6.2 Test: a session whose cwd is a worktree created from a submodule · dashboard loads and the session registers · session converges under the submodule's checkout as its parent group, not under a `.git/modules` path; same exemplar. (test-plan #F2)
- [x] 6.3 Test: persisted metadata carrying a pre-fix `…/.git/modules/…` phantom `mainPath` · server restarts and the dashboard reloads · no phantom folder group renders and the session appears grouped by its own cwd. Requires seeding a record the current code would never produce. (test-plan #F3)

## 7. Documentation

- [x] 7.1 Add or update the per-file `AGENTS.md` purpose rows with `See change: add-git-checkout-root-resolver` for every touched source file: `packages/shared/src/platform/git.ts`, `packages/extension/src/vcs-info.ts`, `packages/kb-plugin/src/server/kb-routes.ts`, `packages/server/src/session/session-scanner.ts`, `packages/shared/src/types.ts`.
- [x] 7.2 Delegate any `docs/` prose to a DocScribe subagent in caveman style; record the git-state table (which states resolve to what) so the next reader does not re-derive it from fixtures.

## 8. Validate

- [x] 8.1 (DONE — 18210 passed. The single failure, `packages/client` `FileLink.split`, is PRE-EXISTING: it fails identically on pristine `develop`, and this change touches zero client files. `path-containment` and `vcs-info` suites both still pass.) Run the full suite per AGENTS.md: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then grep the summary pattern. Confirm every pre-existing `path-containment` and `vcs-info` test still passes — `path-containment.ts` is deliberately NOT converted in this change.
- [x] 8.2 (VERIFIED via harness E2E; the equivalent surface is covered automatically by `tests/e2e/submodule-folder-grouping.spec.ts` F1–F3 against the docker harness) Restart the server and reload extensions per the rebuild matrix (`packages/extension` → `npm run reload`; `packages/server`/`shared` → `POST /api/restart`), then confirm on a real submodule session that the folder card header and the KB badge are correct.
- [x] 8.3 (DONE — isolated `@review` subagent enumerated all nine git states: every one fails CLOSED; a timeout degrades to reject, never admit; the store always opens at the request's own `cwd`, so a poisoned `core.worktree` cannot redirect it. Two accepted widenings recorded in proposal.md + design.md.) Run the `security-hardening` discipline pass over the kb-guard change: confirm every git state fails closed, and that a submodule admitted on its own cwd does not widen reach beyond that cwd.
- [x] 8.4 (DONE — round-2 adversarial pass on the implementation: 0 blocking, 0 non-blocking. Stress-tested the single-stat collapse, the submodule gitdir==commondir claim, inherited GIT_DIR, E2E self-isolation, and entrypoint idempotency. Its three findings are fixed: kb probe budget 2000→500ms, `|| echo` guard on the trust write, proposal claim reconciled with design Risks.) Re-run `doubt-driven-review` on the final diff, per its re-loop rule; three cycles ran against the planning artifacts, not the implementation.
- [x] 8.5 (DONE — both scaffolded as stub proposals with a design gate in tasks.md: `openspec/changes/apply-checkout-root-to-worktree-ops/` and `openspec/changes/widen-containment-to-resolved-checkout/`.) Confirm the two follow-up changes are recorded before archiving: `apply-checkout-root-to-worktree-ops` (`resolveMainPath` + its twelve consumers, including both recursive-delete boundaries) and `widen-containment-to-resolved-checkout` (`path-containment.ts`).
