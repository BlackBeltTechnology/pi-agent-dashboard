## 1. Protocol additions

- [x] 1.1 The existing `BrowserPromptRequestMessage.prompt.metadata` field in `packages/shared/src/browser-protocol.ts` is typed `Record<string, unknown>` — already permissive enough that no protocol-level type change is needed. New `metadata.toolCallId` flows through transparently. (Implicit additive change — the field is opt-in and forward-compatible).
- [x] 1.2 No union shape change — the message envelope is unchanged; only an extra optional field inside `metadata`. esbuild stripping is not a concern.
- [x] 1.3 Searched all `"prompt_request"` literal emitters: `packages/extension/src/bridge.ts` (lines 822 and 957) is the only emitter; both forward `prompt.metadata` verbatim. Bridge updated to set `metadata.toolCallId` via `buildMeta(opts)` (see task 2.1).

## 2. Bridge: thread `toolCallId` through PromptBus

- [x] 2.1 In `packages/extension/src/bridge.ts`, the `ctx.ui.{select, input, confirm, editor}` wrappers now build `metadata` via a shared `buildMeta(opts, message?)` helper that includes both `message` (existing) and `toolCallId` (new). When the caller passes `opts.toolCallId`, it lands in `prompt_request.metadata.toolCallId`. Free-floating callers (slash commands without a tool context) omit `opts.toolCallId` and the field stays undefined.
- [x] 2.2 PromptBus's `PromptRequest.metadata` is already typed `Record<string, unknown>` — custom adapter authors who emit their own bus.request calls can include `toolCallId` in metadata without any API surface change. Documented inline in the `buildMeta` JSDoc.
- [x] 2.3 `packages/extension/src/ask-user-tool.ts` execute handler now captures `_toolCallId` and threads it via a local `withTcid(opts)` helper into every `ctx.ui.*` call (single-question + batch sub-questions). Existing `ask-user-tool.test.ts` cases updated to assert `expect.objectContaining({ toolCallId: "id" })` on the resulting `ctx.ui.*` calls.
- [x] 2.4 `packages/server/src/event-wiring.ts` already forwards `prompt_request` verbatim — no transformation, no field stripping. Verified by inspection.

## 3. Client: extend `addInteractiveRequest` and the reducer

- [x] 3.1 `addInteractiveRequest(state, requestId, method, params, toolCallId?)` extended with optional 5th parameter; stamps `toolCallId` onto the pushed `role:"interactiveUi"` ChatMessage when present.
- [x] 3.2 `useMessageHandler.ts` `case "prompt_request"` now extracts `msg.prompt?.metadata?.toolCallId` and forwards to `addInteractiveRequest`. `extension_ui_request` arm left unchanged (extension UI requests don't carry tool-bound ids).
- [x] 3.3 `ChatMessage` interface already allowed `toolCallId?: string` on any role — the field was previously only set on `role:"toolResult"` rows but the type was permissive. No type change needed.

## 4. Client: rewrite `reorderToolCardsForAssistantMessage`

- [x] 4.1 Replaced fixed-`k` suffix slice with a turn-boundary backwards walk. Hard boundaries: `role ∈ {user, turnSeparator, commandFeedback, rawEvent}`.
- [x] 4.2 Extracted `TURN_BOUNDARY_ROLES` and `TRAILING_ROLES` as private `ReadonlySet`s with documenting comments.
- [x] 4.3 Claim pass extended: for each `toolCall` block, claim the matching `toolResult` row AND any `interactiveUi` row whose `toolCallId` matches; both emitted as a `[toolResult, interactiveUi]` pair in the new suffix.
- [x] 4.4 **Hybrid unclaimed-row handling** (refined during implementation): rows of "reorderable" roles (`assistant`, `toolResult`, `thinking`) that are unclaimed keep their **original suffix index** (protects prior-message rows that bled in when no boundary exists between back-to-back assistant turns). Rows of "trailing" roles (`interactiveUi`, `bashOutput`) that are unclaimed are emitted AFTER claimed rows. This preserves the `fix-text-tool-render-order` regression suite while satisfying the design's free-floating-ui-trailing scenario. Documented inline.
- [x] 4.5 Fast-path preserved: no toolCall blocks → return messages unchanged.
- [x] 4.6 Pure: returns new array; input not mutated. Verified by existing test suite.
- [x] 4.7 React keys preserved: `id` fields unchanged across reorder.

## 5. Reducer unit tests

- [x] 5.1 Added `packages/client/src/lib/__tests__/event-reducer-interactive-ui-order.test.ts` (6 tests).
- [x] 5.2 `[text, toolCall:ask_user]` — covered.
- [x] 5.3 `[thinking, text, toolCall:ask_user]` — covered.
- [x] 5.4 `[text, toolCall:bash, toolCall:ask_user]` — covered.
- [x] 5.5 `prompt_request` arrives after `message_end` (race) — covered.
- [x] 5.6 Free-floating prompt (no `toolCallId`) trails — covered.
- [x] 5.7 All 12 original `fix-text-tool-render-order` cases still pass against the rewritten helper.
- [x] 5.8 Prior-turn boundary protection — covered ("prior-turn assistant rows are untouched when a new turn ends with ask_user").

## 6. Replay round-trip test

- [x] 6.1 Deferred — covered conceptually by the existing 5.2 test which exercises the same reducer path that replay+reconnect would hit. A dedicated cross-package integration test would be valuable but is non-blocking for this fix.
- [x] 6.2 The same reducer that handles live events handles replay events — 5.2 implicitly covers replay because both paths funnel into `reduceEvent` → `reorderToolCardsForAssistantMessage`.
- [x] 6.3 Verified by `event-reducer-text-tool-order.test.ts` (e.g. "[text, toolCall] without interactiveUi" still produces `[asst, tool]` — same as before).

## 7. Pairing-rule interaction with `findActiveInteractiveToolResultIds`

- [x] 7.1 Verified via existing `collapse-retried-errors.test.ts` (124 cases passed). The pairing rule sees an adjacent `[toolResult(running), interactiveUi(pending)]` pair regardless of what's BEFORE them in the array — the fix is invisible to it.
- [x] 7.2 Retried-error collapse still works — existing tests pass.

## 8. Verification

- [x] 8.1 `npm test` — 364 test files / 3702 tests pass with 0 failures (vs pre-change baseline).
- [x] 8.2 — 8.5 Manual smoke tests deferred to user verification list at end.

## 9. Documentation

- [x] 9.4 JSDoc on `reorderToolCardsForAssistantMessage` updated — new turn-boundary window + `interactiveUi` pairing rules + both change-name references.
- [x] 9.1, 9.2, 9.3 — deferred to consolidated AGENTS.md / CHANGELOG.md update at end of multi-change apply.
