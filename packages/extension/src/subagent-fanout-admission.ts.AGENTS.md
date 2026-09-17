# subagent-fanout-admission.ts — index

Subagent fan-out admission — pure decision fn + stateful gate. Keeps a parent session alive through a wide `Agent` fan-out by bounding in-flight children, refusing the excess visibly/terminally.

Exports `decideAdmission` (in-flight count + resolved `AdmissionConfig` + `saturated` → `{action:"admit"}` | `{action:"refuse", cause:"cap"|"saturation", reason}`), `effectiveCap` (disabled/malformed/non-finite → `Infinity`; saturation → 1 never 0), `refusalReason`, `resolveAdmissionConfig` (absent → `DEFAULT_MAX_CONCURRENT_SUBAGENTS`; malformed → fail-open `Infinity`, NOT the `0` disable path), and class `FanoutAdmissionGate`.

Load-bearing invariants:
- Bound is IN-FLIGHT CONCURRENCY, not batch width — the extension `tool_call` event carries no assistant message, so batch size is unknowable; the count rises at ADMISSION (siblings preflight before any executes).
- Permits are `toolCallId`s added on admit, removed on `tool_execution_end` — NEVER `tool_result`; an aborted call (Esc) skips the path that emits `tool_result`, so releasing there leaks a permit forever.
- Synchronous, reject-only, never awaits/delays a child (preflight is sequential, so awaiting deadlocks).
- Fail-open on any throw; never sets `terminate` (refusal is "not now").
- Counters `fanoutAdmitted`/`fanoutRefused`/`fanoutSaturationRefused`; refusals call `recordRefusal` (durable write) only.

Wired in `bridge.ts` AFTER the pass-through `tool_call` forwarder (first `{block:true}` handler wins, so order matters — D8). Registered alongside `subagent-saturation.ts` (sampler) and a `pi.appendEntry("subagent-admission-refused", …)` recorder. See change: bound-subagent-fanout-under-host-pressure.
