## Why

Three open issues share one surface: how a **steer** (mid-turn interrupt) is sent, queued and shown.

- [#1159](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1159) — `POST /api/session/:id/prompt` cannot steer. **CONFIRMED**: body type is `{ text?, images? }` and `send_prompt` is built without `delivery` (`packages/server/src/session/session-api.ts:146-170`); the WS path forwards it (`packages/server/src/browser-handlers/session-action-handler.ts:479`) and the bridge honours it (`packages/extension/src/command-handler.ts:~925-975`). MCP `send_prompt` has the same gap: `SendPromptRequest` (`packages/shared/src/rest-api.ts:41-45`) has no `delivery`, and `additionalProperties:false` is generated into `packages/mcp-server-plugin/src/server/generated/tools.ts:40`.
- [#1132](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1132) — steer with images shows no marker. **PARTIAL**: root cause confirmed (`queue_update.steering: string[]` at `packages/shared/src/protocol.ts:21`; `recordSteerSent(text)` drops the images at `packages/extension/src/bridge.ts:569-576`, called from `command-handler.ts:971`; steer sends do carry images via `sendUserMessageWithImages`, `command-handler.ts:1309-1327`). But the issue's UI target is stale: steer renders as a ghost bubble in `ChatView` (`ChatView.tsx:2651`), not as a `QueuePanel` chip (`QueuePanel.tsx:20-22`).
- [#1133](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1133) — steer cannot be cancelled per entry. **CONFIRMED (owner, 2026-11-20): implement for HEADLESS sessions only.** The extension API has no queue mutation (`dist/core/extensions/types.d.ts` — only `hasPendingMessages()`), but pi's RPC mode does: `clear_queue` (`dist/modes/rpc/rpc-mode.js:331`, `docs/rpc-commands.md:107`) returns `{steering, followUp}` text and empties both queues. Headless sessions are `--mode rpc` behind a keeper that forwards UDS JSON lines to pi's stdin (`rpc-keeper/keeper.cjs:246-290`), so the server can clear and re-send the remaining entries. The issue's code pointers are stale (`clear_steering_queue` is a deleted type; steer renders in `ChatView`, not `QueuePanel`). TUI/tmux sessions get no cancel. See `design.md` Decision 3.

## What Changes

- **#1159** REST `POST /api/session/:id/prompt` accepts optional `delivery: "steer" | "followUp"`: validated (400 otherwise), forwarded verbatim, never defaulted server-side. Add `delivery?` to `SendPromptRequest` (MCP tool schema), regenerate `tools.ts`, update `pi-dashboard` skill REST docs.
- **#1132** Carry the steer image **count** end to end: bridge `bridgeSteering` entries become `{ text, imageCount }`; `queue_update` gains optional parallel `steeringImageCounts: number[]` (`steering` stays `string[]`); server validates + caches it; `ChatView` pending-steer bubble renders `pending-steer-attachments` (same icon/title as `queue-followup-attachments`). Counts only, never bytes.
- **#1133** Headless-only per-entry steer cancel. Browser `cancel_steer_entry {sessionId,index,text}` → server gates on keeper presence → bridge `cancel_steer_prepare` (authority for the entry + retained image refs; replies remaining entries) → server writes pi RPC `clear_queue` then `steer` per remaining entry (original order, images) to the keeper UDS → bridge `cancel_steer_commit` splices the entry and emits `queue_update` → browser gets `steer_cancel_result` (`cancelled | already_delivered | unsupported | unresendable | busy | failed`). `ChatView` pending-steer bubble shows a cancel button only when the parent passes the handler (headless). Re-adds a minimal server→keeper write client (deleted by `retire-slash-dispatch-via-expand-prompt-templates`). Amends the "permanently pi-owned" requirement (pi still owns the queue; no bridge-owned buffer, bridge never calls `pi.clear*Queue`).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `mid-turn-prompt-queue`: MODIFIED "Server caches per-session queue state…", "Bridge maintains shadow steering and follow-up queues", "Steer queue is permanently pi-owned + display-only — no bridge-owned-steer"; ADDED "Pending steer bubble indicates attached images", "Headless steer cancel clears pi's queue and re-sends the remainder", "Pending steer bubble offers cancel on headless sessions".
- `dashboard-server`: MODIFIED "Session prompt REST endpoint"; ADDED "Server writes pi RPC lines to a session's keeper for steer cancel".

## Non-goals

- Steer cancel on TUI/tmux/zed sessions; steer edit/promote; bulk steer clear; a bridge-owned steer buffer; reading pi's `clear_queue` response (keeper discards pi stdout; no keeper change).
- Image thumbnails in the steer bubble.
- Changing `delivery` handling on the WebSocket path (already correct) or follow-up behaviour.
- Moving steer rendering into `QueuePanel`/`QueueLane`.

## Relationship

- Archived, not superseding: `2026-05-18-add-steering-message` (introduced `delivery`), `2026-05-19-add-followup-edit-and-steer-cancel` (deferred per-entry cancel), `2026-08-24-fix-bridge-followup-image-drop` (follow-up image count; this mirrors it for steer), `2026-05-29-rework-mid-turn-prompt-queue` (steer permanently pi-owned).
- Active changes: none overlap (`grep -il steer openspec/changes/*/proposal.md` hits only unrelated proposals).

## Discipline Skills

- `security-hardening` — REST `delivery` is untrusted input (strict enum validation); `steeringImageCounts` is untrusted bridge→server data (type/length validation, no bytes on the wire).
- `review-code` — non-trivial cross-package change, before commit.
- `doubt-driven-review` — triggered: #1133 adds a public wire message and an irreversible-in-flight clear+re-send; review the residual duplicate-delivery race and failure ordering before it stands.
- `security-hardening` also covers: keeper UDS write (fixed command set only — `clear_queue`/`steer`; sockPath from the registry, never from client input), image bytes in `steer_cancel_prepared` (never logged/cached), `index`/`text` validation on `cancel_steer_entry`.
- `observability-instrumentation` — one server log line per cancel with status (no text/bytes).

## Impact

- Files: `packages/server/src/session/session-api.ts`, `packages/server/src/event-wiring.ts` (queue_update cache), `packages/shared/src/{protocol.ts,types.ts,rest-api.ts}`, `packages/mcp-server-plugin/src/server/generated/tools.ts` (regenerated), `packages/extension/src/{bridge.ts,command-handler.ts,bridge-handlers/{instance,forwarders,lifecycle}.ts}`, `packages/client/src/components/chat/ChatView.tsx` (+ `App.tsx` prop plumbing), `packages/extension/.pi/skills/pi-dashboard/{SKILL.md,references/api-reference*.md}`; #1133: `packages/shared/src/{protocol.ts,browser-protocol.ts}` (4 new messages), `packages/server/src/browser-handlers/session-action-handler.ts` + new `packages/server/src/rpc-keeper/keeper-rpc-writer.ts`, `spawn-process/headless-pid-registry.ts` (`getKeeperSockPath`), `packages/extension/src/{command-handler.ts,bridge-handlers/*}`, `ChatView.tsx` + parent wiring.
- Compatibility: all new wire fields optional and additive. Old bridge → new server/client: no counts, no indicator. New bridge → old server/client: extra field ignored; old bridge ignores `cancel_steer_prepare` (server times out ⇒ `failed`); `steering` is still `string[]` so old clients do not break. `delivery` absent ⇒ unchanged follow-up behaviour.
- Migration: none (in-memory state only). Rollback: revert; no persisted data changes.
