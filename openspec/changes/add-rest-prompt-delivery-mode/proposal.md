## Why

[#1159](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1159) — `POST /api/session/:id/prompt` cannot steer. **CONFIRMED**: the body type is `{ text?, images? }` and `send_prompt` is built without `delivery` (`packages/server/src/session/session-api.ts`, the `/api/session/:id/prompt` route). The wire already supports it: `SendPromptToExtensionMessage.delivery?: "steer" | "followUp"` (`packages/shared/src/protocol.ts`), the browser sends it (`browser-protocol.ts` `SendPromptToBrowserMessage.delivery`) and the WS handler forwards it verbatim (`packages/server/src/browser-handlers/session-action-handler.ts`, `delivery: msg.delivery`); the bridge honours it (`command-handler.ts`: `delivery="steer"` + streaming ⇒ held in the bridge steer buffer, cancellable until hand-off to pi; idle ⇒ straight to pi).

MCP `send_prompt` has the same gap, and a schema change alone cannot close it: `SendPromptRequest` (`packages/shared/src/rest-api.ts`) has no `delivery` (`additionalProperties:false` is generated into `packages/mcp-server-plugin/src/server/generated/tools.ts`), AND the tool is context-bound (`bind:{kind:"context",member:"sendToSession"}`) with a handler that passes only text — `ctx.sendToSession(args.sessionId, args.text)` (`packages/mcp-server-plugin/src/server/index.ts`, `send_prompt` handler), `SendToSessionFn = (sessionId, text) => boolean` (`packages/dashboard-plugin-runtime/src/server/server-context.ts`), wired in `packages/server/src/server.ts` as `{type:"send_prompt",sessionId,text}`.

Scope history: this change originally also covered [#1132](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1132) (steer image marker) and [#1133](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1133) (per-entry steer cancel). Both were **delivered by #1161** (`bridge-owned-cancellable-steer`, commit `736848ba2`, archived `2026-11-12-bridge-owned-cancellable-steer`; #1132/#1133 closed citing it) — steers are now bridge-held, cancellable by `id`, with `imageCount` on `queue_update`. That work is removed from this change; only #1159 remains, and it is consistent with that model: an API steer sent while streaming is held and cancellable exactly like a browser steer.

## What Changes

- REST `POST /api/session/:id/prompt` accepts optional `delivery: "steer" | "followUp"` (the existing `send_prompt` field): validated (400 otherwise; the check runs BEFORE the session lookup, so unknown session + invalid delivery ⇒ 400), forwarded verbatim on `send_prompt`, never defaulted server-side. No new wire field or message.
- MCP `send_prompt`: add `delivery?` to `SendPromptRequest`, regenerate `tools.ts`, and ACTUALLY forward it — widen the plugin-context `SendToSessionFn` with an optional third argument `opts?: { delivery? }` (additive: existing two-argument callers in other plugins unchanged), update the MCP handler and the `server.ts` wiring.
- Update the `pi-dashboard` skill REST docs (`SKILL.md`, `references/api-reference*.md`).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `dashboard-server`: MODIFIED "Session prompt REST endpoint".
- `dashboard-mcp-server`: ADDED "MCP send_prompt forwards the delivery mode".

## Non-goals

- Any change to steer buffering, cancel, clear-all, image markers or `queue_update` (shipped by #1161); no `mid-turn-prompt-queue` delta — an API steer reuses the existing `send_prompt` + `delivery` behaviour unchanged.
- Changing `delivery` handling on the WebSocket path or follow-up behaviour.
- Forwarding `images` from MCP `send_prompt` (pre-existing gap, separate concern).
- Cancelling a steer from REST/MCP (the browser cancel verbs are unchanged and not exposed here).
- Correlating `prompt_received` acks to the client's optimistic bubble by `promptId` (client `applyPromptReceived` matches on `fresh` only). Accepted limitation: a REST steer's hand-off ack can transiently drop a coincident browser idle-send `sending` bubble; self-heals via `queue_update` / `message_start` (see design Decision 3).

## Relationship

- Builds on archived `2026-11-12-bridge-owned-cancellable-steer` (#1161) and `2026-05-18-add-steering-message` (introduced `delivery`). Main specs: `mid-turn-prompt-queue` ("Protocol `send_prompt` messages carry optional delivery field", "Streaming steers are buffered in the bridge").
- Renamed from `steering-queue-parity` after descoping #1132/#1133.

## Discipline Skills

- `security-hardening` — REST `delivery` is untrusted input (strict enum validation, before the session lookup); MCP schema rejects other values.
- `review-code` — cross-package change (server, shared, mcp-server-plugin, plugin-runtime), before commit.

## Impact

- Files: `packages/server/src/session/session-api.ts`, `packages/server/src/server.ts` (plugin-context `sendToSession`), `packages/shared/src/rest-api.ts`, `packages/mcp-server-plugin/src/server/{index.ts,tools.manifest.ts,generated/tools.ts}` (handler widened; manifest description extended; `tools.ts` regenerated), `packages/dashboard-plugin-runtime/src/server/server-context.ts` (`SendToSessionFn` optional `opts`), `packages/extension/.pi/skills/pi-dashboard/{SKILL.md,references/api-reference.md,references/api-reference.agent.md}`.
- Compatibility: `delivery` is optional and additive; absent ⇒ unchanged follow-up behaviour; the bridge already understands the field (no extension change, no reload needed). Migration: none (no persisted state). Rollback: revert.
