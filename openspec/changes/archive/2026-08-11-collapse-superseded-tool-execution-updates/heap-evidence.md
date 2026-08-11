# Heap evidence — tasks 1.1, 1.3, 10.1

Measured A/B on the docker harness (`MEM_LIMIT=6g`, `PI_E2E_SEED=1`,
`PI_TEST_PEERS=both`), identical workload both sides: 4 tmux sessions ×
4 rounds of `[[faux:subagent-sustained]]`, which drives a real `Agent` tool call
whose `onProgress` emits a sustained `tool_execution_update` stream.

Baseline was produced by disabling `dropIfSuperseded` behind a temporary env gate
(**verified present inside the container**, and `collapsedUpdates: 0` confirms it
was actually in force). Both the gate and its compose passthrough are reverted.

Buffer figures come from `scripts/heap-probe.mjs` (CDP `Runtime.queryObjects`,
no restart). Heap/rss are the GC FLOOR over a ≥ 60 s sampling window, not a
single reading.

## Per-buffer (task 1.3 = before, task 10.1 = after)

| | BEFORE (collapse off) | AFTER (collapse on) |
|---|---|---|
| buffer length | 195 / 197 / 195 / 199 | 157 / 164 / 164 / 165 |
| retained `tool_execution_update` | **36** per buffer | **2** per buffer |
| `tool_execution_update` share | 18.1 – 18.5 % | 1.2 – 1.3 % |
| avg bytes/event | 1217 – 1257 B | 1324 – 1381 B |
| est. bytes/buffer | ~0.2 MB | ~0.2 MB |
| `storeTrim.collapsedUpdates` | 0 | 136 |

## Process-level (task 1.1)

| | BEFORE | AFTER |
|---|---|---|
| heapUsed GC floor | 95 MB | 90 – 93 MB |
| rss floor | 348 MB | 346 MB |
| activeSessions | 4 | 4 |

## Reading of the numbers — honest scope

- **The mechanism does exactly what it claims.** Retained updates per
  `toolCallId` drop **36 → 2**, i.e. the ≤ 2 policy, a 94 % reduction in the
  retained tick population.
- **The books balance exactly.** 34 dropped per buffer × 4 buffers = **136** =
  the reported `collapsedUpdates`. The counter is not double-counting or
  over-reporting.
- **Average bytes/event RISES** (1240 → 1350 B). Expected, not a regression: the
  collapsed ticks were smaller than the buffer average, so removing them lifts
  the mean of what remains.
- **At THIS scale the process-level win is small** (~2–5 MB heap floor, rss
  unchanged within noise) because each buffer is only ~0.2 MB — total live buffer
  bytes are dwarfed by baseline server allocations. This evidence therefore
  supports the RETENTION claim, and does not by itself demonstrate the
  proposal's multi-MB saving; that regime needs the fat real-world buffers
  (~55 MB) named in the deferred `subagent_*` follow-up. Per the P2 decision
  these numbers are EVIDENCE, not a pass/fail gate.
