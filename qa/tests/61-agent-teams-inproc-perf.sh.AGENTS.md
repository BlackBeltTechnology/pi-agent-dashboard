# 61-agent-teams-inproc-perf.sh — index

L2 OPT-IN perf/memory/risk rows of in-process agent-teams (test-plan #S97, #S98, #S100, #S101 = tasks 13.1-13.4). `PI_QA_INPROC_PERF=1` else `SKIP:`. Not in `run-all.sh` TESTS (comment only). Hermetic: port 18981. Thin bash + `lib/agent-teams-inproc-perf.cjs`.

Mode printed per section. `upstream`: `QA_SUBAGENTS_PKG_DIR` = `@blackbelt-technology/pi-dashboard-subagents` >= 0.9.0 that handles `subagents:capabilities` (`ati_upstream_reason`); registered in the prefix settings; lead runs without fake. `fixture` (otherwise, NOTE names reason): fake subagents extension; dashboard plumbing only, no child boot cost / loader / per-child heap.

Sections (`QA_INPROC_PERF_SECTIONS`):
- `spawn` S97: `QA_INPROC_SPAWN_N` (10) bench cycles per mode; median in-process <= 50 % of session median; cold/warm reported. Fixture: regression guard on the command channel only; lean arm skipped. Upstream: lean {false,true} via `POST /api/config/plugins/agent-teams`, lean <= full x1.1.
- `memory` S98: 4 idle children heap delta (report-only until `QA_INPROC_BASELINE_FILE`, then <= 1.5x), busy under `agent-teams-inproc-mail-burst` for `QA_INPROC_MEM_BUSY_S` (120; spec 600) + >= `QA_INPROC_MAIL_BURSTS`; heap slope; mail list <= 100, no unknown/overflow/timeout counters. Registry/outbox/ledger/cmdId sizes = L1 only. 1 h kept-alive idle soak NOT automated.
- `lag` S100: 4 busy children + progress emissions, `QA_INPROC_LAG_S` (120; spec 1800); 0 spurious `lead_ended`; fake loop probe + heartbeat `eventLoopMaxMs` reported, hard ceiling `QA_INPROC_LAG_HARD_MS` (10000). 2x-heartbeat-interval bar NOT enforced (report-only until a baseline).
- `starve` S101: fixture only (SKIP in upstream mode). Fake child `[[fake-block:400000]]` blocks lead loop > 2x 180 s heartbeat timeout: team closed `lead_ended`, lead alive, queued stops delivered on next hello, fake child list empty.

`QA_INPROC_RECORD_BASELINE=<file>` writes the measured values (first baseline, decision A12).

NOT executed at authoring time (no VM/docker). See change: add-agent-teams-in-process.
