# Design

## Context

See proposal.md (Why). The current state that shapes the approach:

- **Producer contract (pi-dashboard-subagents 0.8.1, `~/Projects/Pi-Packages/pi-dashboard-subagents`).** Bus channels:
  - `subagents:created {id,type,description,details}`.
  - `subagents:started {id,details}`. The first `started` also carries `type`/`description` (`extensions/events.ts:354-363`); progress ticks do not (`events.ts:375`).
  - `subagents:entry`, `subagents:delta`, `subagents:completed`, `subagents:failed`.
  - Query channels `subagents:list` / `subagents:get` (since 0.7.0, CHANGELOG 0.7.0) and control channel `subagents:stop {agentId}` (`extensions/hooks.ts:25-48,94-113,189-216`).
  - The producer emits neither `subagents:registry` nor stop `verdicts`. Its stop outcome is computed and discarded (`extensions/agent.ts:894-905,2741`).
  - Since 0.2.5, `onUpdate` is batched to 250 ms. Since 0.3.0, progress ticks omit `entries`; `created`, the first `started`, terminal frames and non-terminal `onUpdate` still carry them. Since 0.5.0, only the terminal `onUpdate` and the persisted result are capped.
- **Forwarding.** Core maps the four lifecycle channels (`packages/extension/src/flow-event-wiring.ts:78-83`) and reserves their names (`packages/shared/src/event-forward-declaration.ts:66-80`). Not-ready buffering is `SubagentFrameBuffer.pending`: one newest frame per agent across channels (`packages/extension/src/subagent-frame-buffer.ts:186-196`). Plugin retention is `StreamForwardBuffer` with one 64-key budget shared by all plugins (`packages/extension/src/stream-forward-buffer.ts:31-35,116-125`); its `drain()` already orders by a global seq (`:146-156`).
- **Strip.** The strip runs on every `tool_execution_update`, tool-agnostic, and removes both `partialResult.details.entries` and `details.entries` for queued/running status (`packages/extension/src/bridge-handlers/forwarders.ts:571`, `packages/extension/src/subagent-frame-strip.ts:60-72`). It has a rollback env flag, `PI_DASHBOARD_SUBAGENT_STRIP` (`:84-86`).
- **Windowed replay.** The subscription handler flattens head + tail into one array and sends it in 200-event chunks (`packages/server/src/browser-handlers/subscription-handler.ts:433-442,439,484,501-513`). The client keeps contiguous head/tail bookkeeping (`packages/client/src/lib/chat/history-gap.ts`, `packages/client/src/hooks/useMessageHandler.ts:1173-1216,1340-1420`). Backfill has no seq dedup.
- **Store.** Over-size events become `{__truncated, reason, thresholdBytes, eventType}` (`packages/server/src/persistence/memory-event-store.ts:1047-1062`), which keeps `eventType` but drops `id`. Subagent-specific store logic: entries elision, `collapseStreamDeltas` (`:1650-1687`) and tick telemetry. The server never sees bridge forward declarations.
- **Ownership is already declared in manifests.** The subagents plugin manifest lists `eventTypes: ["subagent_*"]` and claims the `Agent` tool renderer (`packages/subagents-plugin/package.json:43-45,83`). The server and the client loader already read manifests.
- **Delivery policy.** Subagent defer keys are hard-coded in `packages/server/src/pairing/browser-gateway.ts:179-246`.
- **Orphan heal.** It runs inside `sessionManager.onEnded` (`packages/server/src/event-wiring.ts:658,697-714`). That fires from both `unregister()` and `update({status:"ended"})` (`packages/server/src/session/memory-session-manager.ts:569,605-606`) and is guarded by `movedTo` and `replayingSessions`. The plugin-facing `ctx.onSessionEnded` (`packages/dashboard-plugin-runtime/src/server/server-context.ts:1225`) is dispatched only from `onUnregister` (`event-wiring.ts:776`).
- **Client.**
  - Subagent reducer arms already live in the plugin slice (`packages/subagents-plugin/src/client/sessionEventReducer.ts`).
  - Core still types `SessionState.subagents` (`packages/client/src/lib/chat/event-reducer.ts:476,558`).
  - Core calls `findToolRowFinalizer("Agent")` for events without a `toolName` (`event-reducer.ts:1933,3117`).
  - Core runs a resync reconnect loop (`packages/client/src/App.tsx:1631-1660`).
- **Manifest `requires.piExtensions` is `string[]`** (`packages/shared/src/dashboard-plugin/manifest-types.ts:268`, validator `packages/dashboard-plugin-runtime/src/manifest-validator.ts:645-660`).

## Goals / Non-Goals

**Goals:**
- Core names no subagent contract identifier (D9 denylist). Every seam is generic and keyed by plugin id, manifest-declared event type, or claimed tool name.
- A long, windowed session shows correct background rows (identity is always carried or pinned) and the stream of every open agent, within the carry bound.
- Terminal subagent frames are never orphaned by truncation or by a saturated socket.

**Non-Goals:**
- Changing the producer. No release is needed; the target is the 0.8.1 contract as it stands, with a floor of 0.7.0.
- A synthesized per-subagent stop answer (owner decision). The plugin's verdict combiner is deleted (D6), because no producer supplies verdicts. A stop settles through the subagent's terminal frame and the background registry snapshot.
- Moving the central plugin route-tier table (`packages/shared/src/route-tiers.ts`). It lists routes for every plugin by design (google, obs-studio, automation) and is the reviewed security registry, so it stays.
- Word-level purging of "subagent" from role names, settings labels, i18n and comments. The boundary is about contract identifiers (D9).

## Decisions

### D1. Manifest-declared event-type ownership
The manifest `eventTypes` list, which already exists, becomes the source of ownership for bridge, server and client.
- The bridge reads no manifests (`packages/extension` depends only on `shared`; the manifest reader is server-side, `packages/dashboard-plugin-runtime/src/server/loader.ts`). So on `session_register` the **server sends each bridge a `plugin_ownership { eventTypes: {pattern → pluginId}, toolClaims: {toolName → pluginId} }` table** built from the loaded manifests.
  - The forward registry then accepts a declaration whose `as` matches an owned pattern only from the owning `pluginId`. Declarations that arrive before the table are held and evaluated when it arrives.
  - The server also checks ownership on ingest: an `event_forward` of an owned type must carry the owning `pluginId`, which the registry stamps on every plugin-declared forward.
  - Matching names are removed from `RESERVED_EVENT_TYPES`; ownership replaces the reservation.
- The subagents plugin declares the four lifecycle channels as `latest` keyed by `id` with `group: "lifecycle"`. This is a new optional declaration field: channels in one group share a single latest slot per key, newest across channels. That is exactly today's `pending` semantics, where a terminal frame supersedes created/started.
- Retention budgets become per plugin (64 keys each, or a declared `maxKeys` up to 256) instead of 64 across all plugins, so one plugin's open agents can't evict another plugin's state. The subagents plugin declares `maxKeys: 256`: 1 lifecycle key plus 1 entry/delta stream key per agent, about 128 agents, above today's 64-agent `pending` bound.
- *Trust:* `pluginId` on the bus is self-asserted. Spoofing it requires code running in the pi process, which already has core-equivalent power. Documented as a trade-off, not defended against.
- *Alternative:* keep core reservations and add an `ownsEventTypes` field. Rejected: it duplicates `eventTypes`.

### D2. Windowed-replay carry as a separate frame
Plugin servers can register `ctx.registerReplayCarry(handler)`. For a windowed subscribe, core calls `handler({ sessionId, gapFromSeq, gapToSeq, tail, getGapEvents })` after sending `history_window` and before the first `event_replay`.
- The handler returns an ordered list of stored gap events, in the plugin's priority order. Core keeps only events of types the plugin owns, truncates the list to 2000 events / 2 MiB in the order given, and sends one `plugin_event_carry { sessionId, pluginId, events }` frame on the same path and class as `event_replay`, so it can't be reordered after the replay batches. One budget is shared across plugins in registration order.
- The client applies carried events **only** through the owning plugin's reducer slice and finalizer. It does not touch chat rows, `maxSeq` or gap bookkeeping, so the head/tail model is unchanged.
- Slice arms must be idempotent: entries are placed by `index`, deltas by `offset`, created/started merge first-wins. A later backfill of the same seqs is therefore harmless without seq dedup.
- The subagents handler returns, for each agent not terminal before the tail, in this order:
  1. `subagent_created` and the latest `subagent_started` for every agent;
  2. then entries, newest-run first;
  3. then the open block's deltas.

  Under the bound, identity frames survive first.
- **Agents that end inside the gap.** The handler also carries the terminal frame of every agent that has a frame in the head and whose terminal frame lies in the gap. Otherwise such a row would stay running.
- **Budget and time.** Each plugin gets its own budget of 2000 events / 2 MiB, so one plugin can't starve another. Handlers may be async. A result arriving after 200 ms is discarded and logged, because a synchronous handler can't be pre-empted.
- **Client path.** A dedicated `plugin_event_carry` handler in `useMessageHandler` calls only the named plugin's slice reducer and `onSessionEvent` finalizer. It does not use the `event_replay` dispatch, so it never creates chat rows or touches seq/gap state. A finalizer may still update an existing tool row, for example a carried terminal frame finalizing its `Agent` card.
- **Trimmed gaps.** The store may already have trimmed the gap middle (`subscription-handler.ts:445-484` reports the resident array). D3 `retain` pins each open agent's identity frames against trimming, so the created/started frames survive. Trimmed entries can't be carried, and that limit is accepted.
- Failure isolation: a handler that throws or exceeds 200 ms is skipped and logged.

### D3. Plugin store policy
`ctx.registerStorePolicy(policy)` is called by the store only for owned event types:
- `identity(event)` returns scalar fields to keep in an over-size placeholder. Each field is at most 256 B, so the placeholder stays bounded.
- `elide(event, view)` returns a reduced copy, or `undefined`. `view` gives read access to resident events of owned types (for the resident-step check).
- `onStored(event, view)` returns seqs of owned events to drop (`collapseStreamDeltas`).
- `retain(event, view)` pins an owned event against store trimming, capped at 500 per session. Subagents pins the created and latest started frame of each open agent.
- `bound(event)` returns the stream-specific bound for an owned streamed event (today `boundStreamDelta` for `subagent_delta`, `memory-event-store.ts:1096-1105,1154`).
- `vetoSupersede(end, tailUpdate)` returns `true` to keep a retained tail update that a tool end would otherwise subsume (today `endSubsumesUnlessAgentTail`, `:626-629,1688-1692`, and the `creatingSeq` resident pin, `:1617`).
- `isCarrier(event)` replaces the `isSubagentCarrier` and `details.agentId` structural checks (`:1040-1041,1249,1260,1581`).
- The complete inventory of subagent logic in `memory-event-store.ts` moves behind these hooks; task 3.2 lists each site.
- `identity` is also used by the core tool-call heal (`session-end-orphan-heal`): a synthesized `tool_execution_end` for a claimed tool carries the identity fields recovered from the call's latest `partialResult.details` (`agentId` for `Agent`), so `open-tool-calls.ts` no longer names `agentId`.

Core keeps the generic ceiling, the per-string caps and the placeholder. The subagents plugin ports its entries elision (resident-step, valid-count and no-mutation rules unchanged), its delta collapse, and `identity = { id, agentId, status, details.status }`. Telemetry is deleted.
- *Alternative:* a declarative `trim: {dropPath}`. Rejected: it can't express the resident-step check or the delta collapse.

### D4. Plugin session-end heal through a new `ctx.onSessionStatusEnded` and `ctx.appendEvent`
- `ctx.onSessionEnded` keeps its current `onUnregister` semantics, including the no-record path that goal-supervisor and automation rely on (`event-wiring.ts:773-776`, spec `goal-supervisor`).
- A **new** `ctx.onSessionStatusEnded` is fanned from the same `sessionManager.onEnded` seam the core tool-call heal uses. It fires on every `onEnded` call, which includes `unregister()`, `update({status:"ended"})` and a later `reasonChanged` re-fire (`memory-session-manager.ts:569,605-606`), and skips `movedTo`. Handlers must be idempotent, and the subagent heal is: it synthesizes only for still-open agents.
- While the session is replaying, `appendEvent` stores without broadcasting, matching the current heal (`event-wiring.ts:697-714`).
- `ctx.appendEvent(sessionId, event)` stores and broadcasts an owned event type.
- The subagents plugin moves `findOpenSubagents` and `synthesizeSessionEndedSubagentFail` into its server and subscribes to `onSessionStatusEnded`. The core subagent heal call (`event-wiring.ts:708`) is removed.

### D5. Per-tool `tool_execution_update` filter
A plugin bridge declares `dashboard:register-tool-update-filter { pluginId, toolName, dropPaths, when? }` (data only).
- It is accepted only from the plugin that `plugin_ownership.toolClaims` names for `toolName` (D1), so an unrelated plugin can't take over the `Agent` filter.
- The subagents plugin declares `toolName: "Agent"` and `dropPaths: ["partialResult.details.entries", "details.entries"]`, when status is in `queued`/`running`. Narrowing from tool-agnostic to `Agent` means any third-party tool whose updates carried `details.entries` with a queued/running status is no longer stripped. That is accepted: those bytes belong to that tool, and its plugin can declare its own filter.
- The bus-path strip and `PI_DASHBOARD_SUBAGENT_STRIP` are removed. There is no rollback flag; rollback is reverting the change.

### D6. Removals (no port)
- The throttle and its config/migration/health summary.
- The resync path on every protocol and in the client. `pairing/subagent-resync-routing.ts` is renamed to a generic requester registry, because `deliverPromptResyncReply` (`browser-gateway.ts:298,3159-3167`) still uses it.
- Tick telemetry, the dead re-exports, and the `tool-summary` entries for tools that don't exist (with their assertions in `packages/client/src/lib/__tests__/tool-summary.test.ts:34-41`).
- The stop-answer path: the plugin's verdict combiner, its `subagents:stop_result` declaration, and the session-side stop-answer requirements. No producer ever reports a verdict (`agent.ts:2736-2742`). The client's handling of a stored `subagent_stop_result` stays, for old streams.

### D7. Registry reconcile on `subagents:list`
- On `dashboard:bridge-ready`, the plugin bridge emits `subagents:list { out: undefined }`. An `out` that is still `undefined` after emit means **no answer** (no snapshot sent), never an empty registry.
- **Late producer.** When bridge-ready gets no answer, the bridge retries the query once, on the first `subagents:*` lifecycle emission it observes, which proves a producer is active.
- **Producer `idle`** (0.8.0 keep-alive: run ended, session alive) is forwarded as `idle`. The reconcile ends a running row with heal marker `idle`. Like `untracked`, that marker is revivable: a later live `subagent_started`, for example after `AgentControl steer` continues the run, makes the row running again. Task 4.3's no-regress rule exempts healed markers.
- **Single answerer.** The producer fills `out` from the first activation only (`agent.ts:2717-2722`), so with several activations on one bus the list can be partial. Accepted trade-off: the existing guard still applies (no change for a row with a live frame after `takenAt`), and multi-activation buses are rare (reload overlap).
- A defined `out` (possibly `[]`) is forwarded as `subagent_registry_snapshot { scope:"registry", entries:[{agentId,status}], takenAt, background:true }`.
- The plugin reconcile ends only **background** rows that are missing from the snapshot (`untracked`). Foreground rows keep the `Agent` tool-end and settle heals.

### D8. Client state slot and finalizer lookup
- `SessionState.pluginState: Map<pluginId, unknown>` replaces `subagents`. dashboard-plugin-runtime exports `useSessionPluginState`, and the plugin builds `useSessionSubagents` on top of it.
- Core resolves finalizers in two ways. For tool events it uses `toolName`, as today. For session events without a `toolName` it uses a new `findFinalizerForEventType(eventType)`, resolved from manifest ownership. `agent_settled` calls `onTurnSettled` on every registered finalizer. This removes the `"Agent"` literals.
- The `started` arm (plugin) reads `details.subagentType ?? data.type`, `details.description ?? data.description` and `details.displayName`, falling back to name, then short id, never `"unknown"`.

### D9. Producer floor and the contract denylist
- `requires.piExtensions` stays `string[]`. A new optional `requires.piExtensionVersions: Record<string, semverRange>` is added.
  - The installed version is read from the extension's installed `package.json` by the existing pi-extension probe and compared with `semver` (already a dependency of `server` and `shared`).
  - A local-path or git install without a valid version counts as satisfied, with a warning in the plugin status.
  - The 30 s probe cache applies. The subagents plugin sets `">=0.7.0"`. Below the floor, `missingRequirements` names the version and the shell's plugin surfaces show it, as for every plugin requirement (revised before merge: no plugin-side dock notice).
- A new tree-wide script, `scripts/check-subagent-boundary.mjs`, run by `npm test`, fails on a subagent contract identifier in `packages/{extension,server,shared,client,dashboard-plugin-runtime}/src`. It is separate from `check-conventions.mjs`, which is touched-files-only and capped at five rules (`scripts/check-conventions.mjs:9-14`).
  - Denylist, case-insensitive regex families: `subagent_[a-z_]+` (any subagent event or message type), `subagents:` (any channel), `subagent(state|statesnapshot|timelineentry|details|tickthrottle|heap)\w*`, `subagent_heap\w*`, `subagent_event_map`, `empty_subagents`, `usesessionsubagents`, `issubagentcarrier`, and `\.subagents\b` state access.
  - Tests, `generated/` and i18n are exempt.
  - A checked-in allowlist (`scripts/subagent-boundary-allowlist.json`, entries `{file, pattern, reason}`) is limited to cross-plugin registries: the route-tier table and the shipped `custom-event-groups.ts` pattern.

### D10. Delivery policy registered by the owner
A plugin server registers `ctx.registerDeliveryPolicy({ deferKey(event, sessionId), project(event) })` for owned types. `browser-gateway.ts` uses it instead of hard-coded `subagent_*` cases. A policy that throws counts as no key.
- The subagents plugin moves `projectDeferredSubagentFrame` (`browser-gateway.ts:236-260`, the scalar keep-list and the 8192-byte cut) into its policy unchanged.
- It keys `subagent_completed|failed` by `[sessionId, id, real|heal]`, `subagent_stop_result` by `[sessionId, agentId]` (old streams), and `subagent_registry_snapshot` by `[sessionId]`.
- *Alternative:* manifest `eventDelivery` with `dropPaths`. Rejected: it can't express the keep-list or the cut.

## Risks / Trade-offs

- [Carry inflates first paint on huge sessions] → bounded to 2000 events / 2 MiB, open agents only, priority-ordered, counted.
- [Ownership relies on a self-asserted `pluginId` on the bus] → only in-process code can spoof it, and that code already has core power. The server-sent ownership table and the server-side ingest check still block accidental collisions.
- [Without the bridge throttle the Agent tick rate doubles (2/s → 4/s per running subagent)] → this is the producer's designed cadence; ticks are small since 0.3.0 and D5 removes `entries`.
- [Producers 0.2.6–0.6.x stop rendering rows] → acceptable: they lack `subagents:list`. The shell lists the unmet range under the plugin's requirements.
- [No immediate stop answer] → the `Stopping…` notice clears on the subagent's terminal frame, or on the next registry snapshot for background runs. A ghost foreground row clears on tool end or settle.
- [An older cached client sends `subagent_resync_request`] → the server answers unknown messages with a no-op.
- [A slice arm that is not idempotent double-applies a carried event] → covered by a reducer test per arm (task 4.3).

- [`subagents:list` answered by one activation only] → partial snapshots on multi-activation buses, guarded by the live-frame-after-`takenAt` rule (D7).
- [The published dashboard-plugin-runtime API drops `useSessionSubagents`, `SubagentStateSnapshot` and `EMPTY_SUBAGENTS`] → BREAKING entry in CHANGELOG and a minor version bump of the runtime (pre-1.0). The only in-repo consumer is the subagents plugin (task 9.1).

## Migration Plan

1. Land the generic seams (D1 group and per-plugin budget, D2, D3, D4 seam fix, D5, D8 slot, D9 versions field, D10) alongside the existing code. They are unused at first.
2. Switch the subagents plugin onto the seams and delete the core subagent code in the same PR, so there is never a double path at runtime.
3. Config: the ignored `subagentTickThrottleMs` key is dropped on the next settings save.
4. Rollback: revert the PR. Stored events keep their shape; placeholders only gain identity fields.
