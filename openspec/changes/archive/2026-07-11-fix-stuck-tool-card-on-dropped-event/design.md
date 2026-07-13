## Context

Transport: `pi → bridge (ConnectionManager) → server (MemoryEventStore, seq-numbered
via `nextSeq++` on ingest) → WS fanout → browser (useMessageHandler reducer)`. `seq`
is assigned **server-side, on ingest** — after the bridge→server hop. The subscribe
protocol is already incremental (`subscribe { lastSeq }` → server replays `seq >
lastSeq`), and `session_state_reset` + stale-lastSeq detection handle server restarts.

This change must not regress the shipped delta-replay win
(`reduce-session-replay-traffic`, `on-demand-session-replay`) nor the
`suppress-live-events-during-paginated-replay` interleave guard.

## Where a terminal event can be lost, and what can recover it

| Drop point | Recorded in store? | Leaves a seq gap? | Recoverable by |
|---|---|---|---|
| B — server→browser (`fanout` back-pressure) | **yes** (seq assigned) | yes | this change's REST reconcile; in-app Refresh (`lastSeq:0`); bridge reconnect re-sync; (deferred) gap-resync — a browser *reload* alone delta-subscribes from the durable cache and does NOT recover it |
| A — bridge→server (`bufferMessage` head-drop) | **no** (never ingested) | **no** | only `replaySessionEntries()` on bridge reconnect (already exists) |

Key consequence (the doubt-review correction): a seq-based client heal is
**structurally blind to drop A** — no seq was ever assigned, so the client's stream
stays contiguous. And the REST route 404s for A (`findToolEndEvent` returns undefined).
So drop A is instrumentation-only here; it already self-heals on reconnect.

## Goals / Non-Goals

Goals: any terminal event the **server still holds** self-heals without a manual refresh;
every drop is counted + logged. Non-Goals: recovering an event that never reached the
store (drop A — already handled on reconnect); per-event acks; removing the 4 MB guard.

## Decisions

### D1 — Stale running-tool reconcile is the primary heal (HTTP, not WS)
A client timer: any `toolStatus:"running"` row with `now - startedAt > STALE_TOOL_MS`
and no terminal event → one-shot `GET /api/sessions/:sessionId/tool-result/:toolCallId`
(`session-routes.ts`, backed by `eventStore.findToolEndEvent`). On 200 → synthesize the
terminal update (flip complete/error, attach result). On 404 / "in flight" → keep the
row running and re-arm.

Rationale: the reconcile channel is **HTTP**, structurally independent of the WS send
buffer whose overflow caused the drop. So the heal cannot be re-dropped by the same
back-pressure. One mechanism covers weakness #1 and any trailing drop (where no later
event exists to reveal a gap). `STALE_TOOL_MS` is conservative (e.g. 20–30 s) so it never
races a legitimately slow tool, and reconcile only ever applies the **authoritative
server result** — it never invents a completion.

### D2 — Instrument both drop sites (do not silence them)
Server `fanout()`/`sendTo()`: on `bufferedAmount > MAX_WS_BUFFER`, before `continue`,
increment `droppedFrames{sessionId}` + `warnOncePerWindow({ hop:"server→browser",
sessionId, seq, bufferedAmount })`. Bridge `bufferMessage()`: on `buffer.shift()`,
increment + rate-limited warn `{ hop:"bridge→server", droppedType }`. Both counters on
the diagnostics/health payload. Logging is rate-limited (drops cluster during a stall).
This is what turns the inferential root-cause attribution into a measured one.

## Deferred (separate, evidence-gated follow-up)

**Contiguous cursor + gap-triggered resync.** Track a gap-free `contiguousSeq`, and on a
live `event` with `seq > contiguousSeq + 1` re-subscribe with `lastSeq: contiguousSeq`.
It would lower heal latency for drop B (no `STALE_TOOL_MS` wait). Deferred because:
- It covers **only** drop B (blind to A — see table).
- Its heal, the server's `event_replay`, rides the **same** `sendTo` back-pressure guard
  and can itself be dropped under a sustained stall → needs bounded retry / gap-closed
  verification, not just debounce.
- It changes cursor semantics and the durable-cache cursor (`session-replay-persistence`).

Ship it only if D2's telemetry shows the reconcile latency is a real problem. If pursued,
it MODIFIES `incremental-event-sync` "Client-side sequence tracking" and ADDs a
"Gap-triggered resync" requirement.

## Risks / Trade-offs

- **Reconcile false-positive on slow tools.** Mitigated by a conservative `STALE_TOOL_MS`
  and by only applying the server's authoritative result.
- **Evicted result (known limitation).** If the store evicted the end event (20 000-event
  overflow), the REST route 404s and the card stays stuck until an in-app Refresh
  (`lastSeq:0` full replay) or bridge reconnect re-sync (a browser *reload* alone
  delta-subscribes from the durable replay cache and does NOT recover it). Rare;
  documented, not silently handled. **Removed by follow-up**
  `fix-stuck-tool-card-superseded-heal`, which finalizes the card once a later assistant
  inference proves the tool completed — see "Interaction with other changes" below.
- **Reconcile poll cost.** One-shot per stale row (re-armed only on "in flight"); bounded.

## Interaction with other changes

`virtualize-chat-transcript-tanstack` unmounts off-screen transcript rows. The reconcile
timer (D1) MUST be session/state-scoped — scan `sessionState` for `toolStatus:"running"`
rows — and NEVER a per-row `useEffect`, or scrolling a stuck card off-screen would unmount
its component and cancel the heal. As written D1 is already session-scoped; keep it so.
(The streaming tail stays always-mounted there, so the common in-flight case is unaffected.)

`fix-stuck-tool-card-superseded-heal` (follow-up) `MODIFIED`s this change's `Stale
running-tool reconcile` requirement to delegate the evicted-result case to a supersede
heal. Because that is a `MODIFIED` of a requirement this change `ADD`s, this change MUST
archive together with, or immediately before, the follow-up — never in isolation (see
proposal.md "Follow-up").

## Migration

No protocol/schema change. Client adds a timer + REST call; server + bridge add two
counters. Nothing touches the seq/replay cursor semantics, so no cache migration.
