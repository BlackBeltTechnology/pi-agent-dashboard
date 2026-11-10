# Design

## Context

See proposal.md (Why). Current code facts the design builds on:

- **Stop path.** Browser `requestSubagentStop` POSTs `/api/plugins/subagents/stop` (`packages/subagents-plugin/src/client/subagentStop.ts:93`). The plugin route emits a fixed `subagents:stop {agentId}` into the session (`packages/subagents-plugin/src/server/index.ts:90`). The session bridge relays it with `pi.events.emit(eventType, data)` (`packages/extension/src/bridge-handlers/dispatch.ts:367-371`), so every bus listener receives the **same payload object**. The producer's per-activation `AgentControlRegistry.stop` (`pi-dashboard-subagents/extensions/agent.ts:851-868`) computes `{phase, outcome}` for an unknown or finished id but only `console.warn`s it. Pending stop state ends only on a terminal map status (`SubagentDockGroup.tsx:179-186`) or the 10 s `unconfirmed` timer (`subagentStop.ts:97-103`).
- **Bus.** The pi event bus is a plain `EventEmitter`: `emit` calls every listener synchronously, in registration order (`node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js`). The producer already serves synchronous query channels by mutating the payload (`subagents:list` / `subagents:get`, `agent.ts:2418-2434`).
- **Plugin bridge entry.** It runs in each pi session and (re)declares its forward channels on activation and on `dashboard:bridge-ready` (`packages/subagents-plugin/src/bridge/index.ts:37-49`). `dashboard:bridge-ready` is emitted once per bridge init by `PluginForwardRegistry.attach()` (`packages/extension/src/plugin-event-forward-registry.ts:84-93`). A plain WebSocket reconnect only flushes retained messages (`packages/extension/src/bridge.ts:1249-1259`). A `live` forward is dropped while not ready or connected; `latest` retains the newest message per key and flushes in order (`plugin-event-forward-registry.ts:154-172`). The forwarded event's `timestamp` is `Date.now()` on the pi host at forward time (`bridge.ts:2068-2074`).
- **Delivery.** `frameClassOf` returns `transcript` for every `type:"event"` frame (`packages/server/src/pairing/browser-gateway.ts:97-168`). `sendTo` sheds transcript frames above `MAX_WS_BUFFER` (`browser-gateway.ts:1411-1446`). `state` frames go through `sendState(ws, key, serialized)`: deferred latest-wins per key in a byte-bounded pending map, with the socket terminated as stalled on overflow (`browser-gateway.ts:1101-1137`).
- **Client reduce.** Plugin-owned `subagent_*` events fall to the reducer's `default` arm: the Agent finalizer's `onSessionEvent` is tried first, then the plugin slice (`packages/client/src/lib/chat/event-reducer.ts:3098-3119`). The manifest owns `eventTypes: ["subagent_*"]` (`packages/subagents-plugin/package.json:43-45`), so the two new event types need no core change. Core reopens a chat row only for `healedBy: "session_ended"` (`event-reducer.ts:640`).
- **Server heal on end.** On session end the server synthesizes `subagent_failed {healedBy:"session_ended"}` for subagents with no terminal in the store (`packages/server/src/session/open-tool-calls.ts:153-174`, `event-wiring.ts:683-692`). In the incident the store held the ends and the browser alone missed them, so this did not fire.

## Goals / Non-Goals

**Goals:**
- Any ghost row can be cleared in one Stop click, with an answer from the session.
- A session that initializes or reloads its bridge corrects the map by itself.
- Subagent end frames are never shed under back-pressure.
- No core reducer change; the dashboard stays compatible with producer 0.7.0.

**Non-Goals:**
- Gap-triggered resync of *all* shed transcript frames (option C of the exploration).
- Durable background end entries in the pi session file (option E).
- A registry snapshot on every transport reconnect: a browser reconnect replays from the server store (which holds the ends), and the stop answer covers the remaining case on demand.
- Changing the stop route's auth or validation, or the background started card.

## Decisions

### D1. The plugin bridge entry combines producer answers and forwards them

The producer only gains bus-level behaviour (sibling change in `pi-dashboard-subagents`, see Migration):
- Each `subagents:stop` handler records its verdict on the payload it received, **synchronously**: `(data.verdicts ??= []).push({ phase, status? })`. Creating the array when absent makes the listener order irrelevant.
- A new synchronous query `subagents:registry { answered: number; entries: Array<{agentId, status}> }`. Each activation increments `answered` and *appends* (unlike first-writer-wins `subagents:list`). Its entries are the control registry's queued/running runs plus every background record of the activation.

The subagents plugin's bridge entry (`src/bridge/index.ts`) owns the dashboard side:
- **Stop answer.** It listens on `subagents:stop`. In its listener it defers the read with `queueMicrotask`: `emit` has run every listener before it returns, so by the microtask every synchronous producer handler has pushed. It combines the verdicts (D3), stamps `answeredAt = Date.now()`, and emits `subagents:stop_result { agentId, outcome, phase, status?, answeredAt }`.
- **Registry snapshot.** It emits `subagents:registry { answered: 0, entries: [] }`, reads the payload right after `emit` returns and, when `answered > 0`, emits `subagents:registry_snapshot { scope: "registry", entries, takenAt }`. It does this only on `dashboard:bridge-ready` and **after** its `declare()` in that same handler, so the channel is subscribed when the snapshot is emitted. A snapshot is not emitted at plain activation: without the core registry attached it would have no subscriber, and `bridge-ready` always follows.
- **Listener lifetime.** A plugin `bridge` entry is auto-registered as a pi extension (`openspec/specs/dashboard-plugin-loader/spec.md`, "Bridge entries auto-register as pi extensions"), so its `pi.events.on` goes through the loader's tracked subscription (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js:419-431`). On `/reload` or session replacement, the loader unsubscribes every tracked listener of the old runtime (`loader.js:146-153`) before the new activation subscribes. Every `on` and `emit` in the bridge entry is wrapped in `try/catch`, like the existing `declare` (`bridge/index.ts:39-45`), because a stale runtime's `on` throws (`loader.js:426-429`). So one live activation per runtime means one set of listeners, with no guard. A module-level or per-bus guard would wrongly skip re-wiring after reload and is not used. A unit test activates twice on one bus *with* unsubscription between the two (reload) and asserts one `subagents:stop_result` per stop.

Forward declaration (both `latest`, so a message emitted while not ready is kept and flushed instead of dropped):
- `subagents:stop_result` → `subagent_stop_result`, `key: "agentId"`.
- `subagents:registry_snapshot` → `subagent_registry_snapshot`, `key: "scope"` (constant `"registry"`), so only the newest snapshot is kept.

The server route is unchanged and keeps emitting `subagents:stop {agentId}`.

*Why the bridge entry:* combining needs every activation's answer, and only code on the same bus, reading after the synchronous emit, sees them all. The bridge entry already declares forwards and handles `bridge-ready`.
*Alternative rejected:* each producer activation forwards its own answer. Two activations would send `unknown` and `running` for one stop.
*Alternative rejected:* answer in the server route from the store or the browser map. The server does not know what the producer runs: in the incident the store held the ends and only the browser had missed them.
*Alternative rejected:* a new `subagents:stop_request` channel re-emitted by the bridge entry. It would need a server change and a version handshake, and an old bridge entry would leave stops undelivered.

### D2. Producer contract and status mapping

`StopRequest` (`pi-dashboard-subagents/extensions/hooks.ts:95`) gains `verdicts?: Array<{ phase: "queued"|"running"|"terminal"|"unknown"; status?: "completed"|"failed"|"stopped" }>`. Each activation pushes exactly one verdict per request, synchronously, and `unknown` for an id it does not hold.

Producer → dashboard status mapping, used by verdicts and registry entries: `queued` → `created`; `running` → `running`; `completed` → `completed`; `error`, `aborted` → `failed`; `stopped` → `stopped` (`pi-dashboard-subagents/extensions/events.ts:44-45`, `packages/shared/src/dashboard-plugin/subagent-types.ts:52`). The bridge entry applies the mapping, so the wire frames use the dashboard vocabulary.

A finished foreground run is not listed by the registry: its terminal reaches the dashboard through the durable `tool_execution_end` (`toolRowFinalizer.ts:383-397`).

### D3. Combining verdicts

`running` > `queued` > `terminal` with status > `terminal` without status > `unknown`. `outcome` is `stopped` if any verdict was `queued` or `running`, else `ignored`. Zero verdicts after the microtask means no producer understood the request (0.7.0): no frame is sent, and the dashboard keeps today's timer behaviour.

### D4. "A producer answered" for the snapshot

`answered === 0` → no snapshot. This separates "no producer" from "producer with zero subagents", which the spec requires. A 0.7.0 producer ignores the unknown channel and never produces a false empty snapshot.

### D5. Client reduce (plugin only)

**Freshness guard.** The plugin records `lastFrameAt` on each subagent: a plugin-local field on `PluginSubagentState`, set to `event.timestamp` by every plugin write path that proves the subagent alive. That means the slice's `created`, `started`, `entry` and `delta` arms (`sessionEventReducer.ts:70-143`) and the finalizer's `tool_execution_update` hydration (`toolRowFinalizer.ts:240-253`), which is the durable channel for a running foreground subagent. The field survives the finalizer's merges, which spread `existing` (`toolRowFinalizer.ts:209-221`), and `setSubagentState` stores one object under both ids (`subagent-types.ts:238-249`). A reconcile frame changes a subagent only when `lastFrameAt` is **absent or not later than** the frame's `takenAt` / `answeredAt`. Absent means none of its live frames is in the loaded history. A trimmed tail can drop them (the store drops `tool_execution_update` at retention, `packages/server/src/persistence/memory-event-store.ts:118-120`), but the reconcile frame itself was produced by the session *after* those frames. A subagent still running at that point would be in the snapshot or would have answered `running`, so ending an absent-`lastFrameAt` subagent the session does not list is still correct. Every compared time is a pi-host `Date.now()`. Producer frames are stamped at forward time by the core bridge (`bridge.ts:2068-2074`), `tool_execution_update` at forward time by the same bridge, and `takenAt` / `answeredAt` by the plugin bridge entry in the same process. A forward or flush time is never earlier than emission, so the guard errs toward keeping a subagent live. This covers a snapshot flushed after a newer subagent started, and a deferred stop answer delivered after a later `subagent_started`.

**Replay.** The two reconcile frames are stored in the server's in-memory event store like any forwarded event and replay with the store, in seq order, so a reload reaches the same state. They are not in the pi session file. After a store wipe the map is rebuilt from the session file, which holds no live `subagent_*` frames for those runs (the incident's observed recovery), so there is nothing for a reconcile to correct.

**Targets.** Only subagents in `created`/`running` status in this session, that pass the guard.

**Apply.** Both new events are claimed by the Agent finalizer's `onSessionEvent`. For each target it builds a synthetic terminal and runs it through the existing `onSubagentTerminal`, which also finalizes a still-running foreground `Agent` chat row:
- untracked (stop answer `unknown`, stop answer `terminal` without `status`, or absent from a snapshot): `subagent_failed { id, error: "no longer tracked by its session", healedBy: "untracked" }`;
- known terminal status: `subagent_completed`/`subagent_failed` with `details: { status }` and `healedBy: "session_reconcile"`, no result.
A later real end overwrites either, because `onSubagentTerminal` refuses only a *heal* over a terminal (`toolRowFinalizer.ts:153-155`).

**Revive.** `reopenHealedSubagent` (`toolRowFinalizer.ts:224-231`) also accepts `healedBy: "untracked"`, and the slice's `started` arm already sets `running` and clears `healedBy` (`sessionEventReducer.ts:84-96`). So the subagent map, which drives the dock and the full-screen view, revives on a live frame. The chat row of a foreground subagent ended as untracked is **not** reopened: core reopens only `session_ended` rows (`event-reducer.ts:640`), and changing that is out of scope. See Risks.

**Stop store.** The finalizer stays pure. A reconcile that makes a subagent terminal triggers the dock group's existing effect, which clears the stop notice of every terminal subagent of its kind (`SubagentDockGroup.tsx:179-186`). The card's feedback line reads the same store. An answer for an already-terminal subagent changes nothing, and nothing needs to: its notice was cleared when it became terminal. The 10 s timer stays as the 0.7.0 fallback. A later answer still ends the subagent, so a `Still running` row then leaves the lane.

**Copy.** The full-screen view reads "Ended — its session no longer tracks it" for `healedBy: "untracked"` (new catalog key, every locale in `packages/subagents-plugin/src/i18n.ts`).

### D6. Never shed subagent end and liveness frames

`frameClassOf` is **not** changed: `type:"event"` frames stay `transcript` there, so its existing callers (`broadcast` / `fanout`, `browser-gateway.ts:1587-1649, 1719-1749`) and its pinned test (`packages/server/src/__tests__/browser-gateway-dropped-frames.test.ts:158`) are unaffected. A new sibling `deferKeyOfEvent(msg)` returns a defer key only for these event types, and only `sendTo`'s shed branch consults it:

| event | id read from | key |
|---|---|---|
| `subagent_completed`, `subagent_failed` (real) | `event.data.id` | `subagent_end:<sessionId>:<id>` |
| `subagent_failed` with `data.healedBy` (server heal) | `event.data.id` | `subagent_heal:<sessionId>:<id>` |
| `subagent_stop_result` | `event.data.agentId` | `subagent_stop_result:<sessionId>:<agentId>` |
| `subagent_registry_snapshot` | (none) | `subagent_registry_snapshot:<sessionId>` |

The real end, the server's heal and the stop answer have **separate keys**. Latest-wins per key never lets one replace another, so a pending real end is never overwritten by a heal emitted at session end. The pending map flushes in key-insertion order. A missing or non-string id leaves the frame `transcript`, so ids never collapse into one shared key.

**Immediate vs deferred.** These frames keep the transcript send path whenever the socket is under the threshold: same `sendTo` call, same `{sessionId, seq}` context, same per-subscriber `replayingSessions` skip in `broadcastEvent` (`browser-gateway.ts:2694-2700`), and the **full** frame. Only where `sendTo` would *shed* them (`shouldShed`, `browser-gateway.ts:1433-1446`) does it call `deferKeyOfEvent` and, with a key, hand a copy to `sendState` instead of dropping and counting it. The new counter `deferredSubagentFrames` (on `/api/health` next to `droppedFrames.serverToBrowser`) counts these. The browser therefore receives exactly today's frame in the normal case, and the client replay cache, which records live frames (`useMessageHandler.ts:877`), never stores a projected end from a healthy socket.

**Projection of the deferred copy.** The pending map is byte-bounded at `MAX_WS_BUFFER`, and overflow terminates the socket (`browser-gateway.ts:1127-1136`). End frames carry the full timeline, because the terminal channels are never stripped (`packages/extension/src/subagent-frame-strip.ts:95-108`). The deferred copy of an end is therefore projected to a whitelist: `data.id`, `data.healedBy`, `data.durationMs`, `data.tokens`, `data.toolUses`, `data.result` and `data.error` each cut to `SUBAGENT_END_DEFER_TEXT_BYTES = 8192`, `data.details` reduced to the scalar fields `readSubagentDetails` reads (no `entries`, no `liveBlock`, no nested objects), plus the marker `data.deferredProjection: true`. The copy is therefore bounded by construction at ~17 KB plus small scalars, and the incident's ten ends defer at under 200 KB. The client keeps the timeline it holds, because `onSubagentTerminal` spreads `existing` and `readSubagentDetails` copies only whitelisted keys (`toolRowFinalizer.ts:155-170`). The replay persister skips any live event carrying `deferredProjection` (`replay-persist.ts` `record`), so the cache can never hold the cut copy. A seq gap left by the skip contaminates the buffer and degrades to a full replay, which holds the full frame. Stop answers and snapshots are small and are deferred unprojected.

**Unsubscribed while pending.** A deferred frame for a session the socket left before the flush is still delivered. The client applies events only to sessions it holds state for, and a reconcile is idempotent. Same behaviour as every existing state frame.

*Alternative rejected:* mark them `critical`. The critical budget is per-delivery and reserved for prompt replays (`browser-gateway.ts:197-215`).
*Alternative rejected:* an id-only debt like the registry reconcile. The server keeps no subagent map to rebuild an end from.

**Ordering.** A deferred end can arrive after later transcript frames of its session. Terminals are order-tolerant in the client (a late tick never reopens a terminal, `toolRowFinalizer.ts:285-300`). The client replay cache marks a live seq gap as contaminated (`packages/client/src/lib/replay/replay-persist.ts:99-111`): a frame at N+1 before the deferred N contaminates the buffer and the late N is skipped. The tab then falls back to a full replay on its next load, which is today's behaviour after any shed frame, and safe.

## Risks / Trade-offs

- [A producer stop handler that turns async would be missed] → the producer contract requires a synchronous push (D2). A late verdict after the microtask is ignored, so a wrong `unknown` is possible only if a producer breaks that contract. A bridge-entry unit test pins the microtask read, with one sync and one async listener: the async verdict is not counted.
- [Two producer versions on one bus] → a 0.8 activation answers `unknown` or an empty registry while a 0.7 activation really runs the subagent, so the dashboard ends it as untracked. Two installs of the producer on one bus already register the `Agent` tool twice and are a broken setup. The `lastFrameAt` guard keeps live subagents that keep emitting frames, and the next frame revives the map entry. Accepted.
- [Deferred frames add to a shared 4 MB pending budget] → they were shed before, so a socket already holding near-ceiling state frames can now be terminated as stalled instead of shedding. A projected end is ≤ ~17 KB, so the budget holds over 200 of them. A socket this saturated has already lost its transcript, and termination makes the browser reconnect and fully replay, which is the correct recovery. Counted by the existing `stalledSocketsTerminated`.
- [Full-screen copy for heal markers] → the card shows `sub.result` for any `healedBy` (`AgentToolRenderer.tsx:455`), and only `session_ended` counts as "result pending" (`resultPending.ts:22`). An `untracked` subagent has no result, so the full-screen view shows the new "no longer tracked" line (D5 Copy). A background `untracked` run behaves like the `session_ended` case in `background-subagent-display` (the row leaves, the started card stays).
- [A foreground chat row ended as untracked is not reopened] → only reachable in the mixed-version case above, or when a session wrongly reports `unknown`. The dock and full-screen view recover. The row recovers on the subagent's real `tool_execution_end`, which overwrites a heal (`event-reducer.ts:2697-2767`). Accepted to keep core untouched.
- [Snapshot vs subagent created during bridge init] → the `lastFrameAt` guard (D5) protects any subagent whose frame was forwarded after `takenAt`.
- [Two heal markers in the store for one subagent] → when the session later ends, the server's `session_ended` heal still fires for an agent the client ended as `untracked`, because the reconcile frames are not terminals in the store. The client ignores a heal over a terminal (`toolRowFinalizer.ts:153-155`). The stored stream carries both, harmlessly.
- [Projected deferred end loses part of `result` in the live view] → up to 8 KB is kept. The full text is in the store (reload) and in `AgentStatus` for background runs.
- [Two browsers] → the frames are stored once and broadcast. Both converge.

## Migration Plan

1. Ship the dashboard side (this change). With producer 0.7.0 no verdicts or snapshots arrive, and D6 alone prevents the incident's loss.
2. Ship producer minor 0.8.0 (sibling change `emit-subagent-stop-verdicts-and-registry` in `pi-dashboard-subagents`, to be opened after this change is planned) with the synchronous verdict push and the `subagents:registry` query.
3. Bump the e2e harness producer pin to 0.8.0 and enable the reconcile e2e scenarios.

Rollback: revert the dashboard change. The producer additions are passive: a payload field nobody reads and a query nobody emits.
