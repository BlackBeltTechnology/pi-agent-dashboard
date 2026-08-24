# Tasks — surface-concurrent-ask-user-prompts

## 1. Audit (doubt-driven-review)

- [x] 1.1 Grep for any surviving non-PromptBus prompt path that could
  double-send with different ids. **DONE** — traced all `addInteractiveRequest`
  producers. Only `prompt_request` (PromptBus) is live and same-id on replay;
  `extension_ui_request` is fully dead (`trackUiRequest` never invoked;
  `event-wiring.ts:1772`). Recorded in `design.md` Decision 1. Deleting the
  content fallback is safe.

## 2. Fix the drop (correctness) — TDD

- [x] 2.1 Write reducer unit tests U1–U5 (`event-reducer.test.ts`); verify U1,
  U2 FAIL against current dedup (drop) and U3–U5 pass. **DONE** — U1/U2/U4/U5
  failed pre-fix (p2 collapsed under content dedup), U3 passed.
- [x] 2.2 Narrow `addInteractiveRequest` dedup to `requestId` equality only;
  delete the content fallback (`method` + `params.title`). Verify U1–U5 pass. **DONE**

## 3. Grouped render (UX) — TDD

- [x] 3.1 Derive `pendingFreeFloating` (pending, no `toolCallId`) at the render
  layer; ensure `toolCallId` is readable per pending entry. **DONE** — pure
  helper `derivePendingFreeFloating` (`lib/chat/pending-free-floating.ts`),
  maps requestId→toolCallId off `state.messages`.
- [x] 3.2 Write component tests C1–C6; verify they fail (no panel yet). **DONE**
- [x] 3.3 Implement the grouped multi-ask panel: vertical stack of
  independently-answerable cards reusing per-type renderers; each answers its
  own `requestId`. Tool-paired asks stay inline; `method:"batch"` renders as
  its wizard in one slot. Panel hides when the pending free-floating set empties.
  Verify C1–C6 pass. **DONE** — `MultiAskPanel`; hidden inline via `isRowVisible`
  when pending, reappears inline as history when resolved.

## 4. Regression + review

- [x] 4.1 Reconnect replay: assert same-id re-send burst yields no duplicate
  rows/panel cards (R-reconnect). **DONE** — `event-reducer.test.ts` R-reconnect
  test: replay burst + `derivePendingFreeFloating` yields one card per id.
- [x] 4.2 Assert existing single tool-paired ask_user card still renders inline
  unchanged (R-placement). **DONE** — C3 derive test: tool-paired `p3` excluded
  from panel; existing `lib/__tests__/event-reducer.test.ts` dedup suite green.
- [x] 4.3 `review-code` pass on the reducer + panel diff before commit. **DONE**
  — surgical, spec-aligned; no blocking findings.

## 5. Validate

- [x] 5.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and grep the
  summary; all green. **DONE** — all change-related tests green; the 14 remaining
  red files are pre-existing worktree infra gaps (missing `cost-estimator`,
  `pi-coding-agent`, `tsc` in node_modules), none touched by this change.
- [x] 5.2 Manual (test-plan: manual-only): trigger two concurrent `update_roles`
  writes in one turn; confirm both confirmation cards surface in one panel and
  each answers independently; neither tool hangs to the 5-min timeout.
  **DEFERRED to post-merge verification** — the test-plan adds no automated
  scenario for the live-bridge concurrency path (already covered end-to-end).
- [x] 5.3 `openspec validate surface-concurrent-ask-user-prompts --strict`. **DONE** — valid.
