# Design

## Context

See proposal.md (Why). Facts the design builds on (paths under `packages/flows-plugin/src/` unless stated):

- **Attachment store** is client-only, per device: `client/flow-attach-store.ts:1-15`. `FlowAttachment = {id, name, source?, baselineStartedAt}` (`client/flow-idle-state.ts:167-173`). Consumption compares `baselineStartedAt` with the event clock (`isAttachmentConsumed`, `client/flow-idle-state.ts:160-164`); the picker writes `lastFlowStartedAt ?? 0`, or `null` on an empty stream (`client/useFlowActions.tsx:160-171`); a `null` baseline is resolved only when `FlowDashboardClaim` mounts for that session (`client/FlowDashboard.tsx:772-775`).
- **Slot resolution**: "unavailable" fires when a non-empty catalog lacks the attached name (`client/flow-idle-state.ts:219-221`).
- **Idle controls** (Run, Close) are `IdleControls` (`client/FlowDashboard.tsx:73-100`); the AUTO toggle is in the panel header (`client/FlowDashboard.tsx:328-339`). `FlowHeaderActions` renders `FlowEditMenu` unconditionally (`client/FlowHeaderActions.tsx:73`); Edit… sends `/skill:manage-flows <flowName>` (`client/useFlowActions.tsx:150-158`).
- **Idle definition fetch**: `client/FlowDashboard.tsx:593-619` → `fetchFlowFile`, which falls back to host `/api/pi-resource-file` (`client/flow-files.ts:47`). Host `/api/file?cwd=&path=` already reads any file inside a known cwd (`packages/server/src/routes/file-routes.ts:479-515`), so admitting an in-cwd path widens nothing on the host; the confinement below protects the plugin route's own contract.
- **Node file map**: `files.handlers[state.flowName]` (`client/flow-files.ts:100`), fed from `FlowFileRegistry.files()`.
- **File registry**: per-session allow-list; `report()` REPLACES the set (`server/flow-files.ts:107-133`); `allow()` stores the realpath (`server/flow-files.ts:112-116`, `canonical` at `:57`); `codeHandlerPaths` reads YAML with plain `fs` (`server/flow-files.ts:77-101`, read at `:82`); the report lane is `hubLocalOnly` (`server/flow-files.ts:235`); `/file` answers 409 "not reported yet" while `!registry.has(sessionId)` (`server/flow-files.ts:261-264`) and `/files` returns empty when `files()` is null (`:246-249`); content via `readFileGuarded` (`:271`). The registry is a private module const (`:197`); `RouteDeps.registry?` can inject one.
- **Server flow state**: `stateStore.applyEvent` has no production caller (`server/state-store.ts:44`; event wiring out of scope, `server/index.ts` ~222), so the server cannot tell whether a flow runs.
- **Catalog**: `requestCatalog(sessionId, {rediscover})` (`server/flow-catalog.ts:42,63`) silently returns false inside its ask cooldown (`:66`); `stateStore` has no subscribe API. `FlowCatalogEntry.source` is an unnormalized wire string (`flow-catalog-contract.ts:34-43`). Flow names are validated by `isValidFlowName` (`server/flow-control.ts:43-47`).
- **Bridge tool precedent**: `packages/browser-plugin/src/bridge/index.ts:160-167`; server takes `sessionId` from lane meta (`packages/browser-plugin/src/server/open-handler.ts:5-8,57`). Lane handlers may be async (`packages/server/src/plugin-request-lane.ts:142`); bridge lane timeout 15 s. pi tool definitions carry `description` and `promptGuidelines` (pi `types.d.ts:479-482`).
- **Fan-out**: `ctx.broadcastToSubscribers` → `broadcast` (`packages/server/src/server.ts:4286`); with identity enforced, `broadcastOwnerScoped` delivers only to sockets allowed to see that session and withholds frames for ownerless sessions (`packages/server/src/pairing/browser-gateway.ts:2775-2782`). Unknown frame types are transcript-class and may be shed (`browser-gateway.ts:98-172`), which `openspec/specs/ws-frame-delivery-policy/spec.md:10` reserves for recoverable frames.
- **Browser → server**: `ctx.registerBrowserHandler(type, (msg, ws))` (`server/index.ts:163`; owner map `packages/server/src/server.ts:4711`). Unlisted types default to tier `operate` (`packages/shared/src/ws-message-tiers.ts:139`). Every tier key must be in `SESSION_OWNED ∪ SESSION_LIST ∪ NON_SESSION` (`packages/server/src/identity/__tests__/ws-message-tiers.test.ts:12-17`, sets in `packages/server/src/identity/ws-message-scope.ts:31`); session-owned messages pass the owner gate (`browser-gateway.ts:2260`), which refuses a missing `sessionId`.
- **Always-mounted client host**: `shell-headless` (`openspec/specs/dashboard-shell-slots/spec.md:939`; mounted in `App.tsx`), used with `usePluginMessage` by `packages/browser-plugin/package.json:67`. `session-card-action-bar` is not mounted on mobile (`packages/client/src/components/session/SessionCard.tsx:1104,1215`).
- `manage-flows` ships with pi-flows (not tracked here).

## Goals / Non-Goals

**Goals:** honest delivery result; reuse of the idle panel pipeline; plugin-route exposure limited to the opened flow's own files inside the session cwd.

**Non-Goals:** see proposal (Out of scope). No change to host file routes.

## Decisions

### D1. Tool in the flows bridge; bridge knows if a flow runs
`flow_open` is registered with `pi.registerTool` in the flows bridge, with `description` + `promptGuidelines` carrying the "call after writing/inspecting a flow" guidance. The bridge tracks the active `runId` from pi-flows' own `flow:flow-started` and clears it only on a `flow:complete` carrying the same `runId` (a `status:"rejected"` complete has no `runId` and no prior start, so it never clears a running flow), and refuses `flow-running` locally (the server has no flow state). Otherwise `execute` sends `requestPluginServer("flows","flow/open",{flow?|path?})`; relative paths resolve against the tool context cwd. Missing request seam or lane error → `refused/unavailable`. `sessionId` comes only from lane meta.
*Alternative:* server-side running check. Rejected: `stateStore` is not fed flow events.

### D2. Admission order: validate → canonicalize → confine → name/type/size → guarded read
Lane registered `hubLocalOnly`; `ctx.readFileGuarded` absent → `unavailable`. `flow` must pass `isValidFlowName` (exported from `server/flow-control.ts`, today module-private at `:46`). Path: resolve against session cwd; `realpath`; directory → direct `flow.yaml|flow.yml`; regular file ≤ `MAX_FILE_BYTES` (`server/flow-files.ts:39`); `realpath` equals `realpath(cwd)` or starts with `realpath(cwd) + path.sep`. Only then read via `readFileGuarded` and parse; handler resolution reuses the `codeHandlerPaths` rules on that content. The admission read has no request-scoped caller (the guard treats it as internal); only derived paths leave the handler and the later `/file` read has a real caller. `not-a-flow` on a directory: `lstat` walk, depth 6, 20 hits, skip `node_modules`/`.git`, cwd-relative `candidates`.

### D3. Opened entries beside the report, one shared registry
`registerFlowFileRoutes` and the `flow/open` handler share one injected `FlowFileRegistry`. It gains per-session `opened: Map<displayName, {def, files, handlers, agents}>`; entries kept only when their realpath is inside `realpath(cwd)`. `has()` and `files()` count `opened` (no 409 / empty map for a never-reported session); `files()` returns `handlers[displayName]`; `report()` leaves `opened`; `retainOnly` drops both. Each `/file` read of an opened file re-`realpath`s, requires equality with the stored canonical path and confinement, then reads the stored canonical path. Residual race between that check and the guarded open is accepted (host `/api/file` reads the same in-cwd files anyway).

### D4. Catalog lookup with rediscovery; catalog-path collapse
`flow` miss → `requestCatalog(sessionId,{rediscover:true})` (retried if suppressed by cooldown), polling the store every 100 ms up to 1.5 s, then `unknown-flow`. Path → catalog collapse compares canonical paths with each catalog `source` resolved against the session cwd; a match sends the catalog name with `viewOnly: false`.

### D5. Delivery and acknowledgement
Server broadcasts `{type:"flows_open", sessionId, requestId, attachment:{name, source, viewOnly, baselineStartedAt: Date.now()}}` via `broadcastToSubscribers` (owner-scoped where identity is enforced). `frameClassOf` gets `case "flows_open": {cls:"state", key:"flows_open:<sessionId>"}` so the frame is never shed. Clients answer `flows_open_ack {sessionId, requestId}`; the type is added to `WS_MESSAGE_TIERS` as `observe` and to `SESSION_OWNED_MESSAGES`. Acks are collected per `ws` per requestId in a bounded pending map (max 64, dropped after the window). Fixed 1.5 s window → `shown{acks}` or `no-viewer`.
*Alternative:* `plugin_action` ack. Rejected: `flows-plugin` fixes it to six actions.

### D6. Listener in a `shell-headless` claim
New zero-UI claim `FlowOpenListener` on `shell-headless` subscribes with `usePluginMessage("flows_open", …)`, writes `setAttachment(sessionId, {id: newAttachmentId(), name, source, viewOnly, baselineStartedAt})` using the server-stamped baseline (call time, same host clock as event timestamps), so a flow started after the pin consumes it even when the session was off screen; then `setFlowCollapsed(sessionId, ["dashboard"], false)` and sends the ack. Bounded module-level requestId set (128) prevents double handling within a tab.

### D7. View-only panel
`FlowAttachment.viewOnly?: true` (parse coerces). `resolveFlowSlot` skips "unavailable" for view-only. `FlowDashboard` idle mode hides Run and AUTO for view-only; `FlowHeaderActions` gets a `viewOnly` prop that omits `FlowEditMenu`; a "view only - not registered" label sits in the header (mock frame 3). `fetchFlowFile(..., {noHostFallback: true})` for view-only. A view-only load error adds the "ask the agent to open it again" hint.

### D8. Rate limit + log
Per-session sliding window 10 calls / 10 s, cleaned on session end. One `logger.info` per call: `flow_open session=<id> kind=<flow|path> outcome=<…> reason=<…> acks=<n>`; never content. Bridge-side `flow-running` refusals are logged by the bridge at debug level only (no server round trip).

## Risks / Trade-offs

- [Server restart drops admitted paths; devices keep view-only attachments] → D7 hint; agent re-calls `flow_open`.
- [An ack means "stored", counted per tab] → field named `acks`; spec says one per tab.
- [A late ack after the window still pins] → `no-viewer` says "no viewer confirmed".
- [Ownerless session in an identity-enforced deployment] → frame withheld → `no-viewer` (spec states it).
- [Unvalidated parse may differ from pi-flows] → view-only label; no Run.
- [Agent spam] → rate limit; only the calling session changes.
- [Bridge misses a `flow:complete` (crash)] → `flow-running` sticks until the next `flow:flow-started`/`session_start`; reset on `session_start`.

## Migration Plan

Additive. Old clients ignore `flows_open` (→ `no-viewer`). Rollback = revert; stored `viewOnly` attachments then show "no longer available" with Close.
