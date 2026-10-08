## Context

pi 1.0.0, verified 2026-10-02 by diffing the published 0.99.1 and 1.0.0 tarballs:
- `@earendil-works/pi-coding-agent@1.0.0` `dist/core/nested-tool-calls.d.ts` is byte-identical to 0.99.1;
- `@earendil-works/pi-ai@1.0.0` `NestedToolCallRecord` / `NestedToolCalls` are identical to 0.99.1, with `nestedCalls?: NestedToolCalls` on `ToolResultMessage` (`dist/types.d.ts:426`).

The repo still installs pi 0.86.1 until `update-pi-core-1-0-adopt-apis` lands. That change only raises the floor; it treats nested calls as out of scope.

The API:
- `ExtensionToolContext.executeTool` (`dist/core/extensions/types.d.ts:280`) gives nested ids `<calling id>/<n>`. `tool_call`, `tool_result` and `tool_execution_*` events carry `parentToolCallId`.
- Nested calls add no transcript entries.
- A nested `tool_execution_end` carries the full `result: AgentToolResult` (`NestedToolExecutionEvent`, `nested-tool-calls.d.ts`).
- `NestedToolCalls { calls: NestedToolCallRecord[]; complete: boolean }` sits on the model-issued call's tool-result message and includes calls made by nested tools. It is written only when that call finishes. pi attaches it on the toolResult `message_start` (`dist/core/agent-session.js:696-708`), so live it rides `message_start`/`message_end` with `message.role === "toolResult"`. The root's `tool_execution_end` does not carry it.
- Record shape: `{ id, name, arguments? | argumentsBytes, status: "ok"|"error"|"unfinished", durationMs?, error? }`.
- `NESTED_CALL_LIMITS` (`dist/core/nested-tool-calls.js:16-21`): 256 calls, 8 KiB arguments per call, 32 KiB in total, 500-character errors.
- `complete` is false when calls were dropped, arguments were omitted, or calls had not finished. A `false` flag alone does not say which.

Server code:
- Session-end heal: `packages/server/src/session/open-tool-calls.ts:47` (`findOpenToolCalls`), wired at `packages/server/src/event-wiring.ts:576`.
- Result routes:
  - `packages/server/src/routes/session-routes.ts:200`: `/api/sessions/:sessionId/tool-result/:toolCallId`, served from the stored `tool_execution_end` via `findToolEndEvent` (`memory-event-store.ts:1870`).
  - `:226`: `/api/session-change/:sessionId/:toolCallId`.
- Fastify decodes `%2F` into one `:toolCallId` param; a raw `/` 404s.

## Goals / Non-Goals

**Goals:**
- Live and replayed views show nested calls consistently, and an incomplete record is signalled explicitly.
- No stuck or phantom cards.
- `currentTool` stays top-level.

**Non-Goals:**
- Rendering nested results on **transcript** replay (pi does not record them). Replay from the dashboard store keeps the live nested events and their results.
- Changing how codemode itself is enabled.
- Filtering nested `tool_call` / `tool_result` at the bridge. They forward 1:1, like top-level ones, under `catch-all-event-forwarding`, and render only as hidden debug rows (`hide-debug-events`).

## Decisions

### D1 — Root-owned nested list
```mermaid
flowchart LR
  L[live tool_execution_* + parentToolCallId] --> K[root = id.split('/')[0]]
  R["record: toolResult message.nestedCalls (live) / synthesized end (replay)"] --> K
  K --> S["ToolCallState(root).nested: NestedCallState {id, parentId, name, status: running|complete|error|unfinished, startedAt?, durationMs?, args|argumentsBytes, result?}"]
  S --> C[card: nested list, indented by parentId depth]
```
- The list is keyed by root because the replay record is flattened onto the model-issued call. Keeping `parentId` preserves the tree for display.
- Only an event carrying `parentToolCallId` is nested. A top-level id that happens to contain `/` stays top-level.
- Record-sourced entries have no `parentToolCallId` (`NestedToolCallRecord` has none). Their `parentId` is the id minus its last `/` segment (`call_1/1/2` → `call_1/1`).
- The top-level map never holds nested ids, so stuck/elided/reconcile logic is unaffected by construction. This applies to start, update and end alike.
- `NestedCallState.status` is its own union: `running | complete | error | unfinished`. `unfinished` renders neutral (neither spinner nor error). `ToolCallState.status` is unchanged.
- **Invariant:** no nested entry is `running` while its root is terminal (complete / error / elided, including a heal). This is enforced at every root transition and after every record merge. A nested start for such a root is created `unfinished`. Nothing else would ever close it, because the reconcile and the heal both skip nested calls.
- Record merge: a record arrives from the live toolResult `message_start`/`message_end` or from the replay-synthesized end.
  - A record id with a live entry replaces its status and duration, and the live result is kept.
  - A record id with no live entry is created from the record. This covers a dropped live start and a client that joined after the root started.
  - Live entries absent from the record are kept.
  - The invariant above is then applied.
- When the record's `complete` is false, the card shows a generic notice, "nested-call record incomplete". Per-entry markers (`unfinished`, "arguments omitted (N bytes)") explain what they can. The notice never claims that calls were dropped.
- An orphan `tool_execution_end` carrying `nestedCalls` with no root row (window edge) creates nothing. Existing orphan-end handling applies.
- Nested events never change the client's `SessionState.currentTool`, which the reducer sets at `event-reducer.ts:2176` and clears at `:2325`. They return before that assignment.
- A nested `tool_execution_start` never triggers the streaming-text flush (`event-reducer.ts:670-704`). The flush exists to order a top-level `toolResult` row; a nested start pushes no row.
- Nested results use the same last-lines truncation and full-output affordance as top-level results. The fetch is D3's encoded `/tool-result`.

### D2 — Server
- `event-status-extraction.ts`: `extractRawSessionUpdates` returns `null` for `tool_execution_start` / `tool_execution_end` carrying `data.parentToolCallId`. The pending-prompt fold in `extractSessionUpdates` (`:70-78`) then does not run, which is correct: the fold only rewrites an update that clears `currentTool`, and a nested event clears nothing.
- `open-tool-calls.ts`: starts with `parentToolCallId` are skipped when deriving the open set.
- Deliberately unchanged: `detectOpenSpecActivity` (`event-wiring.ts:1079`) and the canvas accumulator (`canvas/canvas-accumulator.ts:171`) still see nested starts. A codemode script that runs `openspec` or writes a deliverable is real agent activity.

### D3 — Wire, store and routes
- No protocol type change: `DashboardEvent.data` is `Record<string, unknown>` (`packages/shared/src/types.ts:714`). `extractSerializable` (`packages/extension/src/event-forwarder.ts:7`) copies top-level fields, so `parentToolCallId` already rides `event_forward`; a new forwarder test pins it.
- **New:** transcript replay (`state-replay.ts:159-186`, which today emits only `toolCallId/toolName/result/isError/images/details`) SHALL copy `message.nestedCalls` from the `toolResult` message onto the synthesized top-level end. The reducer attaches from `data.nestedCalls` on that end.
- Event store: a `nestedCalls` carve-out. Unlike `locateSubagentTimeline` (`memory-event-store.ts:964-985`), it does not early-return before the generic pass, because that would skip the per-string caps on the rest of the message. Instead, `truncateStrings` recognizes the `nestedCalls` envelope (`{ calls: array, complete: boolean }` under a `nestedCalls` key) and exempts `data.nestedCalls.calls` (and `data.message.nestedCalls.calls`) from the generic pass's array clobber (`:738`, more than 20 items). Each record is passed through `truncateStrings` as its own root, so depth is counted from the record. Its scalar fields therefore never collapse, and its `arguments` keep the normal per-string and depth bounds (`summarizeAtDepthLimit`, `:715`) relative to the record. Deep sub-trees are never returned raw. This mirrors the base64 exemption scoped to the generic pass (`openspec/specs/in-memory-event-buffer/spec.md:64`). It is **not** a ceiling exemption: an event still over `MAX_EVENT_DATA_SIZE` falls through to the existing "all other events" bound. pi's limits keep typical records far below the 256 KiB ceiling. The worst case is about 32 KiB of arguments plus 256 errors of 500 UTF-16 units each; escape-heavy or non-ASCII errors could exceed the ceiling. That case is a Risk below.
- `useToolFullResult.ts:30` will encode the id (it does not today) (`packages/client/src/components/diff/DiffPanel.tsx:124` already does). `useStaleToolReconcile.ts:188` fetches unencoded, but it never sees nested ids, because the reconcile skips them. A route test covers `call_1%2F1`. The stored nested end's `result` has the same object `ToolResult` shape as a top-level live end (`packages/extension/src/bridge.ts:2719`), so the route and the client need no new projection. `/api/session-change` is not used for nested calls (no transcript entry).
- `selectInflightBashTools` (`useInflightBashTools.ts:43`) also walks each root's `nested` list for running `bash`, using the live entry's `startedAt` and `args`. Record-sourced entries are never `running`: a record arrives only after its root finished.
- A late nested end after its root ended: the real end overwrites `unfinished`. A nested `tool_execution_update` refreshes the nested entry.
- Id fallback: when the first segment is not a known root, the id is resolved recursively through `parentToolCallId` via the nested index. An unresolved id is dropped.

## Risks / Trade-offs

- [Deep nesting inflates cards] → collapsed by default, showing a count; expand on demand.
- [Live-vs-replay count differs for more than 256 calls] → accepted pi limit, signalled by the incomplete-record notice.
- [Ids from non-codemode extensions that do not follow `<caller>/<n>`] → fall back to `parentToolCallId` when the first segment is not a known root; drop if neither resolves.
- [Root call never finishes (pi crashed mid-call)] → pi writes no `nestedCalls`, so a **transcript** replay shows no nested entries; replay from the dashboard store still has the live nested events. Accepted: pi recorded nothing.
- [Nested `ask_user` inside codemode] → `currentTool` stays `codemode` while the prompt is pending. The `chat-view` hide pairing is positional (`collapse-retried-errors.ts:124-140`), so the codemode card is hidden while the nested prompt is pending, exactly as a top-level `ask_user` card is. Accepted: `currentTool` is top-level by contract.
- [Pathological record over the per-event ceiling] → the existing "all other events" placeholder erases that event's data, record included. The root shows its other events' state without a nested list from that record; live nested entries already received stay. Accepted: requires about 256 escape-heavy errors.
- [Bandwidth: nested `tool_result` forwards full results, a duplicate of `tool_execution_end`] → same cost as top-level calls today; not worth a fourth forwarding exception.
