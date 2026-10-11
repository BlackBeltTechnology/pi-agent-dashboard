# Test Plan — harden-ci-cache-poisoning

Stage: design   Generated: 2026-10-11

Hard gate passed. One clarification was resolved via `ask_user`: the pre-merge dispatch verification is a `ci` / `automated` pre-merge gate (C1, C2), not a post-merge deferral.

Fixture convention (all L1 rows): the contract test exposes a pure checker over `{ path → parsed workflow }`. The real-tree row (E1) feeds `.github/workflows/*.{yml,yaml}`. Falsification rows feed in-memory fixtures — the real tree with one mutation applied — so each rule is proven to **fail**, not only to pass. Every failure assertion checks that the message names the workflow file and the job (plus the step where the row says so).

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Unprivileged non-release jobs keep their cache; every rule on the post-change tree | equivalence (valid class) | L1 | automated | the real `.github/workflows/` tree after tasks 1–2 | run the checker over all files | zero violations. `ci-checks`, `_smoke.yml`, `ci.yml` and the `ci-electron.yml` / `nightly.yml` → `_electron-build.yml` caches are accepted |
| E2 | Job on the default token fails repo-lint (rule 0) | equivalence (invalid class) | L1 | automated | fixture: `ci-gateway-platform.yml` with its top-level `permissions` removed | run the checker | violation names `ci-gateway-platform.yml` plus job `posix` (and `windows`) |
| E3 | Rule 0 — job-level-only form is valid | equivalence (valid class) | L1 | automated | fixture workflow: no top-level `permissions`, every job has a job-level block | run the checker | no rule-0 violation for that file |
| E4 | Newly scoped workflows default to read (exact equality) | BVA (just-above) | L1 | automated | fixture: `publish.yml` top-level `{contents: read, actions: read}` | run the checker | rule-0 violation naming `publish.yml`; `{contents: read}` alone passes |
| E5 | Release-privileged predicate (a) — effective permissions | decision table | L1 | automated | six fixture jobs, each with a `setup-node` `cache: pnpm` step: (i) job `issues: write`; (ii) job `write-all`; (iii) job `read-all`; (iv) top `contents: write` + job `contents: read`; (v) top `pages: write`, no job block (deploy-site shape); (vi) top `contents: read`, job `id-token: write` | run the checker | (i), (ii), (v), (vi) → rule-1 violation naming the step; (iii), (iv) → none. The (v) message names the inherited top-level grant |
| E6 | Secrets in a cached job fail repo-lint — predicate (b) | decision table | L1 | automated | four fixture jobs with `cache: pnpm`: (i) `env: X: ${{ secrets.NPM_X }}`; (ii) only `${{ secrets.GITHUB_TOKEN }}`; (iii) `environment: npm-publish`; (iv) a caller of `_electron-build.yml` with `secrets: inherit` + `use_dependency_cache: true` | run the checker | (i), (iii) → rule-1 violation; (ii) → none; (iv) → rule-2 violation (secret-passing caller must pass `false`) |
| E7 | Release job re-enabling the pnpm cache fails repo-lint — predicate (c) + rule 1 | equivalence (invalid class) | L1 | automated | fixtures: real `publish.yml` with `cache: pnpm` re-added to (i) `runtime-asset`; (ii) `publish`; (iii) `tag-and-push` | run the checker | each → violation naming `publish.yml`, the job and the `setup-node` step index/name |
| E8 | Rule 1 — cache-enabling keys and `actions/cache` variants | equivalence partitioning over keys | L1 | automated | privileged fixture job (`contents: write`), one variant per run: `with.enable-cache: true`; `with.bundler-cache: true`; `with.cache-from: type=gha`; `uses: actions/cache/save@v4`; `uses: actions/cache@v4`; `with.cache: ${{ inputs.x }}`; `with.cache: ''` | run the checker | the first six → violation; `cache: ''` → none |
| E9 | Release electron build must opt out (rule 2 caller side) | BVA on value type | L1 | automated | fixtures of the `publish.yml` `electron` `with:`: (i) key omitted; (ii) `use_dependency_cache: "false"` (string); (iii) `use_dependency_cache: true`; (iv) boolean `false` | run the checker | (i), (ii), (iii) → rule-2 violation naming `publish.yml` `electron`; (iv) → none |
| E10 | Dev callers keep the cache path exercised (rule 2 positive side) | equivalence (invalid class) | L1 | automated | fixtures: (i) `ci-electron.yml` `build` with `use_dependency_cache` omitted; (ii) `nightly.yml` `electron` passing `false` | run the checker | each → violation naming the caller file and job |
| E11 | Callee cache must stay input-gated and default closed (rule 3) | decision table | L1 | automated | `_electron-build.yml` fixtures: (i) step `cache: pnpm` literal; (ii) input `default: true`; (iii) input `type: string`; (iv) gated expression with extra inner whitespace `${{  inputs.use_dependency_cache   && 'pnpm' || '' }}`; (v) D4 fallback pair (two complementary `if:`-gated `setup-node` steps, only the input-gated one carrying `cache`) | run the checker | (i), (ii), (iii) → rule-3 violation; (iv), (v) → none |
| E12 | Per-call-site privilege — gated callee step exempt under signing secrets | state (future signing shape) | L1 | automated | fixture `_electron-build.yml` `build` job adds `env: CSC_LINK: ${{ secrets.CSC_LINK }}` while keeping the gated cache; callers unchanged (publish `false`, dev `true` with no `secrets:`) | run the checker | no violation (the gated step is exempt) |
| E13 | Ships-in-release guard (rule 4) | equivalence partitioning | L1 | automated | fixtures: (i) `publish.yml` `ci-checks` gains `upload-artifact` named `electron-debug`; (ii) `_smoke.yml` leg uploads `electron-smoke-log`; (iii) real `runtime-asset` upload `electron-runtime-${{ matrix.platform }}-…` | run the checker | (i), (ii) → rule-4 violation naming the job and the ships-in-release list; (iii) → none |
| E14 | X5 pnpm-migration contract accepts the gated form only for `_electron-build.yml` | equivalence | L1 | automated | real post-change tree; fixture `ci.yml` with `cache: pnpm` removed | run `pnpm-migration-contract.test.ts` X5 | real tree passes; the `ci.yml` fixture fails X5 (`missing cache: pnpm`) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Workflows declare explicit permissions (repo-wide coverage) | fault injection (malformed input) | L1 | automated | fixture file `bad.yml` with invalid YAML (unbalanced flow mapping) | run the checker | checker throws or reports an error naming `bad.yml`. It never skips the file silently, so the result is not a pass |
| X2 | Repo-wide coverage — `.yaml` extension | fault injection (unexpected input) | L1 | automated | fixture `extra.yaml` (not `.yml`) with a job lacking `permissions` and no top-level block | run the checker over the directory listing | rule-0 violation naming `extra.yaml` |
| C1 | Least-privilege tokens do not break the dev electron build; cache still restored when `true` | real-run verification | ci | automated | branch with tasks 1–2 applied; `ci-electron.yml` dispatched with `legs: linux-x64` | `gh workflow run ci-electron.yml --ref <branch> -f legs=linux-x64` + `gh run watch` | run conclusion `success`; no `Resource not accessible by integration` in `gh run view --log`; the `setup-node` step log contains `Cache restored` or `Cache not found` (cache attempted, not disabled) |
| C2 | Least-privilege tokens do not break smoke / e2e-electron / gateway workflows | real-run verification | ci | automated | same branch | `gh workflow run` for `ci-smoke.yml`, `ci-e2e-electron.yml`, `ci-gateway-platform.yml` + `gh run watch` | each conclusion `success`, or the identical pre-existing failure (`job-object-windows`) with no new 403 / `Resource not accessible by integration` line |
| C3 | Post-merge CodeQL closure + recorded dismissals | post-merge verification | — | manual-only | merge to `develop`; CodeQL re-scan | `gh api repos/{owner}/{repo}/code-scanning/alerts?state=open` | all 15 `missing-workflow-permissions` closed; open `poisonable-step` = exactly `_smoke.yml` ×4 + `ci-checks` ×4 + `_electron-build.yml` ×10; then dismissed with the D4/D5 comments and the numbers recorded [needs the post-merge scan; repository action, no test] |
| C4 | Release jobs install cold at the next release | post-merge verification | — | manual-only | next `v*` release run | inspect `publish`, `tag-and-push`, `runtime-asset` and the `electron` legs' `setup-node` logs | no `Cache restored` line in any of them; release succeeds [only observable at the next real release] |

## Coverage summary

- Requirements covered: 6/6 delta requirements, with these scenario groups:
  - ADDED permissions: E2–E4, X1, X2, C1, C2;
  - ADDED release-privileged no-cache: E1, E5–E13;
  - MODIFIED reusable electron workflow: E9–E12, C1;
  - MODIFIED publish workflow on version tags: E9 (iv), E1.

  The X5 interaction (E14) is the cross-test guard.
- Scenarios by class: edge 14 · perf 0 (no perf requirement; release cost is accepted unmeasured) · frontend 0 · error 6
- Scenarios by level: L1 16 · ci 2 · — 2
- Scenarios by disposition: automated 18 · manual-only 2

## New infra needed

- None. L1 uses vitest + `yaml` (root devDependency, used by `nightly-tests-workflow-contract.test.ts`). The `ci` rows use `gh` per the project skill `validate-ci-workflow-pre-merge`.
