## Context

`memory-event-store.ts` bounds memory with three policies today: a per-string
truncation pass, a per-event serialized-size ceiling, a per-session event-count
trim, and an LRU session eviction. All four are **size-of-one** or
**count-of-many** policies. None of them bounds *bytes across many events*, which
is the axis `tool_execution_update` grows on.

The measured shape (see `proposal.md`): a single `Agent` tool call emits ~250 ms
ticks, each carrying the cumulative subagent timeline (~187 KB), and the buffer
retains all of them.

## Goals / Non-Goals

**Goals**
- Retain exactly one `tool_execution_update` per `toolCallId` per session buffer.
- Zero change to what subscribers receive live.
- Zero change to replayed client state (`replay(u₁…uₙ) ≡ replay(uₙ)`).
- Make the shed path observable.

**Non-Goals**
- Reducing WebSocket bandwidth or client-side memory (bridge-side; separate).
- Changing any existing cap value.
- Changing the subagent-timeline truncation carve-out itself.

## Decisions

### D1 — Collapse at retention, inside `insertEvent`

`insertEvent` is the single choke point that **all five** event ingresses funnel
through:

| Ingress | Call site |
|---|---|
| Live pi events (bridge) | `event-wiring.ts:717` |
| JSONL cold hydration | `subscription-handler.ts:327` |
| Session actions | `session-action-handler.ts:83` |
| Terminal events | `terminal-handler.ts:35`, `:86` |
| Async attachment resolve | `attachment-resolver.ts:47` |

A policy enforced there holds regardless of ingress. Today only the bridge emits
`tool_execution_update` (the JSONL parser synthesizes only
`tool_execution_start` / `_end` / `message_*` / `turn_end` — verified), but a
retention invariant that does not depend on that staying true is worth more than
one that does.

**Alternative rejected — bridge-side suppression.** At send time the successor
does not exist yet, so the bridge cannot tell a needed live tick from a
soon-to-be-superseded one. Suppression there necessarily degrades the streaming
view. It also cannot cover the four non-bridge ingresses. Bandwidth reduction
remains a legitimate but separate change with a real UX trade to weigh.

### D2 — Broadcast is unaffected, by construction

```js
const seq = eventStore.insertEvent(sessionId, prepared.event);
if (!replayingSessions.has(sessionId)) {
  const storedEvent = eventStore.getEvent(sessionId, seq) ?? prepared.event;
  browserGateway.broadcastEvent(sessionId, seq, storedEvent);
}
```

Broadcast re-reads by `seq` after insertion. Collapse only removes *earlier*
entries, so the just-inserted event is always present; the `?? prepared.event`
fallback is a second layer. No broadcast-path change is required, and none
should be made.

### D3 — Keep the newest update per `toolCallId`, even after `tool_execution_end`

The tempting stronger rule ("once `_end` arrives, drop all updates for that
call") is **wrong for live events**. From the reducer's `tool_execution_end`
branch:

```js
// For live events (no endDetails), update existing toolDetails.status
if (endDetails) { mergedDetails = endDetails; }
else { /* mutate the EXISTING toolDetails */ }
```

A live end carries no `details`; it depends on the `toolDetails` the final update
wrote. Only `state-replay.ts` synthesizes `details` onto the end event. Dropping
the last update therefore blanks completed subagent cards after a refresh.

Retention is thus **one update per `toolCallId`**, not zero-after-end.

### D4 — Seq gaps are already legal; the newest event is not droppable

The sync protocol is watermark-based: `getEvents(sessionId, lastSeq + 1)` is a
range query and the client tracks `maxSeq`. There is no `expectedSeq` or
contiguity assertion anywhere in server or client. `trimBufferToLimit` already
produces gaps (at the head); this change produces them mid-buffer, which the
protocol treats identically.

One invariant must hold explicitly: **the buffer's highest-seq event is never
dropped**, because `getMaxSeq` feeds the stale-`lastSeq` reset branch in
`handleSubscribe`. Keeping the newest update per `toolCallId` satisfies this
naturally — a collapsed predecessor is by definition not the newest — but it is
stated so a future refactor cannot quietly violate it.

### D5 — Key on `toolCallId`; absent key ⇒ retain

Collapse is keyed strictly on `data.toolCallId`. An update without one cannot be
proven superseded and SHALL be retained unconditionally. Fail-open: an
unrecognised shape costs memory, never correctness.

### D6 — O(1) per insert

Maintain a per-buffer `Map<toolCallId, index>` (or store the retained update's
`seq` and splice on replacement) so collapse does not add an O(n) scan per
insert. This mirrors the hysteresis reasoning behind `TRIM_SLACK`: the store's
insert path is hot and must stay amortized O(1). The map entry is dropped with
its buffer on LRU evict / delete, so it cannot accumulate across sessions.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| A future client change starts accumulating across updates instead of assigning | Spec scenario asserts equivalence of `replay(u₁…uₙ)` and `replay(uₙ)`; it fails if accumulation is introduced |
| Dropping the last update blanks completed subagent cards (D3) | Explicit scenario: live `_end` with no `details` after collapse still renders the timeline |
| `getMaxSeq` regression via mid-buffer deletion (D4) | Explicit scenario asserting the newest event survives collapse |
| Collapse makes the hot insert path O(n) | D6 index; a bulk-insert test asserts linear total work |
| The counter is added but never fires, hiding a no-op fix | Verification requires a non-zero `collapsedUpdates` on a real subagent run, not just unit tests |

## Migration

None. Retention-only, no persisted format change, no wire-protocol change, no
config change. Effect appears at the next server start.
