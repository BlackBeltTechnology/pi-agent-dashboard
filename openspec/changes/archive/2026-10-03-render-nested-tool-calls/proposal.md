## Why

pi 0.99 lets a tool run other tools: codemode scripts and `ctx.executeTool()`. Nested calls emit `tool_execution_start/update/end` with `parentToolCallId` and pi-assigned ids `<caller id>/<n>` (recursively, so grandchildren exist). They write **no transcript entries**; on replay they survive only as a bounded `nestedCalls` record on the root call's tool-result message. The dashboard handles none of this today:
- the reducer would create top-level cards that vanish on reload, and a nested start would flush streaming text mid-message;
- the server sets `currentTool` to the nested tool and clears it on the nested end;
- the session-end orphan heal would synthesize top-level ends for legitimately unfinished nested calls;
- the event store's generic truncation collapses a `nestedCalls` record of more than 20 calls to a string;
- the `:toolCallId` result routes cannot carry a `/` id unless it is encoded.

Depends on `update-pi-core-1-0-adopt-apis` (pi 1.0.0 floor). The nested-call API is identical in 1.0.0 and 0.99.1 (see design.md Context).

## What Changes

- Protocol: no type change. `DashboardEvent.data` is untyped (`packages/shared/src/types.ts:714`), and the bridge's generic serializer already copies `parentToolCallId`; a new forwarder test pins this. Nested `tool_call` / `tool_result` are forwarded like top-level ones and stay hidden debug rows. pi puts `nestedCalls` on the live toolResult `message_start`/`message_end`; transcript replay keeps it on the synthesized tool end. The event store's generic truncation pass leaves `nestedCalls.calls` intact (a carve-out like the subagent-timeline one; not a ceiling exemption).
- Reducer: nested calls attach to their **root** call (first id segment) with their direct parent kept. Records (live toolResult message or replay) merge into the list (`ok` / `error` / `unfinished`, `argumentsBytes` note, and an incomplete-record notice when `complete:false`). No nested entry stays running once its root is terminal or elided. Orphans are dropped. Nested entries never enter the top-level stuck/elided logic, and a nested start never flushes streaming text. Nested results use the same truncation and full-output affordance as top-level results. Nested events never change the client's `SessionState.currentTool`.
- Tool card renders the nested list.
- Server: `currentTool` ignores nested events (both `event-status-extraction` and `token-stats-pipeline` state it, and `prompt-derived-tool-state` scopes its `tool_execution_end` clearing writer to top-level ends). The session-end heal skips nested starts.
- Nested ids are URL-encoded in `/tool-result` fetches (`useToolFullResult.ts`). The stale-tool reconcile skips nested calls. `/api/session-change` never serves nested calls: pi writes no transcript entry for them.
- Nested `bash` counts toward the session's in-flight bash indicator.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `event-reducer`: "Tool call state machine" scopes to top-level calls; "Streaming text flushed at tool_execution_start" scopes to top-level starts; new "Nested tool calls render inside their parent tool call".
- `event-status-extraction`: nested events do not change `currentTool`.
- `token-stats-pipeline`: "Event status extraction" states the same rule.
- `prompt-derived-tool-state`: the `tool_execution_end` clearing writer is top-level only (`agent_start`/`agent_end` unchanged).
- `session-end-orphan-heal`: the heal ignores nested calls (modified derivation).
- `on-demand-session-replay`: window-edge elision applies to top-level starts only.
- `incremental-event-sync`: the stale running-tool reconcile skips nested calls.
- `in-memory-event-buffer`: the generic truncation pass leaves nested-call records intact.

## Impact

- **Code:**
  - `packages/shared/src/state-replay.ts`;
  - `packages/extension/src/event-forwarder.ts` (test only);
  - `packages/client/src/lib/chat/event-reducer.ts` + tool-card renderers + the tool-result fetch helper;
  - `packages/server/src/session/{event-status-extraction,open-tool-calls}.ts`, `packages/server/src/persistence/memory-event-store.ts`;
  - `packages/client/src/hooks/{useToolFullResult,useStaleToolReconcile,useInflightBashTools}.ts`.
- **Tests:** reducer, status-extraction, open-tool-calls, forwarder, store, route, replay fixtures, and a tool-card component test.
- **Rollback:** revert. Old builds show nested calls as flat cards.

## Discipline Skills

`review-code` (cross-package diff: shared, extension, server, client).

Subagent checkpoints (not skills): `react-expert` (reducer state shape + tool-card rendering).
