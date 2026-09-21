# Design — filter-system-role-message-forwarding

## Context

Two forwarding sites carry the pi 0.86 prompt/tool payload.

**Site 1 — the message arms.** `bridge.ts` enriched forwarder, `message_start`
arm (~L2397) and `message_end` arm (~L2503). Both already early-return on
`message.role === "custom"` (at L2412 / L2519) because custom messages are
forwarded by `wrapCustomPersistenceForCtx`. In both arms the coalescer barrier
runs at the top of the branch, BEFORE that early return.

**Site 2 — `session_compact`.** Listed in the enriched subscription list at
`bridge.ts:2161` with no dedicated branch, so it falls to the shared tail and
`mapEventToProtocol` serializes the whole event, `compactionEntry` included.

Above both, at **handler entry before any branch**, sits the parked-snapshot
choke point:

```ts
// bridge.ts:2215 — ONE statement, before ANY branch, so it covers every
// early return below, including ones added later.
if (flushesParkedText(eventType)) coalescer.flush();
```

`flushesParkedText` returns true for every event type except `message_update`
(`message-update-coalescer.ts:321`). This is load-bearing for D2 below.

What pi 0.86 actually emits for a system message (verified against the runtime
0.86.1 install, not assumed):

```js
// pi-agent-core/dist/agent-loop.js:52-54   (runAgentLoop, session start)
//                            :115-117   (runLoop, before each assistant response)
for (const message of initialMessages) {   // system message + queued user messages
  await emit({ type: "message_start", message });
  await emit({ type: "message_end", message });
}
```

Three consequences fall out of that loop:

1. **Both** events are emitted, carrying the same message object — the payload
   cost is paid twice.
2. **No `message_update` is ever emitted between them**, so a system message can
   never own a coalescer identity that an update would match. This is a property
   of the emit site, not an assumption about content.
3. The system message is emitted in the **same loop** that delivers queued user
   messages, i.e. at a turn boundary, immediately before the assistant stream.

`agent-session.js:415-420` then persists it through `sessionManager.appendMessage`.

The emitter is the **runtime** pi (global 0.86.1 here). The repo's resolved
`@earendil-works/pi-coding-agent` is 0.85.1 (`pnpm-workspace.yaml` `overrides:`),
which has no system-role emit path.

## Decisions

### D1 — Filter at the bridge, not the server or client

The bridge is the **earliest** point at which the bytes can be stopped, and the
only one that also avoids the WS hop. A server-side ingest filter would remove
the broadcast, replay and byte-budget costs too — most of the listed cost is in
fact server-side — but it would still pay bridge→server transfer and would need
a protocol-level statement of which roles and fields are legal. The client
cannot help: by the time it drops the event, every cost has already been paid.

### D2 — Return AFTER the barrier, exactly like `custom`

Placement mirrors the `custom` arm: barrier first, then the early return.

**The honest rationale is consistency, not behaviour.** Two earlier drafts
justified this placement with a behavioural benefit; both justifications were
false, and the record is kept here so a third attempt is not made.

What the barrier actually does on `message_start`
(`message-update-coalescer.ts:151-160`):

```ts
messageStart(gen, key, message) {
  if (this.pending && this.pending.key !== key) this.flush();  // (a)
  this.closedKeys.delete(key);                                 // (b)
  this.openKey = key; this.openGen = gen;                      // (c)
  this.bindGeneration(gen, message);                           // (d)
}
```

For a system `message_start`, **every one of these is inert**:

- (a) can never fire. `bridge.ts:2215` already called `coalescer.flush()` at
  handler entry for every non-`message_update` event, so `this.pending` is
  already null. The parked-snapshot ordering guarantee belongs to the entry
  choke point, not to the barrier.
- (b) deletes a closed marker for a key that was never closed — a no-op.
- (c) opens a `gen:system:ts` identity that nothing can ever match, since
  consequence 2 proves no `message_update` for it can arrive. It is superseded
  by the next real `message_start`.
- (d) binds the system message object to the generation; nothing consults it.

Its `message_end` then marks that key closed: one bounded entry in `closedKeys`,
role-disjoint from real keys, unable to affect an in-flight assistant identity
(the close is guarded by key+gen and the key embeds the role).

So the two placements are **behaviourally indistinguishable**, and the choice is
made on maintenance grounds:

- The new arm is textually identical in shape to the `custom` arm beside it, so
  a reader does not have to work out why two adjacent exclusions differ.
- It introduces no structural exception to "every `message_start` reaches the
  barrier", so nothing about the barrier's contract has to be re-derived later.
- It keeps the diff to one line per arm.

On the counter: `bridge.ts:452-453` documents it as *"Incremented on EVERY
`message_start` (user and assistant)"*. Routing a system `message_start` through
the barrier extends that enumeration to a third role, so the comment should be
updated to say so. That is a documentation amendment, not a behavioural change.

> **Superseded alternatives, both rejected on false premises.**
> (i) *"Return before the barrier to keep `assistantMessageGen` honest."* False:
> the counter deliberately counts user messages, so it was never a pure
> assistant count.
> (ii) *"Return after the barrier so a parked snapshot is still flushed in
> order."* Also false: the entry-level flush at `bridge.ts:2215` already
> guarantees that for every branch, so the barrier's internal flush can never
> find a pending snapshot. Any spec or test asserting the barrier causes that
> flush would be unfalsifiable.

### D3 — No version gate, no config switch

pi < 0.86 never emits the role, so the message filter is inert there. The
`compactionEntry` redaction is safe on every supported version because the field
has no consumer. A config switch would exist only to re-enable payloads nothing
consumes.

### D4 — Replay path untouched

`state-replay.ts` synthesizes `message_start`/`update`/`end` for `user`,
`assistant` and `toolResult` entries, plus a `role:"custom"` `message_end` for
`custom_message` entries (`:60-98`). It has no arm that would synthesize a
`role:"system"` message, so a persisted system entry already falls through.
Adding an explicit skip would be a no-op and is out of scope.

### D5 — `message_update` needs no arm

Not covered because the emit site proves it cannot occur: `agent-loop.js` emits
`message_start` and `message_end` adjacently with nothing between them
(Context, consequence 2). If a future pi streams system messages, the coalescer
`offer` path fails open and the payload would leak again — recorded here as the
known re-entry point rather than defended against speculatively.

### D6 — Redact `compactionEntry` wholesale, not just `systemMessage`

The narrow fix would delete only `compactionEntry.systemMessage`. Omitting the
whole `compactionEntry` field is chosen instead, because:

- **No consumer reads it.** Zero production references across
  `packages/client`, `packages/server`, `packages/shared`. The client's
  `session_compact` arm reads only `reason`, `willRetry` and
  `estimatedPostCompactionTokens` (`event-reducer.ts:2469-2502`); the server
  only clears the `compacting` flag (`event-status-extraction.ts:100-101`).
- **It also removes `summary`**, the other large field on the entry.
- **A field omission is simpler than a nested rebuild** of `compactionEntry`
  minus one key.
- **It narrows a live-only payload.** The replay path already synthesizes a
  `session_compact` whose data is just the protocol `type` tag, guarded by a
  test asserting a 64 KB `summary` leaks no substring (`state-replay.ts:189-197`,
  `state-replay.test.ts:174-186` (E6), change: `replay-compaction-boundary`).

**Parity claim, stated precisely.** This does *not* make live and replay
identical, and must not be described that way. `compaction-boundary-replay/spec.md`
fixes parity on event **type, position and timestamp**, and explicitly says
metadata "need NOT match a live event's metadata". Live keeps
`reason`/`willRetry`/`fromExtension`; replay emits neither. Redaction closes the
`compactionEntry`/`summary` gap only, and leaves that metadata contract intact.

> **Narrower fallback**, if review prefers minimal blast radius: redact only
> `compactionEntry.systemMessage` and keep the rest of the entry. It fixes the
> stated leak but leaves `summary` on the live path.

### D7 — Redact on a COPY, at the bridge, before `mapEventToProtocol`

Two constraints, both load-bearing.

**Do not mutate the event.** pi's `ExtensionRunner.emit` hands the *same* event
object to every subscribed handler, and `session_compact` is emitted as a
literal object by `agent-session.js`. A `delete event.compactionEntry` would
therefore strip the field from every other extension subscribed to
`session_compact`, not just from the dashboard's forwarded copy. The redaction
MUST build a shallow copy without the field and forward that, leaving pi's
object untouched.

**Do it at the bridge, not in the mapper.** `mapEventToProtocol` is the generic
event→protocol mapper shared by every forwarded event type; encoding a
per-event-type field policy there would make it event-aware. The redaction is
bridge forwarding policy, so it belongs at the bridge's `session_compact`
handling. `event-forwarder.test.ts:60-68` exercises `mapEventToProtocol` with a
`compactionEntry` fixture but asserts only `eventType`, so it is unaffected
either way.

### D8 — Compaction's system checkpoint on disk is a separate concern

`session-format.md:271-280` shows the persisted `compaction` entry carrying the
same `systemMessage` checkpoint on disk. This change only governs what the
bridge **forwards**; the on-disk format is pi's and is untouched.

## Couplings checked (no change required, recorded so they are not rediscovered)

- **`lastActivityAt` stamping.** `message_start`/`message_end` are in the
  `isActivityEvent` allowlist (`event-status-extraction.ts:210-211`), so dropped
  system events no longer stamp activity. Inert — but note the reason precisely:
  `turn_start` is NOT in that allowlist, so the guarantee comes from the
  assistant/user `message_start` that follows the system pair in the same emit
  loop (Context, consequence 3), plus `agent_start` at run level.
- **Replay-window snapping.** `packages/server/src/browser-handlers/subscription-handler.ts:104-123`
  snaps the replay window's lower edge to `message_start`/`turn_start` and its
  upper edge to `message_end`. Dropping system `message_start`s removes
  candidate boundaries; inert because `turn_start` precedes them and replay
  synthesizes its own user `message_start`.
- **The other pi line.** `packages/extension/package.json` also supports
  `@mariozechner/pi-coding-agent` (0.73.1 installed). Verify during
  implementation rather than assuming: the claim is that it has no system-role
  emit path, which holds for 0.73.1 but is asserted, not proven, for the whole
  supported range. The filter is a no-op wherever the role is absent, so the
  risk of being wrong is zero — only the "inert" wording depends on it.
- **Nonce correlation.** The system `message_start` returns before
  `pendingNonces.set`, so no nonce is minted and no `entry_persisted`
  correlation is expected for it. The `message_end` arm returns before its own
  nonce logic for the same reason. Consistent, not a gap.
- **Trim priority.** `session_compact` is absent from `ESSENTIAL_CHAT_EVENT_TYPES`
  (`memory-event-store.ts:340-348`), so unlike the message pair it enjoys no
  reclaim protection. Redacting it saves WS/broadcast/replay/cache bytes, not
  byte-budget pressure.

## Test

`assistantMessageGen` and `coalescer` are closure-locals inside the unexported
`initBridge`, and no test instantiates it (it opens a WebSocket, mDNS and
interval timers at load — see `bridge-coalesced-chat-order.test.ts:1-20`). So a
test cannot "drive the enriched handler" or observe the generation counter
directly, and any assertion about placement must be a source-contract assertion
rather than a behavioural one.

Two further constraints for scenario design:

- The existing reduced model is a **partial** mirror: its `message_end` branch
  has no `custom` early return, and `messageStart` is called without the message
  argument, so `bindGeneration`/`generationOf` are not exercised. Extending it
  must not be read as covering the correlation path.
- The only existing "replayed and live reduce identically" compaction test
  (`event-reducer-compaction.test.ts` E8) hand-builds its fake live event as
  `data: { type: "session_compact" }`, so it never carried the real live fields.
  It is not a safety net for the redaction.

Per D2, no test may assert that the barrier causes a parked-snapshot flush —
that behaviour belongs to the entry choke point and would pass regardless of
placement.

Scenario derivation, level routing and disposition are owned by `test-plan.md`.
