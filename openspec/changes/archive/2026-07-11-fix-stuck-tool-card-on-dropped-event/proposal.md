## Why

A tool card can stay stuck showing `Reading…` (running spinner) indefinitely while
the session keeps rendering later cards normally — the agent already finished the
tool, but its terminal `tool_execution_end` event never reached the browser.

That the tool *did* finish is evidenced by a **later assistant turn existing in the
transcript**: the model cannot emit a new turn until every prior tool result returns
(true even when tool calls run in parallel). So the card is stale, not the agent.

The transport is `pi → bridge → server (MemoryEventStore, seq-numbered) → WS fanout
→ browser`. Three distinct weaknesses let a terminal event go missing and stay missing:

1. **Silent drop, server→browser (`browser-gateway.ts`) — the recoverable case.**
   `fanout()` / `sendTo()` drop a frame when `ws.bufferedAmount > MAX_WS_BUFFER`
   (4 MB) via a bare `continue` / `return` — no retry, no log, socket stays `OPEN`.
   Event-loop stalls (the `openspec-poll` "slow tick" telemetry shows **1 473 genuine
   5–60 s stalls** in one log) plus remote-tunnel latency keep the send buffer from
   draining, crossing the cap. **The event WAS recorded in the store** (seq assigned on
   ingest), so it is recoverable from the server.

2. **Silent drop, bridge→server (`connection.ts`) — rare, already self-healing.**
   While the WS is not `OPEN`, outgoing events buffer in a bounded ring
   (`maxBufferSize = 10000`); on overflow `buffer.shift()` evicts the oldest. Also
   unlogged. **The event is never recorded** (seq is assigned server-side, on ingest —
   `memory-event-store.ts` `nextSeq++`), so it leaves no seq gap and is invisible to
   any seq-based heal. It is already recovered by the existing `replaySessionEntries()`
   full re-sync on bridge reconnect. This change only makes it *observable*.

3. **The client never notices a missing event.** The client advances `maxSeqMap` to the
   maximum seq seen with no gap detection, so a dropped seq is skipped. A browser page
   *reload* does NOT recover it: the client rehydrates from its durable replay cache
   (`reduce-session-replay-traffic`) and delta-subscribes with `lastSeq =
   persistedMaxSeq`, so the older-seq dropped event is never re-sent. Only an in-app
   Refresh (`subscribe { lastSeq: 0 }` full replay) or a bridge reconnect re-sync
   (`session_state_reset` + replay from seq 1) re-reads the recorded terminal event.

Attribution of the observed incident to weakness #1 specifically is **inferential**
(from the stall telemetry), not proven — the instrumentation below is what will confirm
which hop drops. Regardless of cause, a stuck card should self-heal unconditionally.

## What Changes

Scope this change to the **minimal correct fix** — recover any terminal event the
server still holds, and make every drop observable. Both use channels independent of
the WS back-pressure that causes the drop.

- **Stale running-tool reconcile (client; primary fix).** A tool card left in `running`
  for > `STALE_TOOL_MS` with no `tool_execution_end` triggers a one-shot reconcile via
  the existing `GET /api/sessions/:sessionId/tool-result/:toolCallId` route. This is an
  **HTTP** path — independent of the WS send buffer — so it heals the exact condition
  (WS back-pressure) that dropped the event. Covers weakness #1 and any trailing drop.

- **Drop-site instrumentation (server + bridge).** Both silent drop points increment a
  counter and emit a rate-limited warning carrying `{ hop, sessionId, seq?,
  bufferedAmount }`, exposed on the diagnostics/health surface — so the next incident is
  attributable instead of invisible, and weakness #2 (bridge drop) is finally visible.

Deferred to a separate, evidence-gated follow-up (see design.md "Deferred"): a
contiguous client cursor + gap-triggered resync. It would lower heal latency for
weakness #1, but it only covers that one hop, changes cursor semantics, and its heal
(`event_replay`) rides the *same* back-pressure path that can re-drop it. Do it only if
instrumentation shows the reconcile latency is a real problem.

Non-goals: raising `MAX_WS_BUFFER`, removing the back-pressure guard (it protects server
memory), per-event acks.

## Capabilities

- `incremental-event-sync` (ADDED) — stale running-tool reconcile; per-hop dropped-frame
  delivery instrumentation.

## Follow-up

- The `Scenario: Evicted result cannot reconcile` limitation below (reconcile 404s, card
  left running) is removed by the follow-up change `fix-stuck-tool-card-superseded-heal`,
  which finalizes such a card once a later assistant inference proves the tool finished.
- **Archive order:** this base change MUST archive **together with, or immediately before**,
  `fix-stuck-tool-card-superseded-heal`. That change `MODIFIED`s this change's `Stale
  running-tool reconcile` requirement, so this change's ADD must land in `openspec/specs/`
  first. Archiving this change alone (with superseded-heal already shipped in code) would
  leave the spec asserting "leave the row running" while the running code heals it —
  a transient spec-vs-code contradiction. Do not archive this change in isolation.

## Discipline Skills

- `systematic-debugging` — reproduce the drop (server recorded, browser stuck) before fixing.
- `observability-instrumentation` — the drop-site counters/logging.
- `doubt-driven-review` — applied: caught the original overclaim that a seq-based heal
  covers the bridge→server drop (it cannot; seq is assigned after that hop).
