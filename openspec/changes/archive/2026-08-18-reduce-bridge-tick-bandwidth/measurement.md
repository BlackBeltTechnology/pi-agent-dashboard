# D1 Measurement — reduce-bridge-tick-bandwidth

> **SUPERSEDED 2026-08-18.** The original 0.36 fps result below the fold was a
> **dead-subagent artifact**, not the carrier's rate. Root-caused live in the
> docker harness (see "Re-measurement" first; the original is kept for the
> record). The 2.2 STOP gate does **not** fire; the design premise is
> **validated**.

## Re-measurement (2026-08-18) — the carrier IS high-rate; gate does NOT fire

The faux subagent used to produce the D1 numbers was **never running its
workload**. Its `Explore.md` frontmatter is `model: "@fast"`, and in the harness
`@fast` does **not** resolve to the key-free faux model — it falls back to pi's
credential-less anthropic default `claude-opus-4-8`, so the inner subagent emits
`entries:[], turnCount:1, "(no output)"` and **dies in ~400 ms**. The 9 frames
measured were `(running…)` placeholder ticks of a dying subagent; averaging them
over the 25 s window produced the spurious 0.36 fps.

Proven at two independent points, both reproducing the original burst exactly:

- **Bare `pi --print --mode json`** in the container → inner subagent
  `modelName:"claude-opus-4-8"`, `turnCount:1`, `"(no output)"`, 9 ticks in
  ~200 ms.
- **Real dashboard-spawned session** (parent `model=faux/faux-1`, bridge +
  `model:resolve` handler loaded), driven over `/ws` `spawn_session` +
  `send_prompt` → identical `claude-opus-4-8`, 9 Agent ticks, dead.

When the subagent is forced onto the faux model with a **literal**
`model: "faux/faux-1"` in the Agent tool-call args (the fixture fix), it runs
faux and the real rate appears:

| run | subagent model | Agent ticks | span | **rate** | bytes/s |
|---|---|---|---|---|---|
| dead subagent (original) | `claude-opus-4-8` (fallback) | 9 (`running…` placeholders) | ~200 ms then death | **0.36 fps** (9 ÷ 25 s window — the artifact) | ~350 |
| **real faux subagent** | `faux/faux-1` (literal) | **33** | 997 ms | **~32 fps** | ~26 000 |

**Measured live Agent-tick rate is ~32 fps — ~16× the 2 Hz kill-switch
threshold.** `design.md` §Context's premise ("this carrier's rate is the
subagent's raw session-event rate") is **confirmed**: `pushUpdate("running")`
(`pi-dashboard-subagents@0.2.4 agent.ts:1182`) fires once per inner session
event, unconditionally. A live subagent streams ticks at the inner session's
event rate. **The throttle is justified.** Task 2.2's STOP branch was triggered
by an instrument error, not by the carrier.

### What still blocks the L3 rows (F1/P1/P3/P4/F5)

Two harness-fixture bugs, neither about the carrier premise:

1. **Model resolution (fixed).** `@fast` → `claude-opus-4-8`. Fix: literal
   `model: "faux/faux-1"` in the subagent Agent tool calls (proven).
2. **Nested-subagent faux scripting (open, deep).** Even on the faux model, the
   inner `createAgentSession` truncates at ~2 turns / ~1 s: the faux scenario
   **router only ever fires for the PARENT session** (confirmed by file-logging
   the router — it logs `id=subagent-streaming` at stepIndex 0/1, never
   `subagent-streaming-inner`). The inner session's faux stream does not consume
   the parent's scripted response queue. `pi-dashboard-subagents` bundles its
   **own** `@earendil-works/pi-ai` copy; the extension registers the scripted
   provider into the copy IT imports, and the nested session resolves a
   different faux core with an empty queue → `"No more faux responses queued"` →
   the subagent produces only placeholders and completes. No existing harness
   test has ever driven a sustained nested-subagent Agent-tick stream (the parent
   change's F4 passed on non-Agent frames / the elapsed counter, as `design.md`
   D6 warned).

So the ≥ 10 s sustained faux subagent the test-plan assumes is **not
constructible** via nested faux — the reason is nested-faux infrastructure, not
the carrier.

### Resolution — synthetic Agent-tick producer (2026-08-18)

Because the bridge throttle keys ONLY on `toolName === "Agent"` +
`partialResult.details.agentId` (not on how a frame was produced), the ≥ 10 s
stream is driven by a **synthetic** `Agent` tool instead of a nested subagent:
`qa/fixtures/faux-agent-ticks.ext.ts` streams `tool_execution_update` frames at a
fixed cadence via a `[[ticks:<count>@<intervalMs>]]` sentinel. It shadows the
real `Agent` tool (first-registration-wins) and is loaded ONLY in the throttle
harness (gated by `PI_SYNTH_AGENT_TICKS=1`, registered instead of the subagents
producer). Scenarios: `synthetic-agent-ticks` (240 @ 50 ms ≈ 12 s of 20 fps) and
`synthetic-agent-ticks-quiet` (a > 2 s gap before tick 30, for F5).

Proven end-to-end on the docker harness — fresh sessions, browser `/ws`,
AgentDetails filtered by `toolName === "Agent"` + `details.modelName ===
"synthetic-ticks"`:

| `subagentTickThrottleMs` | source | /ws Agent ticks | window | rate |
|---|---|---|---|---|
| **0 (OFF)** | 240 @ 50 ms | 240 | 12.0 s | **19.6 fps** |
| **500 (ON)** | 240 @ 50 ms | 25 | 12.0 s | **2.00 fps** |

The raw frame matches the throttle predicate exactly
(`data.toolName:"Agent"`, `data.partialResult.details.agentId:"<uuid>"`). The
throttle coalesces the 20 fps source ~10× to exactly the 2 Hz design target,
with no nested faux subagent — a deterministic substrate the L3 cadence rows
(F1/P1/P2/P3/P4/F5) can assert against. **This makes the ≥ 10 s L3 fixture
constructible.**

---

## ORIGINAL (superseded — dead-subagent artifact)

Date: 2026-08-17 · Harness: `docker/test-up.sh`, port `18170`.

| run | `subagentTickThrottleMs` | fixture | window | Agent frames | Agent frames/s |
|---|---|---|---|---|---|
| OFF-streaming | 0 | `subagent-streaming` | 25.4 s | 9 | 0.35 |
| OFF-sustained-long | 0 | `subagent-sustained-long` | 25.1 s | 9 | 0.36 |
| ON-streaming | 500 | `subagent-streaming` | 25.1 s | 1 | 0.04 |

The inter-arrival "burst then silence" reading below was the death of a
`claude-opus-4-8` subagent, not the shape of a live carrier:

```text
streaming        : [0, 0, 0, 0, 1, 2, 4, 257]
sustained-long   : [0, 0, 0, 0, 1, 5, 5, 244]
```

The original conclusion ("carrier premise falsified; the win is ~350 B/s") is
**withdrawn** — it measured a subagent that never ran.
