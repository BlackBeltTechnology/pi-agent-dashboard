## Why

Flow agent details today open only as an in-page popover anchored on the agent card's eye button (`FlowAgentCard.tsx` → `<Popover>` → `<FlowAgentDetail>`). There is no way to keep a flow agent's full timeline open in a dedicated tab while continuing to work in the main session, no way to share a permalink to a specific agent run, and no parity with the subagent inspector (which today exists but is dispatched by a direct `App.tsx` import). Users running long flows want to monitor one agent's progress while the main view stays free for other work.

The same problem afflicts the existing `SubagentPopoutPage`: the shell directly imports it from `@blackbelt-technology/pi-dashboard-subagents-plugin` and registers a hand-coded `useRoute("/session/:sessionId/subagent/:agentId")` plus dispatch arms in both the desktop top-level overlay switch and the mobile `MobileShell.detailPanel`. Every plugin-owned page added this way bloats the shell, couples it to plugin internals, and re-introduces structural traps (e.g. nesting inside `selectedId`-gated JSX). The slot system was designed exactly to avoid this — we just never had a slot for plugin-owned URL routes.

This change introduces a `shell-overlay-route` slot in the frozen plugin taxonomy, migrates BOTH the subagent popout AND the flow agent popout to declare claims against it, and strips App.tsx of all plugin-page route knowledge. As a load-bearing prerequisite, subagent state moves out of the shell's central session-state reducer into a subagents-plugin reducer + context (mirror of `pluginize-flows-via-registry`), so the subagent popout claim can self-derive without reaching into shell state.

## What Changes

### Plugin-system primitives (this change introduces them)

- **NEW slot `shell-overlay-route`** added to the frozen slot taxonomy in `packages/shared/src/dashboard-plugin/slot-types.ts`. Multiplicity `many`; payload tier `react-only`. Each claim declares:
  - `component`: exported component name from the plugin's client entry.
  - `config.path`: wouter path pattern (e.g. `/session/:sid/flow/:flowId/agent/:agentId`).
  - `config.sessionParam` (optional, default `"sid"`): which URL param holds the session id, so the slot consumer can resolve `DashboardSession` metadata for the claim.
- **NEW props contract `SlotPropsMap["shell-overlay-route"]`** in `packages/shared/src/dashboard-plugin/slot-props.ts`: `{ params, session?, onBack, pluginContext }`.
- **NEW slot consumer `<ShellOverlayRouteSlot>`** in `packages/dashboard-plugin-runtime/src/slot-consumers.tsx`. Walks every `shell-overlay-route` claim, calls `useRoute(claim.config.path)` per claim, and renders the first match's component. Exposes companion hook `useShellOverlayRouteMatched(): boolean` so the shell can gate other rendering on "any plugin overlay route active".
- **NEW primitive `useShellSession(sessionId)`** exported from `@blackbelt-technology/dashboard-plugin-runtime`. Returns `DashboardSession | undefined` for any session id. Backed by a `ShellSessionsContext` populated by App.tsx with the live sessions Map. Narrow contract — metadata only (id, cwd, label, status); plugins reach for per-session derived state through their own reducer contexts, never through this primitive.
- **Manifest validator** in `packages/dashboard-plugin-runtime/src/manifest-validator.ts` recognizes `shell-overlay-route` claims, requires `component`, `config.path` (must start with `/`), and validates duplicates within a plugin.

### Subagents-plugin migration (mirror of `pluginize-flows-via-registry`)

- **NEW `packages/subagents-plugin/src/subagent-reducer.ts`** holding `isSubagentEvent(eventType)` and `reduceSubagentEvent(subagents: Map<string, SubagentState>, event): Map<string, SubagentState>`. Pure functions. Ported verbatim from the four `subagent_*` cases currently in `packages/client/src/lib/event-reducer.ts` and the `entry_persisted` backfill block that writes to `subagents`.
- **NEW `packages/subagents-plugin/src/reducer.ts`** barrel exporting the above (mirrors `packages/flows-plugin/src/reducer.ts`).
- **NEW subpath export `./reducer`** in `packages/subagents-plugin/package.json`.
- **NEW `packages/subagents-plugin/src/client/SubagentsSessionStateContext.tsx`** exposing `useSubagentsSessionState(sessionId): { subagents: ReadonlyMap<string, SubagentState> }` (uses `useSessionEvents(sessionId)` from the runtime + folds via `reduceSubagentEvent`). Mirrors `useFlowsSessionState`.
- **REMOVE** `subagents: Map<string, SubagentState>` field from `SessionState` in `packages/client/src/lib/event-reducer.ts`.
- **REMOVE** the `subagent_created` / `subagent_started` / `subagent_completed` / `subagent_failed` cases from the shell's event reducer.
- **REMOVE** the `entry_persisted` block that backfills `next.subagents` (its replacement lives inside the subagents-plugin reducer).
- **REMOVE** the `SubagentState` / `SubagentTimelineEntry` re-exports from `event-reducer.ts`. Consumers import from the plugin's `client` subpath.
- **MIGRATE** `SubagentDetailView` (already a shim over `MinimalChatView`) to either accept `{ subagents: ReadonlyMap<string, SubagentState> }` from a caller, or call `useSubagentsSessionState(sessionId)` internally. Pick the option that minimizes churn at existing call sites (`AgentToolRenderer` inline expand).
- **MIGRATE** `AgentToolRenderer` to read subagent state via `useSubagentsSessionState(session.id)` instead of `session.subagents`.

### Flows-plugin migration

- **NEW `packages/flows-plugin/src/client/FlowAgentPopoutClaim.tsx`** — slot-claim wrapper. Receives `{ params: { sid, flowId, agentId }, session?, onBack }`. Cold-open subscribes to the parent session via `usePluginSend({ type: "subscribe", sessionId, lastSeq: 0 })`. Reads flow state via `useFlowsSessionState(params.sid)`. Renders the existing `FlowAgentPopoutPage` body.
- **NEW manifest claim** in `packages/flows-plugin/package.json`:
  ```json
  { "slot": "shell-overlay-route",
    "component": "FlowAgentPopoutClaim",
    "config": { "path": "/session/:sid/flow/:flowId/agent/:agentId", "sessionParam": "sid" } }
  ```
- **`FlowAgentPopoutPage`** stays as the body component (chrome header + `FlowAgentDetail` + empty-state branches). Renamed prop API to take resolved `{ flow, agent, session, onBack }` so the claim does the lookups.
- **`FlowAgentCard`** gains an `mdiOpenInNew` popout button (already drafted). URL is built from props; clicking opens `window.open(url, "_blank")`. Disabled when `sessionId` or `flowId` are missing.

### Subagents-plugin claim

- **NEW `packages/subagents-plugin/src/client/SubagentPopoutClaim.tsx`** — slot-claim wrapper analogous to `FlowAgentPopoutClaim`. Self-subscribes, reads via `useSubagentsSessionState(params.sessionId)`, renders the existing `SubagentPopoutPage` body (whose prop API stays).
- **NEW manifest claim** in `packages/subagents-plugin/package.json`:
  ```json
  { "slot": "shell-overlay-route",
    "component": "SubagentPopoutClaim",
    "config": { "path": "/session/:sessionId/subagent/:agentId", "sessionParam": "sessionId" } }
  ```

### Shell strip (`packages/client/src/App.tsx`)

- **REMOVE** `import { SubagentPopoutPage } from "@blackbelt-technology/pi-dashboard-subagents-plugin/client"`.
- **REMOVE** the `useRoute("/session/:sessionId/subagent/:agentId")` call + `subagentPopoutSessionId` / `subagentPopoutAgentId` decoders.
- **REMOVE** the `useEffect` cold-open subscribe for the subagent popout.
- **REMOVE** all subagent-popout dispatch arms in both the desktop overlay switch and the mobile `detailPanel` switch.
- **REPLACE** `hasShellOverlayRoute = !!archiveMatch || !!specsMatch || ... || !!subagentPopoutMatch` with `useShellOverlayRouteMatched()`.
- **MOUNT** exactly one `<ShellOverlayRouteSlot>` at the top of the desktop overlay switch AND one at the top of the mobile `MobileShell.detailPanel`. When matched → render the slot's element; when not matched → fall through to existing landing/sessionDetail/etc.
- **WRAP** the tree in `<ShellSessionsProvider value={sessions}>` so `useShellSession()` resolves.

Result: App.tsx contains zero imports from `@blackbelt-technology/pi-dashboard-flows-plugin` or `@blackbelt-technology/pi-dashboard-subagents-plugin` for popout pages. The only thing left for plugin-owned routes is the single generic slot mount.

## Capabilities

### New Capabilities

- `shell-overlay-route`: Plugin-owned full-screen URL routes mounted at the top of the shell's overlay dispatch on both desktop and mobile. Covers the slot taxonomy entry (multiplicity, payload tier, claim schema with `config.path` and `config.sessionParam`), the `<ShellOverlayRouteSlot>` consumer + `useShellOverlayRouteMatched` hook, the `useShellSession` primitive for metadata access from inside a claim, and the claim-resolution contract (first wouter-path match wins).
- `flow-agent-popout`: Fullscreen popout page for a single flow agent. Covers the popout button on the agent card, the slot claim with path `/session/:sid/flow/:flowId/agent/:agentId`, page chrome, four empty-state branches, and explicit cold-open subscription from inside the claim.
- `subagents-plugin-state`: Plugin-owned reducer + context for per-session subagent state. Mirrors `pluginize-flows-via-registry` — pure `reduceSubagentEvent`, `useSubagentsSessionState(sessionId)` hook reading from `useSessionEvents`, no shell knowledge of subagent state shape.

### Modified Capabilities

- `url-routing`: Adds the structural requirement that plugin-owned overlay routes are dispatched exclusively via the `shell-overlay-route` slot. The shell SHALL NOT register `useRoute` hooks for plugin-owned paths, SHALL NOT import plugin popout components, and SHALL mount exactly one `<ShellOverlayRouteSlot>` per layout (desktop top-level, mobile `detailPanel`). Pre-existing direct-dispatch code for `SubagentPopoutPage` is removed.

(Originally drafted to also modify `flow-agent-detail`; the popout reuses the existing component in a new mounting site via the slot, no requirement-level change to the detail-renderer capability.)

## Impact

- **Code**:
  - `packages/shared/src/dashboard-plugin/slot-types.ts` — `shell-overlay-route` entry.
  - `packages/shared/src/dashboard-plugin/slot-props.ts` — props contract.
  - `packages/dashboard-plugin-runtime/src/manifest-validator.ts` — validation for `shell-overlay-route` claims.
  - `packages/dashboard-plugin-runtime/src/slot-consumers.tsx` — `<ShellOverlayRouteSlot>` + `useShellOverlayRouteMatched`.
  - `packages/dashboard-plugin-runtime/src/shell-sessions-context.tsx` (NEW) — `ShellSessionsProvider` + `useShellSession`.
  - `packages/dashboard-plugin-runtime/src/index.ts` — re-exports.
  - `packages/subagents-plugin/src/subagent-reducer.ts` (NEW).
  - `packages/subagents-plugin/src/reducer.ts` (NEW barrel).
  - `packages/subagents-plugin/package.json` — `./reducer` subpath + `shell-overlay-route` claim.
  - `packages/subagents-plugin/src/client/SubagentsSessionStateContext.tsx` (NEW).
  - `packages/subagents-plugin/src/client/SubagentPopoutClaim.tsx` (NEW).
  - `packages/subagents-plugin/src/client/index.tsx` — exports.
  - `packages/subagents-plugin/src/client/SubagentDetailView.tsx` — switch to plugin context for `subagents` lookup.
  - `packages/flows-plugin/src/client/FlowAgentPopoutClaim.tsx` (NEW).
  - `packages/flows-plugin/src/client/FlowAgentPopoutPage.tsx` (already drafted; body component).
  - `packages/flows-plugin/src/client/FlowAgentCard.tsx` (already drafted; popout button).
  - `packages/flows-plugin/package.json` — `shell-overlay-route` claim.
  - `packages/flows-plugin/src/client/index.tsx` — exports.
  - `packages/client/src/App.tsx` — strip subagent + flow popout dispatch; mount `<ShellOverlayRouteSlot>`; wrap in `ShellSessionsProvider`.
  - `packages/client/src/lib/event-reducer.ts` — remove subagent cases + field + re-exports.
- **APIs / protocols**: none. All on-the-wire types unchanged.
- **Plugin contract**: ONE new slot id + ONE new primitive. Both are additive in the v0.x slot taxonomy (minor bump).
- **Tests**:
  - Unit: `ShellOverlayRouteSlot` claim matching, `useShellOverlayRouteMatched` aggregation, `useShellSession` provider.
  - Unit: `reduceSubagentEvent` covering the four lifecycle events + entry_persisted backfill, structurally identical to the removed shell-reducer tests (which migrate from `event-reducer.test.ts` to `subagents-plugin/src/__tests__/subagent-reducer.test.ts`).
  - Unit: `useSubagentsSessionState` returns expected state shape from a fake event stream.
  - Unit: `FlowAgentPopoutClaim` / `SubagentPopoutClaim` empty-state branches (mirror today's popout-page tests).
  - Smoke: desktop + mobile routing tests assert `/session/.../subagent/...` and `/session/.../flow/.../agent/...` both render the popout component and NOT `LandingPage`.
- **Docs**: file-index rows for every new file under `packages/dashboard-plugin-runtime/`, `packages/subagents-plugin/`, `packages/flows-plugin/`. Caveman style. Delegated to subagent per AGENTS.md protocol.
- **Dependency on `extract-minimal-chat-view`**: this change ships AFTER. `FlowAgentDetail` (used by `FlowAgentPopoutPage`) is the shim over `MinimalChatView` from that change.
- **Dependency on `add-subagent-inspector`**: independent. That change established the popout requirement; this change re-implements its dispatch via the slot.
- **Risk**: medium. The subagent-reducer migration touches a load-bearing field on `SessionState`; getting it wrong breaks every subagent-rendering surface (AgentToolRenderer inline expand, popout page, BackgroundSubagentsPanel rows). Mitigated by the strict structural mirror of `pluginize-flows-via-registry` and targeted tests at the migration boundary.
