# Stop forwarding pi 0.86 system prompt/tool payloads over the bridge

## Why

pi 0.86.0 made system-prompt and tool changes **transcript-backed**: the first
request of a session persists a `role:"system"` message carrying every prompt
`section` and the full `toolsAdded` declaration list, and later prompt/tool
changes persist as further system messages that patch `sections` by name
(pi `docs/session-format.md` L228–235, "Entry Types").

That payload reaches the dashboard by **two independent paths**, and the bridge
forwards both.

### Path 1 — the `role:"system"` message pair

`pi-agent-core`'s agent loop emits the pair back to back:

```js
// pi-agent-core/dist/agent-loop.js:52-54 (runAgentLoop, session start)
//                            :115-117 (runLoop, before each assistant response)
for (const message of initialMessages) {   // system message + queued user messages
  await emit({ type: "message_start", message });
  await emit({ type: "message_end", message });
}
```

`agent-session.js:415-420` then persists it via `sessionManager.appendMessage`.
The bridge's enriched `message_start` / `message_end` arms filter only
`role === "custom"`, so both are forwarded.

Measured on a live 0.86.1 session in this repo, the system `message_end` is
**150,989 bytes** (one system message per session; 1–2 seen across the 12 most
recent sessions — a second appears on a mid-session tool-set change). Because
`message_start` carries the **same message object**, the forwarded cost is
**both events**, i.e. ~2× that figure per system message.

### Path 2 — `session_compact.compactionEntry`

`session_compact` sits in the bridge's enriched subscription list
(`bridge.ts:2161`) with **no dedicated branch**, so it falls through to the
shared tail and is forwarded whole. `session-manager.js:837,849` populates its
`compactionEntry.systemMessage` with the *same* prompt-sections + tool-declaration
blob, and `compactionEntry.summary` with the compaction summary.

No dashboard code reads `compactionEntry` at all — client, server and shared
packages contain zero production references. The client's `session_compact` arm
reads only `reason`, `willRetry` and `estimatedPostCompactionTokens`
(`event-reducer.ts:2469-2502`) — and the runtime 0.86.1 `SessionCompactEvent`
carries no `estimatedPostCompactionTokens` field at all, so that badge input is
absent there regardless. The server uses the event only to clear the
`compacting` flag (`event-status-extraction.ts:100-101`).

The replay path already refuses to ship any of it: a persisted `compaction`
entry synthesizes a **metadata-free** `session_compact` carrying only the
protocol `type` tag, with an explicit regression test that a 64 KB `summary`
leaks no substring onto the wire (`state-replay.ts:189-197`,
`state-replay.test.ts:174-186` (E6), change: `replay-compaction-boundary`). So
the live path is strictly leakier than the replay path for the same boundary.

### Why it costs — and the two paths cost differently

Both paths' events are under the 256 KiB per-event cap (`memory-event-store.ts`
`DEFAULT_MAX_EVENT_DATA_SIZE = 262_144`), so the store keeps them intact; both
are broadcast to subscribed browsers, replayed on subscribe, and land in the
client's replay cache. They differ in trim priority, and only path 1 is
privileged:

- **Path 1 (`message_start`/`message_end`) is ESSENTIAL.**
  `ESSENTIAL_CHAT_EVENT_TYPES` (`memory-event-store.ts:340-348`) holds exactly
  `message_start`, `message_end`, `inline_terminal_open`,
  `inline_terminal_close`. The system pair therefore survives the per-session
  trim's Pass 1 and is **deprioritised for reclaim** — the byte budget it
  consumes is instead taken out of tool/reasoning events. (Pass 2 does drop
  essential events once a byte budget binds, `:398-414`, so it is deprioritised,
  not immortal.)
- **Path 2 (`session_compact`) is NOT essential** — it is absent from that set,
  so it is reclaimed in Pass 1 like any ordinary event. Its cost is the WS hop,
  the broadcast, the replay-on-subscribe window and the client cache, not a
  privileged hold on the byte budget.

The client's `event-reducer` has no `role:"system"` arm, so path 1 renders
nothing at all — that cost is entirely silent. Path 2's event does render the
compaction divider, but its `compactionEntry` payload is never read.

### Which pi emits this

The repo resolves `@earendil-works/pi-coding-agent` to **0.85.1** (the
`pnpm-workspace.yaml` `overrides:` pin; `packages/server` declares `^0.85.1`,
other workspaces `>=0.80.10`). That version has no system-role emit path. The
emitter is the **runtime** pi that hosts the bridge — globally installed 0.86.1
here. So the leak is observable in live sessions while being absent from the
resolved dependency; any manual verification must run on a pi >= 0.86 runtime or
it proves nothing.

## What Changes

1. **Drop system-role messages.** The bridge SHALL NOT forward `message_start` /
   `message_end` events whose `message.role === "system"` — the **same
   early-return shape and the same placement** as the existing
   `role === "custom"` exclusion: the coalescer barrier runs first, then the
   return.
2. **Redact `compactionEntry` from `session_compact`.** The bridge SHALL forward
   `session_compact` without its `compactionEntry` field, preserving every
   top-level field consumers actually read. This removes the `systemMessage`
   blob and the `summary`. The event itself is still forwarded — the client
   renders the compaction divider from it. The redaction SHALL be done on a
   **copy**: pi hands the same event object to every subscribed extension, so
   mutating it in place would strip the field for unrelated extensions too.
3. **Amend the `catch-all-event-forwarding` spec's 1:1 forwarding requirement**,
   which today admits exactly **ONE** scoped exception and states it "SHALL NOT
   extend to any other event type or tool". These are further exceptions and
   must be stated there, not bolted on as unrelated additions.

No server, protocol, or client change. No version gate: pi < 0.86 never emits
the role, so exclusion 1 is inert there; exclusion 2 is a field omission that is
safe on every supported version because the field has no consumer.

### Trade-offs accepted

- **Forward-only.** System events already persisted by earlier sessions are not
  evicted; they keep their store entry and still replay on subscribe until
  normal rotation removes them. Backfilling eviction is out of scope.
- **`message_end` still touches the coalescer.** Mirroring `custom` means
  `coalescer.messageEnd(...)` runs before the return, marking closed a
  `gen:system:ts` key whose identity was opened moments earlier by the same
  message's barrier. It cannot affect an in-flight assistant identity (the close
  is guarded by key+gen and the key embeds the role), and `closedKeys` is
  bounded, so this is accepted rather than special-cased.
- **`summary` stops reaching the live client.** Nothing reads it today, and the
  replay path already withholds it, so this removes a live-only payload rather
  than a feature. Should a future compaction UI want the summary, it should be
  added deliberately to both paths.
- **Live and replay still differ on metadata, and that is intended.** Redaction
  closes the `compactionEntry`/`summary` divergence only. Live events keep
  `reason`/`willRetry`; replay emits neither, because
  `compaction-boundary-replay/spec.md` fixes parity on event **type, position
  and timestamp** and states metadata "need NOT match a live event's metadata".
  This change does not alter that contract.
- **The bridge is the earliest place, not the only one.** A server-side ingest
  filter would also remove the broadcast/replay/budget costs, but would still
  pay the bridge→server hop and would need a protocol-level statement of which
  roles and fields are legal. See design D1.

Out of scope (deliberately): surfacing the prompt/tool loadout as a compact
dashboard event (`sections` keys + `toolsAdded` names). That is a feature, not a
regression fix; it can reuse these filter points later.

## Discipline Skills

- `review-code` — non-trivial in placement, in the spec amendment, and in
  asserting the redacted field has no consumer; a review pass on the arms, the
  spec delta and the tests is the gate.
- `performance-optimization` — the change is on a measured large-data path
  (~150 KB × 2 per session, plus the compaction blob). The discipline applies in
  its **measure-first** direction: the byte figures in Why are the measurement,
  and the verification tasks re-measure rather than assume. No profiling work
  beyond that is warranted, since the change only removes payload.
- No `security-hardening` trigger: the change removes bytes from an
  already-authenticated channel and adds no path or untrusted input.

## Impact

- `packages/extension/src/bridge.ts` — two arms in the enriched forwarder, plus
  the `session_compact` redaction site.
- `packages/extension/src/__tests__/bridge-coalesced-chat-order.test.ts` — its
  `BridgeModel.dispatchEnriched` restates this handler body and its
  source-contract assertions pin the barrier/early-return ordering. Note the
  model is a **partial** mirror: its `message_end` branch has no `custom` early
  return, and its `messageStart` is called without the message argument, so
  `bindGeneration`/`generationOf` are not exercised. Extending it must not imply
  coverage it does not provide.
- `packages/extension/src/__tests__/` — new coverage per `test-plan.md`.
- Note for scenario design: the only existing "replayed and live reduce
  identically" compaction test (`event-reducer-compaction.test.ts` E8) hand-builds
  its fake live event as `data: { type: "session_compact" }`, so it never carried
  the real live fields and certifies nothing about live/replay parity — before or
  after this change. It is not a safety net for the redaction.
- `openspec/specs/catch-all-event-forwarding/spec.md` — MODIFIED + ADDED delta.
- Rebuild matrix: extension → `npm run reload`.

## Rollback

Single-commit revert. Both exclusions are additive and stateless: reverting
restores forwarding immediately on the next `npm run reload`, with no migration,
no persisted-format change, and no client or server coordination. Sessions that
ran under the filter simply have no system events and no `compactionEntry` in
their stored history; since nothing reads either, a revert needs no backfill.
