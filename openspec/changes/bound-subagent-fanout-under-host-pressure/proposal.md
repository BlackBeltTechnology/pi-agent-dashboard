# Bound subagent fan-out under host pressure

## Why

The `zeta-pi-only-agent-docs` session chain (cwd `/Users/robson/Project/judo-ng`,
PR #998) does not finish work — it dies, gets resumed, and dies again. Census of
every session JSONL in `~/.pi/agent/sessions/--Users-robson-Project-judo-ng--/`
from 2026-09-13 onward:

| Sessions in chain | Last transcript entry is an **unanswered `Agent` fan-out** |
|---|---|
| 14 | **13** |

The single exception (`01a0a68f`) is the only one that never fanned out.
Death is not random: the transcript's final write is the fan-out itself, every
time. Two most recent, from the dashboard:

| Session | ended | `closedReason` | `eventLoopMaxMs` | `tickForwarded` / `tickCoalesced` | `loadAvg1m` | ctx |
|---|---|---|---|---|---|---|
| `01a0a706` | 22:02 | `process_gone` | — | — | — | 219 059 |
| `01a0a739` | 22:40 | `process_gone` | **142 942** | **8983 / 0** | 11.0 | 223 640 |

`01a0a739`'s own lifetime is 7 entries: prompt → 2 `ctx_execute` → a 3-wide
`Agent` fan-out at 22:40:07 → nothing. `hostPressure.state` went
`unresponsive`, the event loop blocked **143 s**, the process was reaped. No
`*AGENTS.md` was written by any child afterwards: the children die with the
parent, so the whole round's work is lost and re-done on the next resume.

Known contributors, already measured elsewhere:

- **Per-child extension instantiation blocks the parent's loop.** The
  `heal-orphaned-tool-cards-on-session-end` spike (7 children, warm parent, 27
  extensions) measured **3.3 s of synchronous loop block**, 3.1 s of it one
  extension's `npm root -g` `spawnSync`. That change memoizes it. 3 children ≈
  1 s remains, so the memo alone does **not** explain a 143 s stall.
- **Tick forwarding was unthrottled in the sessions that died.** `01a0a739`
  forwarded 8983 ticks and coalesced 0. `DEFAULT_SUBAGENT_TICK_THROTTLE_MS` is
  already `500` on `develop` (`config.ts:925`, landed with #671) — but the
  crashed sessions ran the released package, where it was `0`.
- **Unbounded width.** Nothing anywhere caps how many `Agent` children one
  assistant message may start, and nothing consults host load before starting
  them. Observed widths in this chain: 3, 4 and **7**.

This change is about the parent **surviving** the fan-out. It is deliberately
disjoint from `heal-orphaned-tool-cards-on-session-end` (PR #671), which makes
the *corpses honest* (orphaned cards stop spinning) but does not stop the
dying — and from the upstream `pi-dashboard-subagents` change
`reduce-fanout-parent-stall`, which targets the cosmetic quiet-parent
transcript. The 13/14 crash rate is evidence neither is sufficient.

## What Changes

- **Measure before bounding (gate).** A reproducible harness spawns an N-wide
  `Agent` fan-out from a parent with a controlled context size and records
  parent `eventLoopMaxMs`, wall time to first child start, and survival, for
  N ∈ {1, 3, 7} × ctx ∈ {small, ~220 k}. No throttle constant is chosen before
  this table exists; if width does **not** drive the stall the change stops
  here and re-targets on the measured cause.
- **Admission control on `Agent` spawns, in the bridge extension.** `tool_call`
  is pi's only blocking pre-execution seam (`docs/extensions.md` §Tool Events)
  and the bridge already runs in every session. On `tool_call` where
  `toolName === "Agent"`, an admission gate decides per call:
  - in-flight children below the effective cap → admit unchanged;
  - at or above it → `{ block: true, reason: … }` stating the in-flight count and
    directing re-issue *after* those children finish. Blocked calls get a real
    errored tool result (`pi-agent-core/dist/types.d.ts:35-48`), so no card is
    orphaned and the model proceeds with the admitted subset.
- **The bound is in-flight concurrency, not batch width.** The extension-visible
  `tool_call` event carries only `{type, toolCallId, toolName, input}` — pi drops
  `assistantMessage` before the extension sees it (`dist/core/agent-session.js:230-235`),
  so batch size and batch identity are not knowable at decision time. A counter
  incremented on admit and released on `tool_execution_end` is both implementable
  and immune to the next-turn re-issue that a per-batch budget would wave through.
- **Admission must never wait on a child, and never delay one.** Siblings are
  preflighted **sequentially and only then executed concurrently**, so awaiting a
  child's completion deadlocks by construction — and delaying an admitted call
  cannot spread start cost, since execution begins only once every sibling has
  been preflighted. Reject-only. A load-bearing invariant with its own test.
- **Release on `tool_execution_end`, never on `tool_result`.** An aborted call
  skips `finalizeExecutedToolCall` — the only caller of `afterToolCall` — but
  still emits `tool_execution_end` (`pi-agent-core/dist/agent-loop.js:353-362`).
  Releasing on `tool_result` would leak a permit on every Esc and eventually
  refuse all subagent work for the session.
- **Resource saturation narrows the cap to 1**, never to 0, so a loaded session
  still progresses. The gate samples from **its own** rolling-window monitor: the
  existing `collectMetrics()` is a destructive read (resets `eld` + CPU delta,
  `process-metrics.ts:35-69`) sampled only by the 15 s heartbeat, so reusing it
  would corrupt the telemetry that evidences this failure — and merely reading
  that same histogram would flap the cap on the heartbeat period. Named for
  saturation, not "host pressure": that name is taken by the bridge-silence
  verdict in `packages/shared/src/host-pressure.ts`.
- **Fail open.** A throwing `tool_call` handler is rethrown by pi as "Extension
  failed, blocking execution" (`agent-session.js:237-242`), so a gate defect
  would refuse *every* `Agent` call. Any failure in the decision path admits.
- **The refusal outlives the process.** Live counters (`fanoutAdmitted`,
  `fanoutRefused`, `fanoutSaturationRefused`) ride `processMetrics`; each refusal
  is *also* written as a custom session entry via `appendEntry`, because the
  failure mode being mitigated ends with the process gone. Admissions are not
  written — no filesystem I/O on the hot path. Note the coupling: custom entries
  are auto-forwarded to the dashboard and rendered
  (`packages/extension/src/custom-entry-forward.ts`), so the entry shape is part
  of the contract.
- **Config, active by default.** `maxConcurrentSubagents` and the pressure
  thresholds live in `packages/shared/src/config.ts` next to
  `subagentTickThrottleMs`. **Absent = active at the default cap**; an explicit
  `maxConcurrentSubagents: 0` is the opt-out and the rollback path; a malformed
  value fails open. The default cap is chosen from the Decision 1 measurement and
  must be below the observed fatal widths (3, 4, 7) — so it is 1 or 2, and the
  measurement matrix covers both.

Not changed: pi's `Agent` tool itself, the subagents producer package, the
orphan-heal paths owned by #671, subagent card UI.

## Capabilities

### New Capabilities
- `subagent-fanout-admission`: the bridge admits or refuses `Agent` tool calls
  against a bound on in-flight children, narrowed by live host pressure, never
  waiting on or delaying a child, failing open, and recording each refusal
  durably.

### Modified Capabilities
None. `subagent-live-cadence` is untouched: a deferred child never ticks, and
narrowing width to 1 leaves the cadence floor for *running* subagents exactly as
specified.

## Impact

- `packages/extension/src/` — new `subagent-fanout-admission.ts` (pure decision
  fn: in-flight count + pressure reading + config → verdict), its `tool_call`
  wiring, the `tool_execution_end` release, and a private pressure sampler;
  counters joined into the existing `processMetrics` payload.
- `packages/shared/src/config.ts` — `maxConcurrentSubagents` + pressure
  thresholds, defaults, resolution tests.
- `packages/shared/src/protocol.ts` — the three counters on the metrics frame.
- Harness: `qa/` or a scripted spike for the N × ctx measurement table; its
  numbers are quoted in `design.md` before any constant is picked.
- Tests: decision-fn unit matrix (in-flight count × pressure × config incl.
  disabled and malformed); a deadlock-regression test asserting the gate never
  awaits a child; a **cancellation** test asserting the count returns to zero on
  abort (the `tool_execution_end` vs `tool_result` trap); a fail-open test
  asserting a raising decision path still admits; integration asserting a refused
  call produces a real errored tool result (no orphan card); counter propagation
  + durable-entry test; a handler-registration-order test (the gate must not
  short-circuit the bridge's own `tool_call` forwarder).
- Docs: `packages/extension/src/AGENTS.md` row; `docs/architecture.md` fan-out
  paragraph; `docs/faq.md` entry "session dies whenever it spawns subagents".
- Rebuild: `npm run reload` (extension) + server restart for the protocol field.
- Sequencing: lands **after** #671, so orphan healing already covers any child
  that dies while the gate is being tuned.

## Discipline Skills

- `performance-optimization` — measure-first is a hard gate here: the
  N × ctx × host-load table precedes the cap constant, and the same harness
  re-runs after the change to show the stall actually moved. Correlation (13/14)
  is not yet a proven cause.
- `systematic-debugging` — the repro is a real chain of 14 sessions, not a
  mock; the fix must be validated against a parent at ~220 k context, the
  condition under which every observed death occurred.
- `review-code` — the gate sits in front of every `Agent` call in every
  session; a wrong verdict silently changes agent behaviour or, in the
  wait-for-slot shape, deadlocks the batch. Disabled-by-config must be a
  provable no-op.
- `observability-instrumentation` — a narrowed fan-out that is invisible is
  indistinguishable from a model that chose not to parallelize; the counters
  are part of the change, not a follow-up.
