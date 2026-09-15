## Context

See `proposal.md` — Why. Current shape:

- `playwright.config.ts`: `globalTimeout: 15 * 60_000`, `workers: 1`, `fullyParallel: false`, `retries: CI ? 1 : 0`, reporters `list` + `html`, managed lifecycle via `tests/e2e/global-setup.ts` / `global-teardown.ts` (boots `docker/test-up.sh` from a throwaway workspace, reads ports from `.pi-test-harness.json`, tears down with `docker/test-down.sh`).
- 168 spec files. Measured pre-fix: a 30-spec chunk ≈ 50 min. Post `fix-e2e-harness-memory-exhaustion` + `fix-tmux-session-shutdown-leak` a 2×15 chunk run stayed flat at ~1 GiB with zero session divergence; a full single-container run has not been completed (needed an exclusive VM — #451).
- Harness: `docker/compose.yml` `MEM_LIMIT` default 4 GiB; project name `pi-dash-test-<cksum(HOST_CWD)>`; image tag = project name; `test-down.sh` is `-p`-scoped and removes only its own image.
- CI: `ci.yml` typechecks `tests/e2e` only; `ci-e2e-electron.yml` is the only Playwright job (path-filtered PR + dispatch, advisory). No workflow builds the Docker harness today. Existing workflow-contract tests in `packages/shared/src/__tests__/*-workflow-contract.test.ts` are the repo-lint pattern.
- Cross-project destruction (#451) — grep of every `docker … down|rm|prune|stop|kill` outside `node_modules`/archive: `qa/tests/27-docker-deploy-lifecycle.sh` (`-p "$PROJECT"`, its own project), `packages/electron/scripts/build-*.sh` and `scripts/test-standalone-npm-install-docker.sh` (`docker rm` of their own named containers), `docker/test-down.sh` (`-p` scoped). No `prune`. Nothing in the tree can reach a foreign `pi-dash-test-*` project; the observed destroy came from outside the repo (manual, Docker Desktop restart, or a prune).

## Goals / Non-Goals

**Goals:**
- A full-suite verdict is obtainable locally with one command and nightly in CI without human chunking.
- Shards are independent by construction (own runner, own harness) so a shard's death cannot cascade.
- Harness contention on a developer VM is refused or announced, never silent.
- The baseline is green at merge, with every remaining gap linked to an issue.

**Non-Goals:**
- Making the workflow a required check (separate change after two clean nightlies).
- Intra-shard parallelism (`workers > 1`) — the harness is one shared dashboard; needs its own measurement.
- Fixing product bugs discovered by triage inside this change — they get issues; this change only quarantines.
- Caching the Docker image across runs (see D2 risk; revisit if shard wall-clock is dominated by the build).

## Decisions

### D1 — Remove `globalTimeout`; bound by job time in CI

Delete the key (Playwright default `0` = unbounded). Termination on a wedged harness is guaranteed by the existing harness-down short-circuit (3 consecutive probe failures → remaining specs skipped) plus per-test `timeout: 60_000`. In CI the shard job carries `timeout-minutes`. *Alternative rejected:* raise to 4 h — still a guess that goes stale as the suite grows, and it hides the fact that the budget is a CI concern.

### D2 — `ci-e2e-browser.yml`: N=6 shards, each builds and boots its own harness

- Triggers: `workflow_dispatch` (with an optional `shards` input for experiments), `schedule` (nightly, after `nightly.yml`'s slot), `pull_request` with `if: contains(github.event.pull_request.labels.*.name, 'e2e-browser')` on the job.
- Matrix `shard: [1..6]`, `fail-fast: false`, `runs-on: ubuntu-latest` (7 GB RAM, fits one 4 GiB harness), `timeout-minutes: 75`.
- Steps: checkout → pnpm install → `npx playwright install --with-deps chromium` → `PI_E2E_SEED=1 playwright test --shard=${{ matrix.shard }}/6` (managed mode boots the harness; `test-up.sh --build` builds the image from the checked-out tree on the runner) → `if: always()` upload `blob-report/` → `if: always()` `docker/test-down.sh` from the throwaway workspace (belt-and-braces; `globalTeardown` already does it, but a killed Playwright process must not leak a container into the next matrix leg on a reused runner).
- `merge-report` job (`needs: [e2e]`, `if: always()`): download all blobs → `npx playwright merge-reports --reporter html` → upload `playwright-report`.
- Reporter: config adds `["blob"]` when `process.env.CI` is set (list + html stay for local).
- Shard count: 168 specs / 6 ≈ 28 specs per shard — the chunk size that was measured to run stably; ~30–50 min per shard including a ~6–8 min image build. Documented as a tunable.

*Why per-shard build instead of build-once:* the image is multi-GB; artifact transfer between jobs would cost more than the build. GHA layer caching via buildx is a follow-up if the build dominates.

### D3 — Oversubscription guard in `test-up.sh`

New `lib-ports.sh` helper `list_running_harness_projects` → `docker ps --filter "label=com.docker.compose.project" --format '{{.Label "com.docker.compose.project"}}' | grep '^pi-dash-test-' | grep -v "$COMPOSE_PROJECT_NAME" | sort -u`. Memory: `docker info --format '{{.MemTotal}}'` (bytes) vs `MEM_LIMIT` parsed from env with the compose default `4g` (parse `g`/`m` suffix; unparseable → skip the check with a warning, never refuse on a parse failure). Check runs BEFORE image build so a refused start costs nothing. Skipped entirely in managed CI mode? No — CI runners have one harness, so the check is a no-op there; keep one code path.

### D4 — `docker/harness-audit.sh`

`docker events --filter type=container --filter event=create --filter event=start --filter event=die --filter event=destroy --filter event=kill --format '{{.Time}} {{.Action}} {{.Actor.Attributes.name}} project={{index .Actor.Attributes "com.docker.compose.project"}}' | grep --line-buffered 'project=pi-dash-test-' >> "$1"`. Documented in `tests/e2e/README.md` under a "When a run dies mid-way" section. Part 1 of #451 stays open on the issue with a pointer to the helper.

### D5 — Triage protocol for #433 part 1

Run the new workflow on `develop` (dispatch) before any spec edit. For each red: reproduce locally against a single fresh harness; decide drift vs product bug with a one-line reason recorded in `tasks.md` as the task is ticked. Drift → fix in this change. Product bug → file an issue with the spec name + failing assertion, annotate `test.fixme(true, "<issue url>")`. Repo-lint guard (`packages/shared/src/__tests__/e2e-fixme-guard.test.ts` or a case in an existing repo-lint file) rejects `test.fixme(` whose reason lacks `/issues/\d+`.

## Risks / Trade-offs

- [Nightly costs 6 runners × ~45 min] → schedule-only plus label opt-in; no per-PR cost.
- [Per-shard image build inflates wall-clock] → measured on the first dispatch; buildx GHA cache is the escape hatch, tracked as an open question, not assumed.
- [Removing `globalTimeout` lets a run that loses its harness probe hang forever] → the short-circuit spec already requires skipping after 3 probe failures; task 1.2 re-asserts it with no global timeout set.
- [`docker info` unavailable / rootless daemon reports odd `MemTotal`] → parse failure → warn and proceed (never refuse on missing data).
- [Quarantine hides regressions] → every `fixme` carries an issue; the merged report lists them; the guard forbids unlinked ones.
- [Ship-it skill still says "per-worktree isolation is sufficient"] → skill text updated to name the memory arithmetic (task 5.3).

## Migration Plan

1. Land config + workflow + guard; dispatch once on `develop`; capture per-shard timings and the red list into `tasks.md`.
2. Triage; land spec fixes + quarantines; dispatch again — green.
3. Enable the `schedule` trigger only after step 2 is green (land dark like `nightly.yml`).
4. Rollback: delete the workflow file; `test-up.sh` guard is bypassable with `PI_HARNESS_ALLOW_OVERSUBSCRIBE=1`.

## Open Questions

- Does per-shard image build dominate shard time on `ubuntu-latest`? Answered by the first dispatch; if > 40 % of wall-clock, add buildx GHA cache in a follow-up (does not change specs or tasks here).
