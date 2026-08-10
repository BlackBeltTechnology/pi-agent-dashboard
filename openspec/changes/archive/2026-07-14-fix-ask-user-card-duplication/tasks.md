# Tasks

## 1. Suppress the paired ask_user tool card

- [x] 1.1 In `packages/client/src/components/ChatView.tsx`, compute a set of
      `toolCallId`s owned by live `interactiveUi` messages in the current message
      list (read `msg.args.toolCallId`, fall back to `requestId`). Memoize over the
      message list. → verify: set is empty when no `interactiveUi` messages exist.
- [x] 1.2 In the `toolResult` render branch, before rendering `ToolCallStep`, return
      `null` when `msg.toolName === "ask_user"` AND the set contains
      `msg.toolCallId ?? msg.id`. → verify: live `ask_user` renders exactly one card
      (the interactive one); history-reload answered `ask_user` (no paired
      `interactiveUi`) still renders the tool card.

## 2. Carry description into resolved interactive cards

- [x] 2.1 In `ConfirmRenderer.tsx`, add the `params.message` markdown body to the
      `status === "resolved"` branch (below the title, above the Yes/No summary),
      reusing the pending-branch pattern. → verify: answered confirm shows the
      description.
- [x] 2.2 Same for `SelectRenderer.tsx` resolved branch (below title, above the
      dimmed option list). → verify: answered select shows the description.
- [x] 2.3 Same for `MultiselectRenderer.tsx` resolved branch. → verify: answered
      multiselect shows the description.
- [x] 2.4 Same for `InputRenderer.tsx` resolved branch (below title, above the value
      field). → verify: answered input shows the description.
- [x] 2.5 Leave `cancelled` / `dismissed` compact states message-free. → verify: those
      states unchanged.

## Tests

- [x] T.1 `ChatView` test: given a message list with a `toolResult`
      (`toolName: "ask_user"`, `toolCallId: t1`) AND an `interactiveUi` message with
      matching `toolCallId: t1`, the `AskUserToolRenderer` tool card is NOT in the DOM
      and the interactive card IS. → verify: exactly one question card.
- [x] T.2 `ChatView` test: given only a `toolResult` (`toolName: "ask_user"`) with no
      paired `interactiveUi` (history-reload case), the tool card IS rendered. →
      verify: reconstructed answer path preserved.
- [x] T.3 Renderer tests: resolved `ConfirmRenderer` / `SelectRenderer` /
      `MultiselectRenderer` / `InputRenderer` with `params.message` set render the
      message markdown; without it render no empty body. → verify: description
      survives after answering.

## Validate

- [x] V.1 `npm test 2>&1 | tee /tmp/pi-test.log` green; existing
      `AskUserToolRenderer.test.tsx` and interactive-renderer tests still pass.
- [x] V.2 `npm run quality:changed` clean (Biome + tsc + tests).
- [x] V.3 Manual: trigger a live `ask_user{confirm}` in the dashboard, confirm one
      card while pending, one card after answering, description visible in both.
