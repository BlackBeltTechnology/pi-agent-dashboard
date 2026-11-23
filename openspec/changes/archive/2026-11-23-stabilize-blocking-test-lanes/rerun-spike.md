# Rerun spike results (task 1.1)

Run on 2026-11-22 from scratch branch `spike/nightly-rerun` (push-triggered `spike-nightly-rerun.yml`; branch and workflow since deleted).

- Run 1 (`ONLY_TIMEOUT=0`, attempt 1 failed in `flaky`, `slow` timed out, `report` exit 1; then `gh run rerun --failed` → attempt 2 green): https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/45078578910
- Run 2 (`ONLY_TIMEOUT=1`: only `slow` timeout + `report` exit 1; plus `dl` job with `permissions: {actions: write}` only): https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/45078800622

| Item | Answer | Evidence |
|---|---|---|
| (a) attempt 2 `report` downloads attempt-1 artifacts of jobs that were not rerun (`spike-ok`) and the `spike-attempt-1` artifact | **yes** | https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/45078578910 attempt 2 `report`: `dl-all/spike-ok/ok.txt: ok attempt 1`, `dl-all/spike-attempt-1/attempt-1.json` |
| (b) a rerun job's same-name upload replaces the earlier one with `overwrite: true` | **yes** | https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/45078578910 attempt 2: `dl-all/spike-flaky/flaky.txt: flaky attempt 2` (single file, no duplicate) |
| (c) `--failed` reruns a timed-out job and the dependent `report` | **yes** | https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/45078578910: `slow` (timeout, conclusion `cancelled`), `flaky`, `report` reran; `ok`/`select` did not |
| (d) `needs.select.outputs` of a job not rerun are visible in attempt 2 | **yes** | https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/45078578910 attempt 2: `marker: from-select-attempt-1` |
| (e) `github.event_name` on a rerun equals the original event (`push` spiked; `schedule` inferred) | **yes** | https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/45078578910 attempt 2: `event=push attempt=2` |
| (f) attempt 2 reads attempt 1's `event`/`conclusion` via `GET .../attempts/1` with `actions: read` | **yes** | https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/45078578910 attempt 2: `{"conclusion":"failure","event":"push","status":"completed"}` |
| (g) `needs.<job>.result` of a job not rerun is still `success` in attempt 2 | **yes** | https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/45078578910 attempt 2 `toJSON(needs)`: `select` and `ok` (not rerun) both `"result": "success"` |
| (h) a run whose only problems are a `timeout-minutes` job and a `report` exit 1 ends `failure` | **no** | https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/45078800622: run `conclusion` is `cancelled` (the timed-out job's conclusion is `cancelled`) |
| (i) a job with only `actions: write` can `gh run download` a named artifact of another completed run | **yes** | https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/45078800622 `dl` job: `dl/ok.txt: ok attempt 1` (artifact of https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/45078578910) |

## Disposition (design.md D7 "If the spike fails")

Blocking items (a), (b), (d), (e), (g), (i): all **yes**. Only (h) is **no**. Group 6 is carried out with the D7 rule for (h): the `rerun` job's `if:` accepts `cancelled` as well as `failure`. No owner question.
