## Context

pi 0.99.1 (`/tmp/pi099`):
- `ExtensionToolContext.executeTool` gives nested ids `<calling id>/<n>`; `tool_call`, `tool_result` and `tool_execution_*` events carry `parentToolCallId`;
- nested calls add no transcript entries;
- `NestedToolCalls { calls: NestedToolCallRecord[]; complete: boolean }` sits on the model-issued call's tool-result message and includes calls made by nested tools;
- record `{ id, name, arguments? | argumentsBytes, status: "ok"|"error"|"unfinished", durationMs?, error? }`, at most 256 calls (`NESTED_CALL_LIMITS`).

Server session-end heal: `packages/server/src/session/open-tool-calls.ts` (`findOpenToolCalls`), wired at `event-wiring.ts`. Result routes: `session-routes.ts:167` `/api/sessions/:sessionId/tool-result/:toolCallId`, `:190` `/api/session-change/:sessionId/:toolCallId`.

## Goals / Non-Goals

**Goals:** live and replayed views show nested calls consistently (a bounded record is signalled explicitly); no stuck or phantom cards; `currentTool` stays top-level.

**Non-Goals:** rendering nested results on replay (pi does not record them); changing how codemode itself is enabled.

## Decisions

### D1 — Root-owned nested list
```mermaid
flowchart LR
  L[live tool_execution_* + parentToolCallId] --> K[root = id.split('/')[0]]
  R[replay: toolResult.nestedCalls] --> K
  K --> S["ToolCallState(root).nested: {id, parentId, name, status, durationMs?, args|argumentsBytes, result?}"]
  S --> C[card: nested list, indented by parentId depth]
```
- Keyed by root because the replay record is flattened onto the model-issued call. Keeping `parentId` preserves the tree for display.
- The top-level map never holds nested ids, so stuck/elided/reconcile logic is unaffected by construction.
- Root end (any terminal status, including a heal) marks running nested entries `unfinished`.
- Replay merge: if live entries already exist (live then reload within a session), replay records replace them by id. `complete:false` shows "further nested calls not recorded".

### D2 — Server
- `event-status-extraction.ts`: early-return "no `currentTool` change" when `data.parentToolCallId` is set.
- `open-tool-calls.ts`: skip starts with `parentToolCallId` when deriving the open set.

### D3 — Wire, store and routes
- Add `parentToolCallId?: string` to the tool-event payload types. `mapEventToProtocol` → `extractSerializable` already copies it; a test pins that.
- The bridge skips forwarding `tool_call` / `tool_result` carrying `parentToolCallId`. They would otherwise land as raw-event rows and ship full nested results that pi itself does not record. Local `tool_call` handlers (fan-out admission) still run.
- Transcript replay (`state-replay.ts:159-186`) copies `nestedCalls` from the `toolResult` message onto the synthesized top-level end. The reducer attaches from `data.nestedCalls` on that end.
- Event store: add a `nestedCalls` carve-out beside `locateSubagentTimeline` (`memory-event-store.ts:958-964`). The generic pass clobbers arrays over 20 items (`:738`) and depth past 4 (`:719`). Degradation order under the per-event ceiling: drop `arguments` (keep `argumentsBytes`), then the oldest records (`complete:false`); never the parent result.
- `useToolFullResult.ts:30` encodes the id (`DiffPanel.tsx:124` already does). `useStaleToolReconcile.ts:188` never runs for nested ids, because the reconcile skips them. The server route param decodes `%2F`; a route test covers `call_1%2F1`. `/api/session-change` is not used for nested calls (no transcript entry).
- `selectInflightBashTools` also walks root `nested` lists for running `bash`.
- Late nested end after its root ended: the real end overwrites `unfinished`. Nested `tool_execution_update` refreshes the nested entry.
- Id fallback: when the first segment is not a known root, resolve recursively through `parentToolCallId` via the nested index; drop if unresolved.

## Risks / Trade-offs

- [Deep nesting inflates cards] → collapsed by default, showing a count; expand on demand.
- [Live-vs-replay count differs for >256 calls] → accepted pi limit, signalled by the not-recorded notice.
- [Ids from non-codemode extensions that do not follow `<caller>/<n>`] → fall back to `parentToolCallId` when the first segment is not a known root; drop if neither resolves.
