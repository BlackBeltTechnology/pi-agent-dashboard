## Why

pi 0.99 lets a tool run other tools: codemode scripts and `ctx.executeTool()`. Nested calls emit `tool_execution_start/update/end` with `parentToolCallId` and pi-assigned ids `<caller id>/<n>` (recursively, so grandchildren exist). They write **no transcript entries**; on replay they survive only as a bounded `nestedCalls` record on the root call's tool-result message. The dashboard handles none of this today:
- the reducer would create top-level cards that vanish on reload;
- the server sets `currentTool` to the nested tool and clears it on the nested end;
- the session-end orphan heal would synthesize top-level ends for legitimately unfinished nested calls;
- the `:toolCallId` result routes cannot carry a `/` id.

Depends on `update-pi-core-0-99-adopt-apis` (pi 0.99.1).

## What Changes

- Protocol: optional `parentToolCallId` on tool events (the bridge's generic serializer already carries it; covered by a test). The bridge stops forwarding nested `tool_call` / `tool_result` events (subagent fan-out admission still runs locally). Transcript replay keeps `nestedCalls` on the synthesized tool end. The event store keeps `nestedCalls` intact under retention truncation (a carve-out like the subagent-timeline one).
- Reducer: nested calls attach to their **root** call (first id segment) with their direct parent kept. Replay rebuilds them from `nestedCalls` (`ok` / `error` / `unfinished`, `argumentsBytes` note, `complete:false` notice). A parent's end marks still-running nested entries unfinished. Orphans are dropped. Nested entries never enter the top-level stuck/elided logic.
- Tool card renders the nested list.
- Server: `currentTool` ignores nested events (both `event-status-extraction` and `token-stats-pipeline` state it). The session-end heal skips nested starts.
- Nested ids are URL-encoded in `/tool-result` fetches (`useToolFullResult.ts`). The stale-tool reconcile skips nested calls. `/api/session-change` never serves nested calls: pi writes no transcript entry for them.
- Nested `bash` counts toward the session's in-flight bash indicator.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `event-reducer`: "Tool call state machine" scopes to top-level calls; new "Nested tool calls render inside their parent tool call".
- `event-status-extraction`: nested events do not change `currentTool`.
- `token-stats-pipeline`: "Event status extraction" states the same rule.
- `session-end-orphan-heal`: the heal ignores nested calls (modified derivation).
- `on-demand-session-replay`: window-edge elision applies to top-level starts only.
- `incremental-event-sync`: the stale running-tool reconcile skips nested calls.
- `in-memory-event-buffer`: nested-call records survive retention truncation.
- `bridge-extension`: nested `tool_call` / `tool_result` are not forwarded.

## Impact

- **Code:**
  - `packages/shared/src/protocol.ts`, `packages/shared/src/state-replay.ts`;
  - `packages/extension/src/bridge.ts` (enriched tool-event forwarding);
  - `packages/client/src/lib/chat/event-reducer.ts` + tool-card renderers + the tool-result fetch helper;
  - `packages/server/src/session/{event-status-extraction,open-tool-calls}.ts`, `packages/server/src/persistence/memory-event-store.ts`;
  - `packages/client/src/hooks/{useToolFullResult,useStaleToolReconcile,useInflightBashTools}.ts`;
  - backfill path.
- **Tests:** reducer, status-extraction, open-tool-calls, bridge forwarding, replay fixtures, and a tool-card component test.
- **Rollback:** revert. Old builds show nested calls as flat cards.

## Discipline Skills

`review-code` (cross-package diff: shared, extension, server, client).

Subagent checkpoints (not skills): `react-expert` (reducer state shape + tool-card rendering).
