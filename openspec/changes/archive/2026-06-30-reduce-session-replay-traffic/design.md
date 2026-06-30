## Context

The dashboard streams session activity as seq-numbered events held in a bounded
in-memory buffer (`memory-event-store.ts`: 100 sessions LRU, 5000 events/session,
4 KB/string truncation). Subscribe is already incremental via
`subscribe { sessionId, lastSeq }` → `eventStore.getEvents(sessionId, lastSeq+1)`,
with a `session_state_reset` fallback when the client's `lastSeq` exceeds the
server's `maxSeq` (server restarted, seq reset to 1). The client holds the cursor
in `maxSeqMapRef` (in-memory) and the reduced chat in `sessionStates` (in-memory).

Observed problem (confirmed with maintainer): a **page reload** discards both
in-memory structures, so the client resubscribes with `lastSeq: 0` and the server
re-ships the whole buffered history. WS reconnect does NOT have this problem — it
re-reads the live cursor (`App.tsx:757`). So the fix is durability across reload,
not a new protocol.

A second, orthogonal cost: large tool outputs are shipped eagerly during replay
yet truncated to 4 KB, so the user pays bytes for collapsed bodies and still can
never see a result larger than 4 KB.

## Goals

- A reload of an already-seen session triggers a **delta** replay (tail only),
  not a full replay.
- The persisted cache is provably safe: any miss, reset, or version mismatch
  degrades to today's full replay with no stale-history rendering.
- Optionally: expanding a collapsed tool result reveals the **full untruncated**
  body, fetched on demand.

## Non-Goals

- No change to the security model, the in-memory truncation policy, or the
  bounded buffer caps.
- No new subscribe wire contract for Strategy A — `lastSeq` + `session_state_reset`
  are reused verbatim.
- Strategy B as a *pure bandwidth* optimization (re-fetching the same 4 KB the
  client already had). Explicitly dropped — the round-trip + offline-expand
  regression is a worse trade than Strategy A, which already removes the bytes.
- The live-event firehose (`process_metrics`, cross-cwd `openspec_update`,
  `git_info_update`). Different traffic class; tracked separately.

## Decisions

### Reuse the seq cursor; do not invent a message-ID cache
The server's per-session `seq` already encodes "what does the client have" in one
monotonic number, and the delta + reset machinery is built and tested. A
parallel "fetch message IDs then fetch missing batch" protocol would add a second
round-trip and a fork-safety correctness surface (per-message fork mutates the
suffix while prefix `entryId`s stay identical) for no gain over the cursor. The
cache key is `sessionId`; the durable cursor is `maxSeq`.

### IndexedDB, not localStorage
Chat history exceeds the ~5 MB synchronous localStorage budget. IndexedDB is
async, large, and structured. The browser may evict it under pressure — which is
fine: the cache is an optimization, a miss falls back to `lastSeq: 0`.

### Cache is provisional until the first delta batch confirms
On load, render the rehydrated `sessionStates` immediately (fast paint), but treat
it as provisional. The existing `event_replay` reset rule (`firstSeq <= maxSeq` →
rebuild) reconciles it. If the server sends `session_state_reset` (seq reset) or a
delta whose `firstSeq` contradicts the cursor, purge and rebuild. This guards
against fork/branch/edit drift that happened while the page was closed.

### Active-session prioritization is subsumed by cache-paint (prefetch dropped)
On reload the client lands on `/session/:id` — typically the active session the
user was watching. Strategy A paints that session instantly from IndexedDB +
delta-subscribes only its tail, so the session the user cares about is exactly
the one prioritized; idle sessions stay lazy (load on click). Speculative
prefetch of a top-N active warm set was considered and dropped: it increases
traffic (streaming sessions the user may never open) and so opposes this
change's reduce-replay goal. If switching to a long-idle busy session ever feels
slow, revisit prefetch as an opt-in, Strategy-A-dependent (delta-only),
top-N-bounded follow-up — never standalone.

### Strategy B keys on `entryId`, not `seq`
A stub's `seq` is runtime-local and dies on server restart. The full-fidelity
fetch must key on pi's stable `entryId` (persisted in JSONL). `entryId` is today
attached to `message_start` / `message_end` but NOT `tool_execution_end`; plumbing
it onto tool events (bridge live path + `state-replay.ts`) is a prerequisite for
B. This is why B sequences after A.

### Strategy B is a fidelity feature first
Frame: "collapsed = truncated preview, expand = full body you cannot otherwise
see." The round-trip is paid only on a deliberate, rare expand — exactly when
users tolerate latency — and buys a capability, not just bytes. The stub carries
a `preview` so the collapsed card is never empty pre-fetch, and a `byteSize` so
the UI can show "Show full output (37 KB)".

## Open question driving sequencing

**Persist reduced messages vs raw events (task 1.1).** Reduced `ChatMessage[]`
paints instantly but binds the cache to reducer-output schema, forcing a
`schemaVersion` bump (→ full replay) on any reducer change — frequent. Raw events
re-reduce on load (cheap, the reducer is pure) and bind only to the event wire
schema (stable). Leaning raw-events for resilience; confirm payload size and
load-time reduce cost before committing. This decision gates the IndexedDB schema
and the invalidation frequency, so resolve it first.

> **SUPERSEDED (Strategy B reconciliation).** Develop shipped the same
> user-facing "Show full output for large tool results" feature
> (`adopt-pi-071-072-073-features`) while this change was in flight. Strategy B's
> original stub mechanism (`{stub, byteSize, preview, entryId}` + JSONL
> full-fidelity route keyed on id/toolCallId) was DROPPED. The shipped Strategy B
> is a minimal server-side replay optimization: `replay-truncate.ts`
> `truncateToolResultForReplay` pre-truncates heavy (>200-line) tool results to
> develop's display form (`«N earlier lines hidden»` + last 200 lines) during
> replay to trim replay bytes, reusing develop's client render + `toolCallId`
> route + a 1-line `truncateOutputForDisplay` idempotency guard. The decisions
> and findings below (stub threshold, byteSize, entryId plumbing) are retained
> as HISTORICAL design context only — see the reconciled
> `specs/lazy-expand-full-fidelity/spec.md` for the shipped contract.

## Resolved decisions (Phase 1)

### 1.1 Persist raw events, re-reduce on load
Cache `payload = StoredEvent[]` (`{ seq, event }[]` up to `maxSeq`), NOT reduced
`ChatMessage[]`. Reducer is pure → re-reduce on load is one synchronous pass over
in-memory events, negligible for typical sessions. Binds cache only to the stable
event wire schema, so `schemaVersion` bumps stay rare. Per-session size cap +
LRU bound IndexedDB growth. Sequencing: A+B ship together (1.3 confirmed).

### 1.2 Do NOT persist the pi-asset registry
`replaySessionAssets` re-sends the whole `pi-asset:<hash>` registry on EVERY
subscribe (delta or full), so the delta replay after reload re-delivers assets.
Persisting base64 blobs would bloat IndexedDB. Accept one-round-trip
placeholder-until-delta for images; no asset persistence.

### 1.3 entryId on tool_execution_end — plumb both paths, ship B with A
`state-replay.ts`: tool-result `entry.id` already in scope at the
`tool_execution_end` emit site → attach `entryId: entry.id`. Live bridge path:
tool results arrive as separate `toolResult` messages; attach the leaf entry id
via `ctx.sessionManager.getLeafId()` (same fallback `message_end` uses). Full-
fidelity route keys on this `entryId`, reads session JSONL. B ships with A.

### 1.4 Stub threshold ≥ 4 KB, preview 200 chars
Stub a finalized tool result when its `result` byteSize ≥ 4_000. preview = first
200 chars of the result. Results < 4 KB replay inline unchanged.
Streaming/in-flight never stubbed.

## Implementation findings (corrections to premise)

### Truncation is DISABLED by default — byteSize must not gate on it
Proposal premise "large tool outputs are silently truncated to 4 KB" is FALSE in
the default config: `config.ts` `DEFAULT_MEMORY_LIMITS.maxStringFieldSize = 0`,
and `createTruncator(<=0)` returns identity → no truncation. `memory-event-store`'s
own function default (4000) is overridden by the server to 0. So `byteSize`
recording MUST NOT gate on "a truncated copy exists" (that path never fires in
prod). `recordToolResultByteSize` computes byteSize from the original result
text directly, gated only by the stub threshold, and annotates a COPY of the
stored event (fresh shallow copy when truncation is off) so the live-broadcast
object is never mutated. Caught only by the Docker E2E (unit tests used the
function default 4000 = truncation on); added a `maxStringFieldSize=0` regression.

### Live tool results are STRUCTURED, not strings
The live bridge forwards `tool_execution_end` `result` as
`{ content: [{ type: "text", text }] }`, NOT a flat string (only disk replay via
`state-replay.ts` produces a string). `extractToolResultText` normalizes both
shapes for byteSize + preview + the JSONL route body.

### Strategy B keys on toolCallId (live) / entry.id (disk)
Live path attaches `entryId = toolCallId` (always present on the event AND on the
JSONL `toolResult` entry's `message.toolCallId`); disk path attaches
`entryId = entry.id`. The full-fidelity route matches `id` OR `toolCallId`, so
either replay origin resolves — more robust than the `getLeafId()` guess.

## Risks

- **Stale history after offline fork/edit.** Mitigated by provisional-render +
  reset reconciliation; worst case is a brief flash corrected by the first delta.
- **IndexedDB quota/eviction churn.** Bounded by the client LRU (last-access) and
  a per-session size cap; eviction is safe (full-replay fallback).
- **Schema drift.** `schemaVersion` mismatch drops the entry — cheaper than
  migrating. Bump it on any persisted-shape change.
- **Strategy B `entryId` plumbing.** Tool events lack `entryId` today; adding it
  touches the bridge live path and `state-replay.ts`. If that proves invasive, B
  can ship A-only and defer.
- **Double-paint / layout shift** on rehydrate-then-delta. Keep the provisional
  render visually identical to the reconciled one to avoid flicker.
