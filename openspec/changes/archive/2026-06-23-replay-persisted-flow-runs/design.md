## Context

pi-flows (`persist-flow-runs`) now writes each flow-run lifecycle event to the parent session JSONL via `pi.appendEntry("flow-event", record)`. The record shape (`FlowEventRecord`) is the cross-repo contract: `{ seq, eventType, data, flowRunId }`, where `eventType` is already the dashboard protocol name (post-`FLOW_EVENT_MAP`).

Today the dashboard's `replayEntriesAsEvents` (`packages/shared/src/state-replay.ts`) synthesizes events only for `entry.type === "message"` and `"model_change"`; `type:"custom"` entries are silently dropped. So persisted flow events never re-enter the event stream on reload, and the client's idempotent `reduceFlowEvent` rebuilds nothing → flow card gone after `/resume`, refresh, or server restart.

The client is already replay-shaped: `useFlowsSessionState` folds `useSessionEvents(sessionId)` with idempotent reducers, so replaying the same events rebuilds the identical card. Only the replay branch (+ one bridge map entry + one reducer case) is missing.

## Goals / Non-Goals

**Goals:**
- A flow run survives `/resume`, browser refresh, and dashboard server restart, rebuilding the full per-agent timeline (text, thinking, tool calls + results, errors).
- Reuse the existing live fold — zero new reducer cases for existing timeline kinds.
- Close the pre-existing error-timeline gap: `flow_agent_error` gains a live map entry and a reducer producer case.
- Keep the dashboard independent of pi-flows (duck-type the record; no import).

**Non-Goals:**
- Resuming an interrupted flow's *execution*. In-memory agent sessions are gone on process death; we replay the *record*, not live agent state.
- Server-side `stateStore` wiring (RAM-only, lost on restart). Cards render from the client event-stream fold.
- Changing the live event path. Persistence is additive; the ephemeral forward stays.

## Decisions

### Decision 1: Add a replay branch, not a snapshot restore
Re-forward each persisted `flow-event` as `event_forward{eventType, data}` and let the existing `reduceFlowEvent` fold it. Alternative — persist/restore a `FlowState` snapshot — was rejected (pi-flows side, mirrored here): it would need a second `FlowState` producer and a `flow_state_restore` reducer case, drifting from the live fold and risking "tool-calls-only" regressions when new kinds are added. Replaying the event list means replay == live by construction.

### Decision 2: Order by `seq`, duck-type the record
Sort collected flow-event records by ascending `seq` before emitting. File order already matches `seq` (append-only), but parallel agents emit concurrently, so sort defensively. The record is duck-typed as `{ seq, eventType, data, flowRunId }` — no import from pi-flows keeps the repos independent (precedent: cross-repo delegation brief).

### Decision 3: `eventType` is re-forwarded verbatim — no second map
pi-flows persists the *already-mapped* protocol name (`flow_tool_call`, not `flow:subagent-tool-call`). The replay branch emits `{ eventType, data }` as-is; no second mapping table on the dashboard side.

### Decision 4: `flow_agent_error` gets both a live map entry and a reducer case
pi-flows now emits `flow:agent-error { agentName, stepId, text }`. Add `FLOW_EVENT_MAP["flow:agent-error"] = "flow_agent_error"` so the live path forwards it (not only replay), and add a reducer case appending `{ kind: "error", text }` to the agent's `detailHistory`. The `error` variant of `FlowDetailEntry` already exists and is already rendered by `FlowAgentDetail`/`FlowArchitect`; only the producer case is missing. Status stays owned by `flow_agent_complete`.

### Decision 5: Client replay must feed the plugin event-store (not only the shell reducer)
Server-side `replayEntriesAsEvents` (Decision 1) is half the pipeline. The flow card (`FlowDashboardClaim`) has no `shouldRender` gate — it self-gates on `flowState`, derived solely from `useSessionEvents` → `reduceFlowsSessionState`. That hook reads the plugin-runtime per-session event store, fed by `publishSessionEvent`. The client live `event` handler calls `publishSessionEvent` per event; the `event_replay` handler did NOT — it only folded the batch into the shell's `sessionStates`. So on cold load the plugin store was empty → `flowState` null → the slot never reattached.

**Guide: subagent cards.** Subagent cards replay correctly because their state lives in the SHELL reducer (`SessionState.subagents`), which the `event_replay` loop already rebuilds; `App.tsx` reads `sessionStates.get(sid).subagents`. Flows deliberately moved state OUT of the shell into the plugin (`pluginize-flows-via-registry`), leaving the replay-covered store. The fix restores parity: `event_replay` mirrors the batch into the plugin store too — `clearSessionEvents` when the shell's `shouldReset` fires, then `publishSessionEvents` (plural). Reusing the same `shouldReset` keeps the plugin store 1:1 with `sessionStates` (no dedup divergence). This fixes every `useSessionEvents` consumer (flows, goal-plugin), not only flows.

No dashboard client persistence/rehydration API exists today; the only rehydration contract is "re-derive from the replayed event stream via `useSessionEvents`" — which this decision finally makes work on cold load. (A richer server-driven path exists but is unused by flows: `ServerPluginContext.onEvent` + `intentStore` replay-on-subscribe — the deferred `adopt-server-driven-intent-rendering`.)

## Risks / Trade-offs

- **Plugin-store delivery cost is bounded by the shell's existing replay.** `publishSessionEvent` appends via `[...current, event]` (O(N) per call); the live path already pays this cumulatively, and the shell's `event_replay` reduce loop already does O(N²) message-array spreads over the same N events on every cold load. The replay mirror adds one more O(N) pass strictly smaller than that existing loop. → Mitigate with plural `publishSessionEvents` (one spread, one `notify`) so cold-load delivery is O(N) + one subscriber notification, not N. Not a new bottleneck.
- **Dedup on re-replay.** `publishSessionEvent` does not dedup; a re-replay sweep would double events if the store were not cleared. → Gate `clearSessionEvents` on the SAME `shouldReset` the shell uses; the plugin store then inherits the shell's hardened pagination/re-replay semantics.
- **Plugin store retains the full backlog on cold load** (previously empty until live events), with no eviction (unlike the server's 5000/session cap). Roughly doubles per-session event retention (shell `SessionState` + plugin `events[]`). → Acceptable short-term; mirror an eviction cap as follow-up.
- **Actions subcard stays gated separately.** `SessionFlowActionsClaim` visibility depends on `shouldRenderFlowsSubcard` → `getFlowsAvailabilitySync`, fed only by live `flows_list`/`commands_list` (`publishSessionData`), which is NOT replayed and closed-by-default. The running-flow card reattaches without it; the buttons subcard needs availability rehydration. → Tracked as follow-up (task 5.5).
- **Durability is best-effort (timing gap).** pi's `_persist` buffers entries in memory until the parent session's first assistant message, then bulk-flushes; thereafter appends are synchronous. A session killed mid-flow *before* that first flush loses the unwritten flow events. → Accept: matches pi's own session-durability semantics; normal completion persists. Not a dashboard-side defect.
- **Concurrent appends to one JSONL.** Validated safe: the parent `SessionManager` is the single writer; the append path (`appendCustomEntry → _appendEntry → _persist → appendFileSync`) is fully synchronous, so Node run-to-completion serializes every append — no interleave, no torn lines reachable via concurrent append. → No mitigation needed.
- **Torn trailing line on crash mid-append.** The loader (`loadEntriesFromFile`) parses per-line in try/catch and skips malformed lines, so at most one trailing entry is lost. (Header corruption would discard the session, but the header is written once at creation and is unreachable via flow-event appends.) → Replay branch additionally guards malformed records.
- **JSONL growth (one entry per event).** Custom entries are not in LLM context; pi-flows reserved a Decision-4 collapse hatch (`flowRunId`) if volume ever bites. → Out of scope here.

## Migration Plan

- Pure additive code change across three files; no protocol, dependency, or data-model change; no client component change.
- Lands independently of pi-flows, any order: this branch is harmless without persisted entries (nothing to replay); persisted entries are harmless without this branch (inert custom entries). Reload survival becomes user-visible once both ship.
- Rollback: revert the three edits; persisted `flow-event` entries become inert again (no read path), sessions still load normally.

## Open Questions

- Whether flow telemetry belongs in the conversation entry DAG (vs a side channel) is a pi-flows producer-side design preference, not a dashboard concern.

## KNOWN BLOCKER — upstream flush gate (validated 2026-06-22)

Reload survival is blocked end-to-end by pi-core, NOT by this change. Root cause: `SessionManager._persist` gates the session-file flush on `hasAssistant` — the first `role:"assistant"` message in the PARENT session. Until then it buffers ALL entries (including `type:"custom"` `flow-event` records) in RAM and creates no `.jsonl`. Flow-first sessions therefore have no file; reload before the first assistant message → this replay (and the graph + timeline it rebuilds) finds nothing.

### Evidence

1. **Controlled experiment (isolated `SessionManager`).** `appendMessage({role:"user"})` + 3× `appendCustomEntry("flow-event", …)` → no `.jsonl`; the file appears with the whole buffer only after the first `appendMessage({role:"assistant"})`.
2. **Real-world trace — session `019eeecc`.** Initially `.meta.json` only (no `.jsonl`) while the parent had not yet replied. After the parent took a turn, the file appeared with **184 `flow-event` entries**: first flow-event at line 5, first assistant message at line 190 — i.e. the events sat in RAM from line 5 and the line-190 assistant message flushed all of them at once. Replaying that real file through the shipped `replayEntriesAsEvents` reconstructs the full `flow_*` stream (incl. `flow_started`/graph steps and the new `flow_agent_error`). The branch is correct against real persisted data; only the timing of the flush is the gap.

### Manual / programmatic flush triggers (all rejected)

The flush gate inspects ONLY `entry.type === "message" && entry.message.role === "assistant"` — content is never checked. Investigated whether anything reachable can open it without an upstream change:

- **`ctx.sessionManager`** is `ReadonlySessionManager` — no `appendMessage`, `_rewriteFile`, or flush. ❌
- **`appendEntry`** writes `type:"custom"` — never opens the gate. ❌
- **`sendMessage`** writes `type:"custom_message"` (wrong type) — never opens the gate. ❌
- **`sendUserMessage`** writes a `user` message (wrong role). ❌
- **Empty / sentinel-character assistant message** *would* open the gate (content is irrelevant to the check), BUT pi-flows cannot write a raw assistant message via any public API, AND `buildSessionContext`'s `appendMessage` pushes every `type:"message"` entry verbatim with NO empty-content filter (grep of the agent loop + pi-ai found no `pruneEmpty`/`sanitize` before the provider call). So an empty/sentinel assistant message reaches the provider as-is → empty-content turns are commonly rejected (Anthropic/OpenAI require non-empty content) and risk alternation errors on the next real turn. ❌
- **`sendMessage({triggerTurn:true})`** forces a real billed parent LLM turn whose content is the model's, not a sentinel — wasteful, slow, pollutes the transcript. ❌

Faux-agent test (real `SessionManager`, no LLM) confirmed both halves: an empty assistant message (`content:[]`) flushes the whole buffer to disk AND appears as the last message in `buildSessionContext().messages` (sent to the provider), while the `flow-event` custom entries are excluded from context. The only entry kind that is structurally invisible to the LLM (no `appendMessage` branch for `type:"custom"`) is a custom entry — but a custom entry does not flush today.

### Recommended upstream fix

The clean fix is the opt-in **custom flush-marker**: change `SessionManager._persist` so appending a `type:"custom"` entry carrying a `flush:true` flag (or a dedicated marker `customType`) forces file creation + buffer write WITHOUT requiring an assistant message. This is invisible to LLM context by construction (`buildSessionContext` skips `type:"custom"`), already writable from pi-flows via `appendEntry`, opt-in (preserves the gate's reason — no empty files for trivial sessions), and works mid-flow. The blanket variant (flush all custom entries immediately) is the same one-method change but non-opt-in. Either lives in `@earendil-works/pi-coding-agent`; the ExtensionAPI exposes no flush surface today, so neither pi-flows nor the dashboard can close it. This change's 3 edits are correct and remain — necessary-not-sufficient, activating the moment the upstream flush lands. See the `on-demand-session-replay` delta requirement "Durable replay depends on upstream flush of custom entries (KNOWN BLOCKER)".
