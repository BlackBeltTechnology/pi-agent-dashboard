## 1. Playwright config (#450) — `playwright.config.ts`

- [ ] 1.1 Test config has no global timeout and adds the blob reporter under CI — extend `tests/e2e/helpers/__tests__/` (vitest project `e2e`) or `scripts/__tests__/`: import the config, assert `globalTimeout` is `undefined`/`0`; with `CI=1` the reporter list contains `["blob"]`, without it does not. Verify red first.
- [ ] 1.2 Test harness-down short-circuit still terminates with no global timeout — existing short-circuit unit test (`reap-core` / harness-probe test) run with `globalTimeout` absent · remaining specs skipped, run ends. Verify green.
- [ ] 1.3 Implement D1 + blob reporter; update `tests/e2e/README.md` ("no committed budget; `--global-timeout` for a local cap"). Verify 1.1 green; `npm run test:e2e -- --list` still lists every spec.

## 2. Harness guard + audit (#451) — `docker/`

- [ ] 2.1 Test `list_running_harness_projects` + arithmetic — `scripts/__tests__/test-up-port-derivation.test.mjs` pattern with a stubbed `docker` on `PATH`: (a) another `pi-dash-test-*` project up, `MemTotal` 8 GiB, `MEM_LIMIT` unset → `test-up.sh` exits non-zero before `compose up`, message names the project and `2 × 4 GiB > 8 GiB`; (b) same with `PI_HARNESS_ALLOW_OVERSUBSCRIBE=1` → proceeds, one warning; (c) `MemTotal` 16 GiB → proceeds, one warning; (d) no other project → no extra output; (e) `docker info` fails → one warning, proceeds. Verify red first.
- [ ] 2.2 Implement D3 in `docker/lib-ports.sh` + `docker/test-up.sh` (before the build). Verify 2.1 green; `shellcheck docker/test-up.sh docker/lib-ports.sh` clean.
- [ ] 2.3 Implement D4 `docker/harness-audit.sh` (+ `chmod +x`); add the "When a run dies mid-way" section to `tests/e2e/README.md` and a row in `docker/AGENTS.md`. Verify: start the helper, `test-up.sh`/`test-down.sh` in a scratch cwd, file shows `create`/`destroy` lines with `project=pi-dash-test-…`.

## 3. Workflow (#433 part 2) — `.github/workflows/ci-e2e-browser.yml`

- [ ] 3.1 Test workflow contract — new `packages/shared/src/__tests__/e2e-browser-workflow-contract.test.ts` (pattern: `nightly-workflow-contract.test.ts`): triggers `workflow_dispatch`, `schedule`, `pull_request` with label `e2e-browser` condition; no `push`; matrix `shard` length equals the `--shard=…/N` denominator; every shard job has `timeout-minutes`; an `if: always()` step invokes `docker/test-down.sh`; a `merge-report` job with `if: always()` uploads `playwright-report`; `continue-on-error` on the PR path. Verify red first.
- [ ] 3.2 Implement D2 workflow; add `.github/workflows/AGENTS.md` row. Verify 3.1 green; `actionlint` (or `node scripts/check-conventions.mjs`) clean.
- [ ] 3.3 Dispatch once on the branch; record per-shard wall-clock and the image-build share in `openspec/changes/stabilize-browser-e2e/measurements.md`; record the red-spec list per shard. Verify the merged HTML artifact lists all 168 specs.

## 4. Baseline triage (#433 part 1) — `tests/e2e/`

- [ ] 4.1 Test the fixme guard — repo-lint case: a fixture spec with `test.fixme(true, "flaky")` fails naming the file; `test.fixme(true, "https://github.com/…/issues/42")` passes. Verify red first, then implement the guard.
- [ ] 4.2 Triage each red from 3.3: reproduce on one fresh local harness; record `drift` or `bug(#n)` beside the spec name in this file. Known starters: `change-summary-table` (toast intercepts click → `dismissToasts`, drift), `bus-client-goal-plugin-action` (goal plugin relocated → assertion drift), `editor-pane` ×3, `file-preview-survives-churn`, `openspec-artifact-dialog` ×2, `project-init-button`, `roles-custom`. Verify each classification has a one-line reason.
- [ ] 4.3 Fix every `drift` spec; file an issue for every `bug` and annotate `test.fixme(true, "<issue url>")`. Verify: the affected specs pass or report fixme locally with `PW_E2E_USE_RUNNING=1`.
- [ ] 4.4 Dispatch the workflow again on the branch. Verify every shard green (fixme counted as skipped) and the merged report shows zero failures.

## 5. Docs, skills, closeout

- [ ] 5.1 Delegate to `DocScribe`: `docs/faq.md` entry "E2E run refused: another harness is up" (override var, arithmetic); `docker/TESTING.md` guard + audit sections. Verify grep for `PI_HARNESS_ALLOW_OVERSUBSCRIBE` in `docs/faq.md` and `docker/TESTING.md`.
- [ ] 5.2 Update `.pi/skills/run-dashboard-e2e-local-changes/SKILL.md` and `.pi/skills/ship-it/SKILL.md`: remove the 15-min budget assumption; replace "per-worktree isolation suffices" with the memory arithmetic + guard. Verify no `15 min`/`globalTimeout` mention remains in either.
- [ ] 5.3 `AGENTS.md` rows: `docker/AGENTS.md` (`test-up.sh`, `lib-ports.sh`, `harness-audit.sh`), `.github/workflows/AGENTS.md`, `tests/e2e/AGENTS.md` (config, README). Verify `kb dox lint` clean.
- [ ] 5.4 Full unit suite `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` zero failures; `npm run quality:changed` clean.
- [ ] 5.5 Enable the `schedule` trigger (uncomment) only after 4.4 is green; comment on #433, #450, #451 with the change name and the dispatch run URLs; leave #451 open for part 1 with a pointer to `harness-audit.sh`.
