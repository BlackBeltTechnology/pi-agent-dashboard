# Measurements — stabilize-browser-e2e (#433, #450, #451)

## Dispatch mechanism (task 3.3)

`gh workflow run ci-e2e-browser.yml --ref os/stabilize-browser-e2e` was 404
for the FIRST dispatch (2026-09-16): at that point `workflow_dispatch` was not
registered for a workflow that only existed on a non-default branch. By the
second dispatch it WORKED (run 35272663761) — GitHub had registered the
workflow after the earlier PR-path runs. Recorded so the next dispatcher does
not assume it is impossible.

Dispatch can also be done through the workflow's **PR path**: apply the
`e2e-browser` label (types `opened`/`synchronize`/`reopened`/`labeled`). Runs
are advisory on that path (`continue-on-error`), so the job's own conclusion is
the signal, not the check's.

| run | head | trigger | outcome |
|---|---|---|---|
| [35144577412](https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/35144577412) | `ccd21913c` | label | skipped in 1 s — **unlabeled path proven** (merge-report skip guard) |
| [35144587026](https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/35144587026) | `ccd21913c` | label | 6/6 shards red at the 180 s health cap (cold build unfinished) |
| [35145506297](https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/35145506297) | `ccd21913c` | push | 6/6 red: container Started, `/api/health` never 200 for 20 min — **no cause in any uploaded log** |
| [35152789810](https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/35152789810) | `177b6a06d` | push | 6/6 red in 8m39s — **harness-failure bundle named it**: `mount: … cannot mount overlay read-only`, exit 32, `restarts=6` |
| [35153785595](https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/35153785595) | `2f2167e52` | push | **harness boots** (copy mode); 5/6 shards red on specs, shard 3 killed at the 75-min job timeout |

## Per-shard wall clock + result (run 35153785595)

All shards started `2026-09-16T21:41:46Z`.

| shard | wall clock | passed | failed | skipped | note |
|---|---|---|---|---|---|
| 1 | 58m48s | 107 | 17 | 4 | |
| 2 | 74m48s | 80 | 37 | 11 | |
| 3 | 75m19s | — | — | — | **cancelled at `timeout-minutes: 75`**; no blob report |
| 4 | 57m26s | 101 | 19 | 13 | |
| 5 | 67m21s | 86 | 27 | 2 | |
| 6 | 67m02s | 68 | 29 | 26 | |

Totals over the 5 shards that produced a report: **442 passed / 129 failed /
56 skipped**. Shard 3's red set is unknown (killed mid-run).

## Image-build share

From the shard boot log (`test-results/test-up.log`): BuildKit runs ~38 steps;
the heaviest are apt/cleanup (#35, 95.4 s) and the layer export (#37, 81.9 s).
Cold-build wall clock is therefore **≈3–4 min**, i.e. a single-digit percentage
of a 58–75 min shard — the wall clock is dominated by the spec run, not the
build. A buildx GHA cache is documented as the escape hatch and is **not
adopted** (design open question, not an assumption).

## What the numbers forced (design deltas vs D2/D3)

1. **`PW_E2E_BOOT_TIMEOUT_MS` (CI 1200 s).** The 180 s local default starts
   polling immediately after the detached `--build` is spawned, so a cache-less
   runner died at exactly 180 s with "container never became healthy" while the
   build was still running.
2. **`TEST_COPY_MODE=1`.** GitHub-hosted runners refuse the entrypoint's
   `mount -t overlay` (exit 32 → crash-loop, `restart: unless-stopped`). Copy
   mode is the spec-sanctioned no-capability fallback and is free here:
   globalSetup boots from an EMPTY throwaway workspace.
3. **Red baseline is much larger than the "known starters" in task 4.2.** The
   systemic causes were `ENOENT .pi-test-harness.json` (state file written to the
   throwaway workspace, read from `REPO_ROOT`/`cwd` by 13 specs) and
   `401 operator credential required` (host→published-port request is not
   loopback, so operator-guarded routes need the real `x-pi-local-token`).
   Both fixed; the residual red set is triaged under tasks 4.2–4.4.

## Baseline triage — the two systemic causes (run 35197357003 → commit `776d601e0`)

Run 35197357003 (6 shards, 168-spec suite) still reported 44 + 54 + 34 + 40
failures on shards 1/2/4/5 and KILLED shards 3/6 at the 120-min budget (a killed
shard contributes nothing). Two causes accounted for the bulk, both reproduced
on ONE fresh local harness and fixed:

| # | Cause | Blast radius | Decisive evidence | Fix |
|---|---|---|---|---|
| S1 | `spawnFreshGitSession` clicked an arbitrary folder group's Create tray | 87 specs call it | `POST /api/session/spawn {cwd:/fixtures/seed-win-124}` → `500 Directory does not exist`; the seed dirs come from `scripts/seed-sessions-window.mjs` (`PI_E2E_SEED=1`) | pin `FIXTURE_GIT`, then click INSIDE `folder-body-<cwd>` |
| S2 | `globalSetup` defaulted `PI_BROWSER_RELAY_FAKE=1` on the shared harness | every spec that opens a session | `isLiveViewActive()` → true for ALL sessions → `content-view` slot renders `LiveViewTile`; live repro showed `chat-scroll-container`/composer count `0` | opt-in passthrough + `test.skip` the browser-relay spec when absent |

Recovery measured on the live harness (same specs that were red in CI):

| spec | before | after |
|---|---|---|
| `overlay-layout` | 10 failed | 86 passed / 3 failed (residual) |
| `canvas-declare-tool` | 11 failed | all passed |
| `asciidoc-preview` | 2 failed | 2/2 |
| `ctx-running-render` | 1 failed | 1/1 |
| `browser-relay` | 5 failed | 5 skipped (opt-in faucet) |

Residual drift fixed in the same pass: `change-summary-table`, `editor-pane` F3,
`enhance-tool-call-grouping` 1/2, and the duplicated toast helper (8 specs).
The remaining red list lives in task 4.2.

## Second dispatch — run 35259223668 (post-systemic-fix, 6 shards)

The first run that reached the specs AFTER S1/S2 landed. All six shards booted
and produced a blob. Wall clock (all started `18:32:46Z`):

| shard | wall clock | passed | failed | timedOut | skipped | note |
|---|---|---|---|---|---|---|
| 1 | 38m | 117 | 2 | 0 | 9 | |
| 2 | 42m | 107 | 8 | 3 | 10 | |
| 3 | ~115m | 63 | 17 | **34** | 7 | near the 120-min cap |
| 4 | 52m | 115 | 5 | 1 | 12 | |
| 5 | 48m | 111 | 5 | 1 | 2 | |
| 6 | 100m | 71 | 26 | 1 | **25** | harness-down short-circuit after the timeouts |

**592 passed / 117 distinct failed.** Versus the 129-red, 5-shard baseline this
is a real recovery, but the run exposed a NEW infrastructure problem:
`--shard=i/N` balances by TEST COUNT, not DURATION, and the slow specs
(`subagent-*`, `tail-only-*`, `terminal`) cluster. Shards 3 and 6 ran ~2× the
other four.

The two long shards are NOT more-broken code — they are a DEGRADED long run:
shard 3 recorded **34 `timedOut`** results (a cascade), and shard 6 recorded
**25 skipped** (the harness-down short-circuit: 3 consecutive probe failures →
the remaining specs skip) plus harness symptoms in its red messages (`docker
exec` failures, a 25-min `beforeAll` timeout, `browserContext.close`). A shard
that runs 100+ min on a single shared harness is not attributable.

### Design delta — matrix re-sized 6 → 12 → 18

Halving the per-shard spec count halves the wall clock. The contract test
derives the matrix length from the YAML and asserts every `--shard=i/N`
denominator equals it, so each bump is self-consistent (17/17 contract tests
pass). `timeout-minutes` stays 120 as the cap.

N=12 was NOT enough: run 35302540253 came back **11/12 shards GREEN** with
shard 6 **CANCELLED at the 120-min cap** (no test failures — it simply did not
finish). `--shard` splits by CONTIGUOUS file order, not round-robin, so shard 6
inherits the alphabetical `mcp-*` / `model-*` / `notify-*` L3 block, each test
spawning a real session, while the other 11 shards finish in ~40-60 min. N=18
cuts that shard's spec count by a third. This supersedes the earlier
"re-sizing tracked separately" note: the data made each bump the fix, not a
follow-up.

### Baseline green-with-known-gaps

Run 35302540253 (12 shards) had **11 green shards and zero test failures** in
them; the only non-green shard was the cap-cancelled one. 73 residual reds are
quarantined behind issue #683 with `test.fixme(true, "…/issues/683")`. The
baseline is BROADLY FLAKY — each dispatch surfaces 1-4 NEW single-test reds in
different shards (folder-actions-menu, followup-image-queue, openspec-init-affordances, inline-terminal-transcript P1, folder-membership-drag, subagent-*) —
so per-test quarantine is a moving target and a deterministic all-green run was
not reached in this change. The workflow is ADVISORY on the PR path and the
nightly cron stays COMMENTED; the residual flakiness is tracked in #683.

### Residual triage (second dispatch)

117 distinct reds across 62 files. A local fresh-harness pass over 24 of the
shards 1/2/4/5 spec files found ~19 DETERMINISTIC failures; the rest passed
locally → CI-only flakiness (consistent with the long-shard degradation). Fixed
in this pass (each reproduced locally):

- **drift** — `bus-client-goal-plugin-action` (used `flows`, now a KNOWN handler,
  as the unhandled probe), `folder-status-capsule` F1-order (relied on the
  previous serial test's sessions, removed by per-test reaping),
  `error-lifecycle` test 1 (asserted NO settled Retry; `fix-retry-error-lifecycle`
  re-added one).
- **product bug** — `event-reducer` `message_end` cleared `lastError` on ANY
  non-error stop, so an `ask_user` `tool_use` pause silently cleared the settled
  error anchor, contradicting the `CONFIRMED_GOOD_STOP_REASONS` intent the
  `agent_end` arm already honours. Recovery now requires a confirmed-good
  terminal stop, or an active retry chain.
