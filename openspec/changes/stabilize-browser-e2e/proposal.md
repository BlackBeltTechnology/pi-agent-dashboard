## Why

The browser-E2E suite (`tests/e2e/`, 168 spec files against the Docker harness) is the strongest gate on the ship-it path, yet nothing runs it on `develop` — only the Electron-E2E workflow is wired — so the baseline drifted red without anyone noticing (#433: 10 red specs on the base commit). A plain `npm run test:e2e` also cannot produce a full-suite verdict at all: the committed `globalTimeout` of 15 min dies long before 168 specs finish (#450). And a full run on the shared Docker VM is not attributable when a second worktree's harness is up: two 4 GiB harnesses saturate an 8 GB VM, and one worktree's container was observed destroyed mid-run by something outside its own `test-down.sh` (#451). `fix-e2e-harness-memory-exhaustion` and `fix-tmux-session-shutdown-leak` fixed the harness's own leaks; what remains is the run infrastructure around it.

## What Changes

- **Full-suite verdict by default (#450).** `playwright.config.ts` SHALL drop the 15-minute `globalTimeout` (Playwright's default is unbounded). Per-test `timeout`, `expect.timeout`, and the harness-down short-circuit already bound a pathological run; a wall-clock budget belongs to the CI job (`timeout-minutes`), not the committed config. Local callers who want a budget pass `--global-timeout`.
- **Sharded browser-E2E workflow (#433 part 2).** New `.github/workflows/ci-e2e-browser.yml`: `workflow_dispatch` + nightly `schedule` + `pull_request` when the PR carries the `e2e-browser` label. A matrix of N shards (`playwright test --shard=i/N`), each on its own runner with its own harness container, `timeout-minutes` per shard, Playwright `blob` reporter per shard merged into one HTML report artifact by a final job. **Advisory** — not a required check — until two consecutive green nightlies, then flipped in a separate change.
- **Co-resident harness guard (#451 part 2).** `docker/test-up.sh` SHALL detect other running `pi-dash-test-*` compose projects on the same daemon and compare `(n+1) × MEM_LIMIT` against the daemon's `MemTotal`; when oversubscribed it SHALL refuse with a message naming the other project(s) and the arithmetic, unless `PI_HARNESS_ALLOW_OVERSUBSCRIBE=1`. When not oversubscribed but another harness is up, it SHALL warn once (attribution of a red run is degraded under contention).
- **Cross-project destruction audit (#451 part 1).** No in-repo script destroys another project's container (grep evidence in `design.md`: every `down`/`rm` is `-p`-scoped or targets a non-harness container name). The change SHALL add a documented `docker events` capture procedure to `tests/e2e/README.md` and a `docker/harness-audit.sh` helper that records events for the harness label set, so the next occurrence yields evidence instead of a timeline reconstructed after the fact. No claim of a fix is made for part 1.
- **Green baseline (#433 part 1).** Run the sharded suite on `develop` via the new workflow, then classify every red spec: spec drift is fixed in this change (the known `change-summary-table` toast interception has an existing `dismissToasts` helper; `bus-client-goal-plugin-action` expects a plugin error the goal-plugin relocation changed); a genuine product bug gets a filed issue and the spec is quarantined with `test.fixme("<issue url>")` so the baseline reads green-with-known-gaps rather than red. The workflow's first run after merge SHALL be green.

  **Amended in-flight (2026-09-18).** The triage found the CI baseline broadly FLAKY, not a fixed red set: S1–S4 (seed-dir spawn, live-relay occlusion, toast interception, fixture ownership) plus ~10 drift specs and one product bug were fixed, but each 12/18-shard dispatch still surfaced 1–4 NEW single-test reds in different shards. Per-test quarantine is therefore a moving target and full-green was not reached. The workflow ships **ADVISORY** (`continue-on-error` on the PR path) with the `schedule` cron left COMMENTED, 73 residual tests quarantined behind #683, and no dependent gate. This supersedes the "SHALL be green" criterion above; see `tasks.md` task 4.4 and `measurements.md`.

Out of scope: raising `MEM_LIMIT`; changing `workers`/`fullyParallel` (the harness is a single shared server; intra-shard parallelism is a separate measurement); making the workflow a required check.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `playwright-e2e-qa`: the suite SHALL carry no committed global wall-clock budget; a full run SHALL be shardable with a per-shard harness; a red spec attributable to a filed product bug SHALL be quarantined with the issue reference rather than left red.
- `docker-test-harness`: `test-up.sh` SHALL refuse or warn on co-resident harness oversubscription; an events-audit helper SHALL exist.
- `ci-cd-pipeline`: new scheduled/dispatch/label-triggered sharded browser-E2E workflow, advisory, with a merged report artifact.

## Impact

- `playwright.config.ts` (remove `globalTimeout`; add `blob` reporter when `PW_BLOB_REPORT=1` or in CI).
- `.github/workflows/ci-e2e-browser.yml` (new), `.github/workflows/AGENTS.md`, `packages/shared/src/__tests__/*workflow-contract*` if a contract test is added for the new file.
- `docker/test-up.sh`, `docker/lib-ports.sh` (shared `list_running_harness_projects`), new `docker/harness-audit.sh`, `docker/AGENTS.md`, `docker/TESTING.md`.
- `tests/e2e/README.md`; individual specs in `tests/e2e/` per the triage outcome.
- `.pi/skills/ship-it/SKILL.md` and `.pi/skills/run-dashboard-e2e-local-changes/SKILL.md` where they state the 15-minute budget or unconditional per-worktree isolation.

## Discipline Skills

- `systematic-debugging` — #433 part-1 triage: each red spec is root-caused (drift vs product bug) before any spec edit.
- `observability-instrumentation` — the events-audit helper and the oversubscription message exist so the next #451 occurrence is diagnosable.
- `doubt-driven-review` — dropping `globalTimeout` and the shard count are reviewed before they stand (an unbounded local run on a wedged harness must still terminate via the harness-down short-circuit).
- `review-code` — before commit.
