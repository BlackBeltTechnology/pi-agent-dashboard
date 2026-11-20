## 1. #1159 REST delivery

- [ ] 1.1 Write failing tests in `packages/server/src/session/__tests__/` for `POST /api/session/:id/prompt`: `delivery:"steer"` forwarded on `send_prompt`; absent ⇒ no `delivery` key; `"now"` / `5` / `null` ⇒ 400 and nothing sent.
- [ ] 1.2 Implement in `session-api.ts`: body type gains `delivery?`, enum check before `getSessionOrFail`, include `delivery` in `send_prompt` only when provided.
- [ ] 1.3 Add `delivery?: "steer" | "followUp"` to `SendPromptRequest` (`packages/shared/src/rest-api.ts`); regenerate `packages/mcp-server-plugin/src/server/generated/tools.ts` via the codegen script (freshness test must pass); confirm the context-bound `send_prompt` tool forwards `delivery`.
- [ ] 1.4 Update `packages/extension/.pi/skills/pi-dashboard/SKILL.md` and `references/api-reference.md` + `api-reference.agent.md` (body, 400 case, steer example).

## 2. #1132 steer image count

- [ ] 2.1 Write failing tests: bridge `recordSteerSent("x", [img, img])` ⇒ entry holds the `images` refs, `queue_update` has `steering:["x"]`, `steeringImageCounts:[2]` and no bytes; drain matcher keeps remaining counts aligned; invalid images not counted; counts omitted when all 0; session reset clears.
- [ ] 2.2 Write failing server test (`event-wiring`): counts cached + broadcast; misaligned/non-integer/negative array dropped; absent ⇒ absent.
- [ ] 2.3 Write failing client test (`ChatView`): `pending-steer-attachments` shows count; absent for 0 / missing array; follows entry after partial drain.
- [ ] 2.4 Implement shared types: `QueueUpdateToServerMessage.steeringImageCounts?`, `SessionUiState.pendingQueues.steeringImageCounts?` (`protocol.ts`, `types.ts`, `browser-protocol.ts` ~L1517).
- [ ] 2.5 Implement bridge: `bridgeSteering: SteerEntry[]` with `{text,imageCount,images?}` (`instance.ts`), `recordSteerSent(text, images?)` and `onSteerSent` option (`bridge.ts`, `command-handler.ts` — pass `validateImages(...).valid`; count = its length; entry keeps the refs), `emitQueueUpdate` projection, matcher in `forwarders.ts`, reset in `lifecycle.ts`.
- [ ] 2.5b Implement server validation in `event-wiring.ts` queue_update branch.
- [ ] 2.6 Implement client: plumb counts from `pendingQueues` to `ChatView` (`pendingSteeringImageCounts?: number[]`), render indicator in the pending-steer bubble; keep `key`/live-arrival logic text-based.

## 3. #1133 headless steer cancel

- [ ] 3.1 Write failing shared-type/compile tests: `cancel_steer_entry` + `steer_cancel_result` (browser-protocol), `cancel_steer_prepare`/`cancel_steer_commit` (ServerToExtension), `steer_cancel_prepared` (ExtensionToServer); no `clear_steering_queue`-style name reintroduced (existing negative test `bridge-no-queue-mutation.test.ts` still passes).
- [ ] 3.2 Write failing bridge tests: prepare with matching `index+text` ⇒ `ok` + `remaining` with `images`, shadow NOT mutated; text mismatch / empty shadow / not streaming ⇒ `already_delivered`; any remaining text starting `/` ⇒ `unresendable`; commit removes the prepared entry by identity (no-op if already drained), emits one `queue_update`, releases `images`; prepare slot expires after 10 s; session reset clears the slot.
- [ ] 3.3 Write failing server tests: new `rpc-keeper/keeper-rpc-writer.ts` (fake UDS) writes `clear_queue` then `steer` lines in order on one connection, rejects on ENOENT/ECONNREFUSED/2 s flush timeout; `session-action-handler` flow: no `keeperSockPath` ⇒ `unsupported` (no socket); bridge silent 5 s ⇒ `failed`; `ok` ⇒ writer then commit then `cancelled`; writer failure ⇒ no commit; second cancel in flight ⇒ `busy`; malformed `index`/`text` dropped.
- [ ] 3.4 Write failing client tests (`ChatView`): `pending-steer-cancel` renders only when handler provided; click sends `index`+`text`; disabled while pending; `already_delivered`/`failed` message; parent passes handler only for `session.source === "dashboard"`.
- [ ] 3.5 Implement shared protocol types (`protocol.ts`, `browser-protocol.ts`).
- [ ] 3.6 Implement bridge: `SteerEntry.images`, prepare/commit handlers + single pending slot (`bridge-handlers/dispatch.ts` + new small module), `steer_cancel_prepared` via `eventSink`/server channel.
- [ ] 3.7 Implement server: `getKeeperSockPath(sessionId)` on `headless-pid-registry.ts`; `keeper-rpc-writer.ts` (`net.createConnection`, fixed command set, 2 s timeout, no read); `handleCancelSteerEntry` in `session-action-handler.ts` (per-session in-flight lock, 5 s prepare timeout, one structured log line with status only — no text/bytes); route `steer_cancel_prepared` from event-wiring to the waiting handler; browser `steer_cancel_result`.
- [ ] 3.8 Implement client: handler prop plumbing (`App.tsx` → `ChatView`), cancel button in the pending-steer bubble, i18n `session.cancelSteer` (+ en/hu/zh-CN keys per existing i18n test), result messages.
- [ ] 3.9 Manual E2E on a headless session: send 3 steers mid-turn (one with an image), cancel the middle one, confirm bubbles `a,c`, `c` keeps its image count, and both are delivered once and in order at `turn_end`; cancel after drain ⇒ "already sent"; TUI/tmux session shows no button.
- [ ] 3.10 Update `docs/` via DocScribe (steer queue section, keeper write path re-introduced) and `docs/architecture.md` RPC keeper topology note; `packages/server/src/rpc-keeper/AGENTS.md` row for `keeper-rpc-writer.ts`.
- [ ] 3.11 `doubt-driven-review` on the clear+re-send ordering and the residual duplicate-delivery race before landing.

## 4. Verify and land

- [ ] 4.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep verdict.
- [ ] 4.2 `npm run reload` (extension), `npx tsx .pi/skills/implement/scripts/restart-server.ts` (server/shared), `npm run build` + restart (client); `curl -s localhost:8000/api/health | jq .mode`.
- [ ] 4.3 Manual: `pi-dashboard api POST /api/session/ID/prompt --data '{"text":"x","delivery":"steer"}'` mid-turn with an image attached via UI steer ⇒ bubble shows count.
- [ ] 4.4 `/review-code` on the diff; `npm run quality:changed`.
- [ ] 4.5 `npx openspec validate steering-queue-parity --strict`; `node scripts/check-conventions.mjs`.
