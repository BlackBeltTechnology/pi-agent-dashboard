# Tasks — surface-concurrent-ask-user-prompts

## 1. Audit (doubt-driven-review)

- [x] 1.1 Grep for any surviving non-PromptBus prompt path that could
  double-send with different ids. **DONE** — traced all `addInteractiveRequest`
  producers. Only `prompt_request` (PromptBus) is live and same-id on replay;
  `extension_ui_request` is fully dead (`trackUiRequest` never invoked;
  `event-wiring.ts:1772`). Recorded in `design.md` Decision 1. Deleting the
  content fallback is safe.

## 2. Fix the drop (correctness) — TDD

- [ ] 2.1 Write reducer unit tests U1–U5 (`event-reducer.test.ts`); verify U1,
  U2 FAIL against current dedup (drop) and U3–U5 pass.
- [ ] 2.2 Narrow `addInteractiveRequest` dedup to `requestId` equality only;
  delete the content fallback (`method` + `params.title`). Verify U1–U5 pass.

## 3. Grouped render (UX) — TDD

- [ ] 3.1 Derive `pendingFreeFloating` (pending, no `toolCallId`) at the render
  layer; ensure `toolCallId` is readable per pending entry.
- [ ] 3.2 Write component tests C1–C6; verify they fail (no panel yet).
- [ ] 3.3 Implement the grouped multi-ask panel: vertical stack of
  independently-answerable cards reusing per-type renderers; each answers its
  own `requestId`. Tool-paired asks stay inline; `method:"batch"` renders as
  its wizard in one slot. Panel hides when the pending free-floating set empties.
  Verify C1–C6 pass.

## 4. Regression + review

- [ ] 4.1 Reconnect replay: assert same-id re-send burst yields no duplicate
  rows/panel cards (R-reconnect).
- [ ] 4.2 Assert existing single tool-paired ask_user card still renders inline
  unchanged (R-placement).
- [ ] 4.3 `review-code` pass on the reducer + panel diff before commit.

## 5. Validate

- [ ] 5.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and grep the
  summary; all green.
- [ ] 5.2 Manual: trigger two concurrent `update_roles` writes in one turn;
  confirm both confirmation cards surface in one panel and each answers
  independently; neither tool hangs to the 5-min timeout.
- [ ] 5.3 `openspec validate surface-concurrent-ask-user-prompts --strict`.
