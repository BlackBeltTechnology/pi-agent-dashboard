# Test Plan — surface-concurrent-ask-user-prompts

Derived from the spec deltas. Each scenario routed to a test level. Reducer
logic is pure → unit (vitest). Grouped panel is DOM render → component test
(vitest + Testing Library). Concurrency across the real bridge is
architecturally already covered end-to-end, so no Playwright E2E is added;
the loss is a client reducer/render defect, verifiable in isolation.

## Level 1 — Reducer unit (`event-reducer.test.ts`)

| ID | Scenario (spec) | Input · Trigger · Observable |
|----|-----------------|------------------------------|
| U1 | Two concurrent confirms sharing a title both surface | add `p1` then `p2` (same title, diff message) · `addInteractiveRequest` ×2 · `interactiveRequests` length 2, rows `ui-p1`+`ui-p2` |
| U2 | Two identical concurrent confirms both surface | add `p1` then `p2` (byte-identical content, diff id) · · both present, both pending |
| U3 | Same-id re-send suppressed | add `p1`, then `p1` again · replay · exactly one `p1`, one `ui-p1` |
| U4 | Answering one leaves the other pending | pending `p1`+`p2` · `resolveInteractiveRequest(p1)` · `p1` resolved, `p2` pending |
| U5 | Cancelling one does not cancel the other | pending `p1`+`p2` · `dismissInteractiveRequest(p1, cancelled)` · only `p1` cancelled |

## Level 2 — Component render (`ChatView`/panel test)

| ID | Scenario (spec) | Input · Trigger · Observable |
|----|-----------------|------------------------------|
| C1 | Two free-floating confirms group into one panel | state with pending `p1`+`p2`, no `toolCallId` · render · one panel node, two answerable cards |
| C2 | Answer in panel resolves own id | rendered panel `p1`+`p2` · click Yes on `p2` · `onRespondToUi` called once with `p2` |
| C3 | Tool-paired ask stays inline | pending `p3` w/ `toolCallId` + free-floating `p1` · render · `p3` inline, only `p1` in panel |
| C4 | Late arrival appends | panel open with `p1` · add `p2` · panel shows 2 cards |
| C5 | Empty set hides panel | panel with `p1`+`p2` · both resolved · panel absent |
| C6 | Batch entry renders as wizard in a stack slot | pending `method:"batch"` + free-floating confirm · render · batch wizard + confirm card coexist |

## Regression guards

- R-reconnect: replay re-send burst (all existing ids) produces no duplicate
  rows or duplicated panel cards (U3 + a panel-level assertion).
- R-placement: existing single tool-paired ask_user card still renders inline
  and unchanged (C3 lower bound).
