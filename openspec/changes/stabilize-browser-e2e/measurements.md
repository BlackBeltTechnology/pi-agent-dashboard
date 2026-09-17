# Measurements — stabilize-browser-e2e (#433, #450, #451)

## Dispatch mechanism (task 3.3)

`gh workflow run ci-e2e-browser.yml --ref os/stabilize-browser-e2e` is
**impossible before merge**: `workflow_dispatch` is only available for workflows
that exist on the DEFAULT branch, and this workflow is new on this branch →
`HTTP 404: workflow not found on the default branch`.

Dispatch was therefore done through the workflow's **PR path**: open the PR and
apply the `e2e-browser` label (types `opened`/`synchronize`/`reopened`/`labeled`).
Runs are advisory on that path (`continue-on-error`), so the job's own conclusion
is the signal, not the check's.

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
