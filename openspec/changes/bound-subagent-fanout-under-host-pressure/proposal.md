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
- **Tick forwarding is unthrottled in the wild.**
  `subagentTickThrottleMs` still defaults to `0`; `01a0a739` forwarded 8983
  ticks and coalesced 0. The flip to `500` ships with #671, unreleased.
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
  - under a configured width cap and no host pressure → admit unchanged;
  - over the cap, or host pressure is active → `{ block: true, reason: … }`
    naming exactly which siblings were deferred and instructing re-issue in a
    later turn. Blocked calls get a real tool result, so no card is orphaned
    and the model can proceed with the admitted subset.
- **Admission must never wait for a slot to free.** Siblings are preflighted
  **sequentially and only then executed concurrently**, so awaiting child 1's
  completion inside child 2's `tool_call` deadlocks by construction. The gate
  is therefore reject-or-stagger only: a bounded `await` may stagger starts
  within one batch, never block on another child's terminal state. This is a
  load-bearing invariant with its own test.
- **Host pressure drives the cap.** The bridge already samples
  `eventLoopMaxMs` / `loadAvg1m` / `cpuPercent` for `processMetrics`. Those
  same samples feed the gate: above threshold the effective width cap drops to
  1 (serialize) rather than refusing all work.
- **The refusal is observable.** Each admission decision appends a counter
  (`fanoutAdmitted`, `fanoutDeferred`, `fanoutSerialized`) alongside the
  existing tick counters in `processMetrics`, so the dashboard can show *why* a
  fan-out was narrowed instead of silently changing agent behaviour.
- **Config, defaulted conservative.** `maxConcurrentSubagents` (default `3`)
  and the pressure thresholds live in `packages/shared/src/config.ts` next to
  `subagentTickThrottleMs`; `0`/absent disables the gate entirely so the
  feature is opt-out per host.

Not changed: pi's `Agent` tool itself, the subagents producer package, the
orphan-heal paths owned by #671, subagent card UI.

## Capabilities

### New Capabilities
- `subagent-fanout-admission`: the bridge admits, serializes, or defers `Agent`
  tool calls per assistant batch based on a width cap and live host pressure,
  never waiting on a sibling's completion, and reports each decision.

### Modified Capabilities
- `subagent-live-cadence`: host pressure becomes an input to fan-out width, not
  only to tick bandwidth.

## Impact

- `packages/extension/src/` — new `subagent-fanout-admission.ts` (pure decision
  fn: batch size + pressure sample + config → per-call verdict) and its
  `tool_call` wiring; counters joined into the existing `processMetrics` payload.
- `packages/shared/src/config.ts` — `maxConcurrentSubagents` + pressure
  thresholds, defaults, resolution tests.
- `packages/shared/src/protocol.ts` — the three counters on the metrics frame.
- Harness: `qa/` or a scripted spike for the N × ctx measurement table; its
  numbers are quoted in `design.md` before any constant is picked.
- Tests: decision-fn unit matrix (widths × pressure × config incl. disabled);
  a deadlock-regression test asserting the gate never awaits a sibling
  terminal; integration asserting a deferred call produces a real blocked tool
  result (no orphan card); counter propagation test.
- Docs: `packages/extension/src/AGENTS.md` row; `docs/architecture.md` fan-out
  paragraph; `docs/faq.md` entry "session dies whenever it spawns subagents".
- Rebuild: `npm run reload` (extension) + server restart for the protocol field.
- Sequencing: lands **after** #671, so orphan healing already covers any child
  that dies while the gate is being tuned.

## Discipline Skills

- `performance-optimization` — measure-first is a hard gate here: the N × ctx
  table precedes the cap constant, and the same harness re-runs after the
  change to show the stall actually moved. Correlation (13/14) is not yet a
  proven cause.
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
