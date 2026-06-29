## Why

Today the dashboard's "attach proposal" feature is purely server/UI metadata: `session.attachedProposal` drives the chip, the artifact letters, and auto-rename, but the pi agent running inside the session is never told. Users routinely hit the gap: they attach a change, prompt "continue", and the agent has no idea which change they mean — it has to ask, or guess from `openspec list`, or worse, work on the wrong one.

The agent also has no awareness of its own pi `sessionId` or `cwd` in a structured form, which blocks self-referential workflows (e.g. an agent inspecting its own dashboard state, or per-session state files keyed by sessionId).

Pi exposes the required hook: `before_agent_start` lets extensions replace the per-turn system prompt (stable since pi 0.69, present in the installed 0.80.2). The session id does NOT come from pi — pi's extension API exposes no `pi.sessionId`; the bridge already owns the dashboard session id as `bc.sessionId` (sourced from `ctx.sessionManager.getSessionId()`, read at every `sendStateSync` in `session-sync.ts`). We can close the gap with a small bridge-side injector and a one-line server-to-bridge replay — no upstream pi changes, no skill changes, no chat pollution.

## What Changes

- Bridge gains a `before_agent_start` handler that appends a small system-prompt fragment every turn, naming the active session (`sessionId`, `cwd`) and — when set — the attached OpenSpec change with the path to its artifacts.
- Server forwards attach/detach updates to the owning bridge over the existing pi-gateway channel (today `applyAttachProposal` only broadcasts `session_updated` to browsers). On every `session_register`, the server replays the current `attachedProposal` so a re-registering bridge picks up state after restart/reattach.
- Bridge `BridgeContext` gains `attachedChange: string | null`, kept in sync from server pushes and from the pre-existing `pendingAttachRegistry` consumed at first `session_register`.
- Detach is handled by the same path — next turn's SP fragment simply omits the attached-change line. No "you have been detached" message is injected.
- No changes to the openspec-* skills, no new files on disk, no new chat turns. Pure system-prompt contribution.

## Capabilities

### New Capabilities

- `agent-session-context-injection`: Bridge-side per-turn system-prompt fragment exposing `sessionId`, `cwd`, and the dashboard-attached OpenSpec change to the agent. Covers the `before_agent_start` handler, the SP fragment shape, the server→bridge attach-update protocol, and `session_register` replay.

### Modified Capabilities

- `proposal-attachment`: Attach/detach now propagates to the owning bridge in addition to broadcasting `session_updated` to browsers. The agent observes the attached change on the next turn via the new SP fragment. Detach silently removes the fragment line on the next turn.

## Impact

- **Protocol** (`packages/shared/src/protocol.ts`): one new server→bridge message variant carrying `{ sessionId, attachedChange: string | null }`.
- **Server** (`packages/server/src/`): `browser-handlers/session-meta-handler.ts::applyAttachProposal(sessionId, changeName, ctx)` (current signature; mutates via a `sessionManager` `updates` object, no direct `session.attachedProposal =` assignment) and the separate detach handler each push the new message through `piGateway` (already present in `ctx`). The `pending-attach-registry.ts` consumer in `event-wiring.ts::piGateway.onSessionRegistered` replays current `attachedProposal` on register — coexisting with the existing fork-parent inheritance / stamping logic in that hook.
- **Bridge** (`packages/extension/src/`): new `dashboard-context-injector.ts` registers a `before_agent_start` handler that reads `bc.sessionId` and `bc.attachedChange` (NOTE: `bridge.ts` already subscribes `before_agent_start` as a pass-through forwarder to the dashboard — pi chains handler results, so the new SP-mutating handler coexists). `bridge-context.ts` gains `attachedChange: string | null`. `bridge.ts` wires the new injector; the inbound `attach_proposal_changed` arm goes in the `command-handler.ts` dispatch `switch`.
- **Token cost**: ~30 tokens/turn for the always-on `sessionId`/`cwd` line, +~30 tokens/turn when an attached change is present. Negligible vs. existing AGENTS.md/skills payload.
- **No client/UI changes.**
- **No skill changes** — works with stock openspec-* skills because the agent simply has the change name in its context and can run those skills with that argument.
- **No upstream pi changes** — relies only on `before_agent_start` (stable since pi 0.69, present in 0.80.2). Session id comes from the bridge's own `bc.sessionId`, not from pi.
