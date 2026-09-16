## Context

See `proposal.md` — Why for the crash census and the metrics at death.

Platform facts this design rests on, each verified in the installed pi rather
than inferred from prose:

| Fact | Source |
|---|---|
| The extension-visible pre-execution event carries only `{type, toolCallId, toolName, input}` | `dist/core/extensions/types.d.ts:678-724` |
| pi-agent-core's own hook context *does* carry `assistantMessage` (hence batch size) — pi drops it before the extension | `pi-agent-core/dist/types.d.ts:74-84` vs `dist/core/agent-session.js:230-235` |
| `{block:true, reason}` → "the loop emits an error tool result instead; `reason` becomes the text shown in that error result" | `pi-agent-core/dist/types.d.ts:35-48` |
| A throwing handler is rethrown as "Extension failed, blocking execution" | `dist/core/agent-session.js:237-242` |
| Siblings are preflighted sequentially, then executed concurrently | `docs/extensions.md:784`; `pi-agent-core/dist/types.d.ts` `ToolExecutionMode` |
| `collectMetrics()` is a **destructive** read — resets `eld` and the CPU delta; sole caller is the 15 s heartbeat | `packages/extension/src/process-metrics.ts:35-69`, `packages/extension/src/bridge.ts:106,3481` |
| An **aborted** call finalizes with `createErrorToolResult("Operation aborted")` and skips `finalizeExecutedToolCall` — the only caller of `afterToolCall` (→ no `tool_result` for the extension) — but still calls `emitToolExecutionEnd` | `pi-agent-core/dist/agent-loop.js:353-362, 491-496` |
| `beforeToolCall` runs *before* the abort check, so the gate can be consulted for calls pi is about to discard | `pi-agent-core/dist/agent-loop.js:412-425` |
| An extension can write a durable custom entry into the session record | `dist/core/extensions/types.d.ts:985` (`appendEntry`) |

The last two rows are what make this design non-obvious, and both invalidate the
first shape it took (a per-batch cap reading `collectMetrics()`).

The cause of the stall is also **not proven**. The one measured contributor —
per-child extension instantiation, 3.3 s of sync block for 7 children — accounts
for roughly 1 s at the census width of 3, against a 143 s stall. Something else
dominates.

## Goals / Non-Goals

**Goals:**

- Establish *whether* fan-out width drives the parent stall, with numbers, before
  any mitigation constant is chosen.
- Keep a session alive through a fan-out on a loaded host, accepting reduced
  parallelism as the price.
- Make the mitigation visible after the process dies, and reversible.

**Non-Goals:**

- Fixing the underlying stall. This bounds exposure; it does not claim to remove
  it. If measurement localizes the cost elsewhere (e.g. per-child context
  inheritance), that fix is a separate change.
- Healing already-orphaned cards — owned by
  `heal-orphaned-tool-cards-on-session-end`.
- Any change to the `pi-dashboard-subagents` producer.
- Cross-session admission: two sessions on one host can still each fill their own
  cap.
- **Grandchildren.** A subagent runs in-process and skips bridge initialization
  (`bridge.ts:216-218` re-entry guard), so a child that itself calls `Agent` is
  not gated. Out of scope: gating it means either moving admission outside that
  guard — colliding with the module-singleton state the bridge already relies on,
  and conflating parent and child counts — or inventing a cross-instance
  protocol. No observed death involves a grandchild fan-out. Stated so the bound
  reads as "per gated session", not "per process".
- **Other agent-spawning surfaces.** `flow_agents` (`bridge.ts:2509`) fans out
  without going through the `Agent` tool and is therefore not gated. Out of scope
  deliberately: no observed death involves it, and widening the gate to a second
  surface before the first is measured would compound an unvalidated mitigation.

## Decisions

### Decision 1 — Measurement gates the constant, and may cancel the change

Build the harness first; pick the cap from its table. For N ∈ {1, **2**, 3, 4, 7}
× ctx ∈ {small, ~220 k} × host ∈ {idle, loaded}, record parent `eventLoopMaxMs`,
wall time from batch start to first child start, and survival.

N = 2 is in the matrix deliberately: the only cap values permitted by the
constraint below are 1 and 2, so a matrix that skipped them would ship a constant
the measurement never covered.

Read of the table:

- Stall scales with **N** at fixed ctx → width is the driver; cap as designed.
- Stall scales with **ctx** at fixed N → per-child inheritance cost dominates; a
  width cap only divides the pain. Stop, re-target, say so.
- Stall scales with **N × ctx** → both; the cap is a legitimate partial
  mitigation and ships with the measurement recorded here.

**The cap must be chosen against the observed fatal widths, which are 3, 4 and
7.** A default of 3 would have admitted the majority of census batches unchanged.
No illustrative number in the spec is 3 for this reason — the scenarios are
written against a symbolic cap so that no requirement blesses a width that kills.

**Host load is a harness dimension, not a constant.** Every observed death sits
at `loadAvg1m` ≈ 11 with many sessions resident; a cap calibrated only on an idle
host may not transfer, and the ctx-vs-N conclusion itself can flip under load.
The matrix therefore runs at both an idle and a loaded host state, and the widths
include 4.

*Alternative rejected:* pick a plausible cap now, validate later. That ships a
change that appears to work because the workload also changed.

**Measured result (2026-09-16).** Harness:
`tests/e2e/subagent-fanout-measurement.spec.ts` (artifact
`test-results/fanout-measurement.json`). The real `pi-dashboard-subagents`
producer drives N-wide `Agent` fan-outs from one parent on the docker harness;
`cap` is `maxConcurrentSubagents` read by the NEXT session's bridge; parent
`eventLoopMaxMs` is the max observed across one full 15 s heartbeat window after
the turn.

| N | ctx | host | cap | parent `eventLoopMaxMs` (ms) | time-to-first-child-start (ms) | survived | admitted / refused |
|---|---|---|---|---|---|---|---|
| 1 | small | idle | 0 (ungated) | 113 | 1947 | yes | 0 / 0 |
| 2 | small | idle | 0 (ungated) | 134 | 2276 | yes | 0 / 0 |
| 3 | small | idle | 0 (ungated) | 152 | 2873 | yes | 0 / 0 |
| 4 | small | idle | 0 (ungated) | 156 | 3455 | yes | 0 / 0 |
| 7 | small | idle | 0 (ungated) | 257 | 5066 | yes | 0 / 0 |
| 7 | small | idle | 2 (gated) | **108** | 5225 | yes | **2 / 5** |

**Read against the three branches:** the stall grows with **N at fixed ctx**
(113 ms → 257 ms, ~2.3× from N=1 to N=7), and gating at the default cap lowers it
at the fatal width (**257 ms → 108 ms**, with 5 of 7 calls refused). The cap is
therefore a legitimate partial mitigation, not a no-op. The **ctx** and
**loaded-host** dimensions are NOT measured by this harness — a ~220 k-context
parent and a controlled host load cannot be synthesized in this container, so
the "stall scales with ctx rather than N → stop" branch is **untested, not
refuted**. The ctx dimension remains the first re-check if the mitigation proves
insufficient in the field.

**Cap choice (task 1.4):** default = `2` (`DEFAULT_MAX_CONCURRENT_SUBAGENTS`). It
is the only integer satisfying the spec property (defined, ≥ 2, < 3) and it sits
below every census fatal width (3, 4, 7), so no observed batch is admitted
unchanged. The measurement above covers the chosen value directly (`gated 7 @ cap
2`).

**Mitigation delta (#P4, task 8.2):** at the fatal width, ungated
`eventLoopMaxMs` = **257 ms**, gated = **108 ms** — strictly lower, with the
refusal path exercised (2 admitted, 5 refused). The stall moved; the cap is
recorded here as a measured partial mitigation, not as a proven cure.

### Decision 2 — Bound in-flight concurrency, not the batch

The natural statement is "at most 3 per assistant message". It is not
implementable: the extension seam exposes no assistant message, no batch id and
no sibling count (Context table, rows 1–2). Any per-batch scheme would have to
infer batch boundaries from timers or idle gaps, which races with slow preflights
and either never resets (every later `Agent` call refused forever) or resets
mid-batch.

So the counter is **in-flight children in this session**: increment on admit,
decrement on that call's `tool_execution_end`. Increment happens at *admission*,
not at execution — siblings preflight before any of them runs, so a count keyed
on execution reads zero across an entire batch and admits all of it.

**The release channel is `tool_execution_end`, deliberately not `tool_result`.**
On abort, pi finalizes the call with an error result and `emitToolExecutionEnd`,
but skips `finalizeExecutedToolCall` — the only path that runs `afterToolCall`,
which is what produces the extension's `tool_result`. A counter released on
`tool_result` therefore never releases a cancelled child: one Esc during a
fan-out (routine, process survives) permanently pins the counter at the cap, and
the session then refuses every subsequent `Agent` call with a false "children
running" reason. Default-active (Decision 6) would ship that fail-closed mode to
every host. `tool_execution_end` fires on the normal, blocked and aborted paths
alike.

*Not* a justification: "a re-issue on the next turn would stack on still-running
children". pi awaits the whole tool batch before the turn ends
(`agent-loop.js:372`) and drains steering only at turn boundaries, so a later
assistant message cannot coexist with in-flight children from an earlier turn.
The in-flight counter is justified by the seam alone — batch identity is not
knowable — and the design should not lean on a platform behaviour that does not
exist.

*Alternative rejected:* a semaphore whose permits are released by finishing
children. Deadlocks — preflight is sequential and execution starts only after the
batch is preflighted, so a waiting handler waits on a child that cannot start
until it returns. The spec encodes "never wait" as a requirement, not a comment,
because it reads like an implementation detail and would be "simplified" back in.

### Decision 3 — Reject only; no staggering

An earlier shape admitted over-cap calls after a bounded delay, "to spread child
start cost". It cannot work: a delay inside preflight runs before any execution
begins, so the batch pays ΣD of latency and then still starts every admitted
child simultaneously. Pure cost, zero spreading. Removed — admission either
admits immediately or refuses.

### Decision 4 — Block, rather than rewrite, and never terminate

Blocking yields a real errored tool result carrying our reason (Context table,
row 3), which closes the card and reaches the model. The alternatives:

- Mutate the input to shrink the child's task — rejected: the input is a task
  prompt; the gate has no basis to rewrite what the parent asked for.
- Drop silently — rejected: no result means a permanently spinning card, the
  exact damage this session chain already suffers.

`terminate` is never set: refusal is "not now". The reason text directs re-issue
to *after* running children finish, so the model does not immediately resubmit
into a full cap and burn turns appending refusals to a transcript already at
~220 k.

### Decision 5 — Sample saturation privately, over a rolling window

`collectMetrics()` resets the event-loop histogram and CPU delta on every call
and is sampled only by the 15 s heartbeat. Calling it from admission would reset
the window mid-interval, so the heartbeat that recorded `eventLoopMaxMs=142942`
would under-report exactly the stall this change exists to detect — the gate
would corrupt its own evidence.

Admission therefore owns its **own** sampling state — a private event-loop-delay
monitor over a fixed **5 s** rolling window, plus its own CPU baseline — rather than
reading the telemetry monitor non-destructively. The window policy is part of the
decision, not an implementation detail: never resetting latches the cap at 1 after
one historical spike, and resetting per read makes the window the gap between two
preflight decisions (milliseconds), which reads clean on a saturated machine. 5 s
is chosen so a spike clears well inside one 15 s telemetry heartbeat. Hysteresis
— enter at the threshold, leave below 80 % of it — keeps consecutive decisions in
one batch agreeing.

**Naming.** This repo already ships `HostPressure` / `HOST_PRESSURE_*`
(`packages/shared/src/host-pressure.ts`) for a *bridge-silence* verdict — the
same phrase the proposal's own evidence table uses. The gate's inputs are
resource load, a different thing; they are named for saturation so the dashboard
does not end up with two unrelated "host pressure" concepts.

**Domains differ and must be stated.** `process.cpuUsage()` observes this process
only; `os.loadavg()` observes the machine. The observed deaths are machine-level
saturation caused by many sessions, where a parent's own CPU can read low. A
threshold set on the wrong domain silently never fires. A non-destructive read of the shared histogram is still wrong:
that histogram is reset every 15 s by the heartbeat, so the gate would see a
window of 0–15 s depending on phase, reading near-zero on a saturated host right
after a reset and flapping the effective cap on the telemetry period. The other
alternative — reuse the last heartbeat snapshot — is up to 15 s stale and exists
only while the bridge connection is up. Both are rejected.

**Accepted limit:** a fresh session's *first* fan-out on an idle host shows no
pressure, so pressure contributes nothing there. That case is covered by the
static cap alone, which is precisely why Decision 1 requires the default cap to
be chosen against the fatal widths rather than left to the pressure path.

### Decision 6 — Fail open, and default active

Two polarity decisions that are easy to get backwards:

- **On error, admit.** A throwing handler propagates out of the tool-call path
  (an `Error` verbatim, a non-`Error` wrapped as "Extension failed, blocking
  execution") and the call is turned into an error result — so a gate defect
  would refuse every `Agent` call in the session, strictly worse than the crash.
  Every path is wrapped; failure admits.
- **Absent configuration means active at the default cap**, not disabled. The
  opt-out is an explicit disabling value, and it is named rather than implied:
  `maxConcurrentSubagents: 0` disables. A negative or non-numeric value is
  malformed, and malformed fails open (admit) rather than disabling silently.
  The default is fixed by Decision 1's measurement; the spec asserts it as a
  property (defined, ≥ 2, < 3) so the requirement survives the measurement
  rather than hard-coding a number the table has not yet justified.
  A mitigation that ships inert protects nothing until every host is
  hand-configured.

### Decision 8 — Register the gate after the bridge's own `tool_call` forwarder

`runner.emitToolCall` returns on the **first** handler that answers
`{block:true}`, skipping every later `tool_call` handler
(`dist/core/extensions/runner.js:745-762`). The bridge already registers a
pass-through `tool_call` forwarder; if the gate ran first, a refused call's
`tool_call` would never reach the dashboard while its `tool_execution_end` would
— live UI and transcript would disagree. Registration order is therefore a
constraint, not an implementation detail.

Related, same seam: a blocked call **does** emit `tool_execution_end`. The
release must therefore be keyed to the set of `toolCallId`s this gate actually
admitted, not to `toolName === "Agent"` — otherwise a refusal decrements a
permit it never took and the count drifts below reality mid-batch.

### Decision 7 — Record decisions where a dead process cannot erase them

Counters on the live telemetry frame are not enough: the failure ends with the
process gone, so decisions carried only by that channel vanish in the one case
that matters. Refusals are therefore also written as a custom session entry via
the extension `appendEntry` API under customType `subagent-admission-refused`,
which lands in the session's durable record and survives an unclean death. The telemetry counters remain as the live view.

**This is not a private write.** `packages/extension/src/custom-entry-forward.ts`
forwards every `entry_appended` custom entry to the dashboard as a `custom_entry`
protocol event, which the browser renders. Refusal entries therefore become a UI
surface whether or not one is designed — so the entry's `customType` and payload
are part of this change's contract, and the client side is in scope for review
even though no client code changes.

Only **refusals** are written. A refusal is rare and interesting; an admission is
the hot path, and a durable write per admission would put filesystem I/O in front
of every subagent start on a host that is already struggling.

## Risks / Trade-offs

- **The cap treats the symptom, not the cause** → Decision 1's table is published
  here; if ctx dominates, the change is re-targeted rather than shipped as a fix.
- **Refusals change agent behaviour** → the reason is written for a model reader
  (in-flight count + "after they finish"), and the recorded counts make the
  refusal rate visible. A high rate at the default cap means the default is
  wrong, and the record will say so.
- **Deadlock if Decision 2's "never wait" is violated by a later edit** → spec
  requirement plus a regression test that asserts no child state is consulted.
- **Per-session scope lets two sessions co-load a host** → accepted; every
  observed death is a single-session fan-out. Cross-session admission would put a
  network round trip in front of every `Agent` call.
- **Rollback depends on reaching the session** → the disabling value is read by
  the extension, so a reload or a session restart applies it; on a host already
  wedged, restart is the reliable path. Noted rather than solved.
- **A permit leaks if the release signal is missed** → the decrement is keyed on
  `tool_execution_end`, which pi emits on the normal, blocked and aborted paths;
  the only unreleased case is process death, which ends the session anyway. This
  is the first thing to re-check in review: an "equivalent" refactor onto
  `tool_result` silently reintroduces the cancellation leak.

## Migration Plan

Ships active at the default cap, disableable by an explicit configuration value.
Rollback is a config edit plus a reload or session restart — no rebuild, no data
migration. Lands after `heal-orphaned-tool-cards-on-session-end` so any child
dying while the cap is tuned still closes its card.

## Open Questions

- Should the default cap differ by host size (core count / memory) rather than
  being a single constant? Deferrable: a single conservative constant from
  Decision 1's table is shippable, and per-host scaling needs field data the
  recorded counters will produce.
