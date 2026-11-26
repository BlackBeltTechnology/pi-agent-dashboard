## Context

The bridge already routes `send_prompt.delivery` (`steer` while streaming ⇒ held in the bridge steer buffer, cancellable until hand-off at `turn_end` / settle drain; idle ⇒ straight to pi). The browser reaches it over WS; REST and MCP build `send_prompt` themselves and drop the field. This change only closes that gap — see `proposal.md` for why #1132/#1133 are not here (delivered by #1161).

## Decisions

### 1. Reuse the existing `delivery` field and values
`"steer" | "followUp"`, same name as `protocol.ts` `SendPromptToExtensionMessage.delivery`. No new message, no new type. REST and MCP forward it unchanged and never default it (the bridge treats absence as `followUp`), matching the WS path's transparent pass-through.

### 2. Validate at the REST edge, before the session lookup
Order in `session-api.ts`: `text` check → `images` check → **`delivery` enum check (400)** → `getSessionOrFail` (404). Unknown session + invalid `delivery` ⇒ 400: input errors do not depend on server state. Valid-but-wrong values (`"now"`, `5`, `null`) ⇒ 400, nothing sent.

### 3. An API steer behaves exactly like a browser steer
No server-side steer logic: `send_prompt` carries `delivery` and the existing `promptId` the REST route already mints. While streaming the bridge holds the steer (cancellable from the browser by id; shown as a pending steer bubble); the `promptId` is acked on the session event stream (`prompt_received`) when the bridge hands it to pi; the server-side pending-ack record is TTL-bounded and may already have expired for a long-held steer (harmless — the event is forwarded regardless). ACP sessions have no steering: a mid-turn steer queues as a follow-up, as for the browser. Known limitation: the REST route's `promptId` makes the hand-off ack (`prompt_received{fresh:false, promptId}`) the first promptId-bearing steer ack; the client's `applyPromptReceived` matches on `fresh` only, so if it lands while a browser idle-send bubble is still `sending` that bubble is dropped (transient; the authoritative `queue_update` / user `message_start` restores state and settled bubbles are guarded) — accepted, not fixed here. The REST response keeps reporting transmission only (`transmitted`, `promptId`), unchanged.

### 4. MCP: widen the context-bound `sendToSession` additively
The tool is `bind:{kind:"context",member:"sendToSession"}` and the handler passes only text, so a schema-only change would silently drop `delivery`. Widen `SendToSessionFn` to `(sessionId, text, opts?: { delivery?: "steer" | "followUp" }) => boolean`; the `server.ts` wiring spreads `delivery` into the message only when defined. Existing two-argument callers (other plugins) produce the identical message. The MCP handler passes `args.delivery`. `tools.ts` is regenerated from `SendPromptRequest` (codegen freshness test must pass).

## Alternatives rejected

- Separate `steer_prompt` REST route / MCP tool: duplicates `send_prompt`; the existing field already expresses it.
- Defaulting `delivery` to `steer` on REST: changes behaviour for existing callers.
- Exposing steer cancel over REST/MCP: out of scope; no demand beyond #1159.

## Compatibility / rollback

Optional additive field; bridge already supports it, so no extension reload. Old clients unaffected. Rollback = revert; no persisted data.
