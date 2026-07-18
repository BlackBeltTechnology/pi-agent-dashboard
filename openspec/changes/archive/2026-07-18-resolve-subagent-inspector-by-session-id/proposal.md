## Why

A foreground subagent run carries **two unrelated ids**, minted by different code and stored in different places:

- `agentId` — a **v4** `randomUUID()` minted in the producer (`@blackbelt-technology/pi-dashboard-subagents`, `extensions/agent.ts`). It is the **only** key of the parent session's `subagents` map (frames emit `id: agentId`; the bridge `SubagentFrameBuffer.agentIdOf` reads `data.id`; the client renderer reads `details.agentId`; the popout route reads `params.agentId`).
- The runner **session id** — a **v7** id minted by `createAgentSession` / `SessionManager` for the in-memory subagent session, which gets its own `.jsonl` (with a `parentSession` pointer, for `/resume`) and is **also** registered by the in-process bridge as a standalone `source=dashboard` gateway session. So the same run surfaces twice: a subagent card AND a session row.

The runner session id is **never written into the `subagents` map**. So `subagents.get(<v7 session id>)` structurally misses, and the subagent inspector renders the dead-end placeholder **"Subagent not found in this session."** for any id that is not a v4 agentId — including an ordinary session id reached via a shared/stale/hand-built deep-link URL `/session/:sessionId/subagent/:agentId`, or when a user tries to inspect the run by the session id they can see in the session list.

This is distinct from the already-fixed replay/resync gap (`subagent-live-detail-reliability`, variant A): that one is a hydration timing gap on the correct v4 key; resync fixes it. This proposal fixes variant B — the **identity-space collision** — which resync can never fix because the key was never in the map.

## What Changes

- **Producer (sibling repo `github.com/BlackBeltTechnology/pi-dashboard-subagents`, v0.2.3 — prerequisite):** add an optional `agentSessionId` field (from `createResult.session.id`) to **`AgentDetails`**, populated in `snapshotDetails()`. Because `AgentDetails` is the `details` payload of BOTH the live `subagents:*` frames AND the Agent tool's return (which becomes the `tool_execution_end` `details`), one producer edit reaches both consume paths — including the `tool_execution_end` **backfill** that rehydrates completed subagents after `/resume`/refresh (state-replay emits no `subagents:*` frames). A frame-only field would miss that backfill — the dominant real case. Tracked here for traceability; **not editable from this monorepo**.
- **Bridge frame buffer** (`packages/extension`): `SubagentFrameBuffer.resync(id)` resolves a request carrying **either** id against the SAME retained running-`snapshots` map it already keeps — by `agentId` key, else by a values-scan matching `snapshot.details.agentSessionId`. The mapping is **derived** from the snapshots map, not a separate tracked index, so it adds NO new bounded structure and cannot leak/diverge (it inherits the existing 64 logical-`agentId` bound). Unknown/finished stays a silent no-op.
- **Event reducer** (`packages/client/src/lib/event-reducer.ts`): when a subagent frame (and the `tool_execution_end` backfill) carries `agentSessionId`, the reduced `SubagentState` is indexed in `session.subagents` under **both** the `agentId` and the `agentSessionId` keys (same object reference), and stores `agentSessionId` on the state. Every `.get()` call site then resolves either id unchanged.
- **Inspector resync** (`AgentToolRenderer` + `SubagentPopoutClaim`): the resync request may send whichever id the surface holds (the route's `:agentId` may be a v7); the bridge resolves via the alias. No new call sites — the existing `subagent_resync_request` path is extended.
- **Dependency floor**: bump the recommended/installed `@blackbelt-technology/pi-dashboard-subagents` to `>= 0.2.3` so installs get the emit side. **Graceful degrade**: with an older producer (no `agentSessionId`), no alias key is created and behaviour is exactly as today — no regression, the fix is simply inert.

## Capabilities

### Modified Capabilities

- `subagent-live-detail-reliability`: A subagent's reduced state is **resolvable by its runner session id as well as its `agentId`** (dual-key). When frames carry the runner session id, the reducer aliases both keys to the same `SubagentState`, the bridge resync responder accepts either id, and the inspector route/card/popout resolve a v7 session id to the live timeline instead of the "Subagent not found" dead-end. Absent the field (older producer), single-key behaviour is preserved.

## Impact

- **Producer (sibling repo, out of edit scope)** — `@blackbelt-technology/pi-dashboard-subagents` `extensions/events.ts` (`AgentDetails` interface) + `extensions/agent.ts` (`snapshotDetails()`): add optional `agentSessionId: session.id` to `AgentDetails` so it rides both the `subagents:*` frames and the Agent tool's `tool_execution_end` details; publish `v0.2.3`.
- **Bridge frame buffer** — `packages/extension/src/subagent-frame-buffer.ts` (`SubagentFrameBuffer`): `resync(id)` accepts either id via a derived values-scan on the existing `snapshots` map; no new index, no new bound.
- **Bridge resync responder** — `packages/extension/src/bridge.ts` (`subagent_resync_request` handler ~L928): pass the incoming id (may be a v7) to the id-agnostic `resync()`; log both the incoming and the resolved `agentId`.
- **Event reducer** — `packages/client/src/lib/event-reducer.ts` (subagent frame arms read `details.agentSessionId` + the `tool_execution_end` `toolName === "Agent"` backfill reads `endDetails.agentSessionId`): dual-index `session.subagents` under both keys (same ref) and persist `agentSessionId` on `SubagentState`; keep `state.id` canonical (v4).
- **Consume-side types (in-repo, workspace-symlinked)** — `SubagentState` + the client `AgentDetails` mirror in `packages/subagents-plugin/src/client`: optional `agentSessionId` (local edit; `^0.5.4` resolves to the local package via the `packages/*` workspace symlink — no publish).
- **Inspector client** — `packages/subagents-plugin/src/client/` (`SubagentDetailView`, `SubagentPopoutClaim`, `SubagentPopoutPage`): lookups resolve either id (free once the reducer dual-indexes); resync sends the held id.
- **Card renderer** — `packages/client/src/components/tool-renderers/AgentToolRenderer.tsx`: `requestResyncIfStale` tolerates a v7 id in the `agentId` slot.
- **Dependency floor** — recommended-extensions / install manifest: `pi-dashboard-subagents >= 0.2.3`.
- **Specs referenced** — `subagent-live-detail-reliability` (resync + running-subagent map), `agent-tool-rendering` (the detail affordance).

## Non-Goals

- Suppressing the standalone `source=dashboard` gateway-session registration of the in-memory runner (the "same run appears twice" root). Considered and deferred — dual-key makes the run **inspectable by either id**, which is preferable to hiding one surface.
- Changing the v4 `agentId` minting.
- Resolving a runner session id used in the **parent** `:sessionId` slot of the route (only the `:agentId` slot is in scope).

## Discipline Skills

- `review-code` — non-trivial reducer + bridge change; review the diff and fix blocking findings before commit.
