# Tasks — harden-multi-ask-panel

This change edits **specification text and tests only**. No production source
change is expected. Every test below is a characterisation test and MUST pass
against current `main` code once written — a red test here means the shipped
behaviour differs from what the spec now claims, which invalidates the
"spec-only" premise.

Harness exemplar for every test task:
`packages/client/src/__tests__/multi-ask-panel.test.tsx` — it already renders
`MultiAskPanel` through `ThemeProvider` with Testing Library (`renderPanel`,
`confirmReq`, `uiRow` helpers) and exercises `derivePendingFreeFloating`
directly. Extend that file; copy its `beforeEach` `matchMedia` stub.

## 1. Verify the spec-only premise holds

- [x] 1.1 Confirm shipped code already satisfies every clause the delta adds:
  widget-bar exclusion in `pending-free-floating.ts`, widget-bar row hiding in
  `ChatView.isRowVisible`, `MultiAskPanel` null-guard only on empty, and no
  size-of-pending-set dependency anywhere in the derivation. If any clause is
  NOT already true, stop and re-open the proposal — the change would no longer
  be spec-only.

## 2. Placement decision table (L1, vitest)

- [x] 2.1 Free-floating ask enters the panel (test-plan #E1). Input: pending
  `p1` with no `toolCallId` and no `_promptBusComponent` · Trigger:
  `derivePendingFreeFloating(messages, requests)` · Observable: returns
  `["p1"]`. See `multi-ask-panel.test.tsx` derive suite.
- [x] 2.2 Tool-paired ask stays out of the panel (test-plan #E2). Input:
  pending `p3` whose `interactiveUi` row carries `toolCallId: "tool-call-1"`,
  plus free-floating `p1` · Trigger: same call · Observable: returns `["p1"]`.
  Extends the existing C3 case in `multi-ask-panel.test.tsx`.
- [x] 2.3 Widget-bar ask never enters the panel (test-plan #E3). Input: pending
  `pw` with `params._promptBusComponent = { type: "architect-prompt" }` (a
  built-in widget-bar type — no registration needed) and no `toolCallId`, plus
  free-floating `p1` · Trigger: same call · Observable: returns `["p1"]`. This
  is the assertion whose absence let the spec drift.
- [x] 2.4 Widget-bar precedence beats tool-pairing (test-plan #E4). Input:
  pending `pw` with `_promptBusComponent.type = "architect-prompt"` AND a row
  `toolCallId: "tool-call-9"`, plus free-floating `p1` · Trigger: same call ·
  Observable: returns `["p1"]` — `pw` excluded, widget-bar wins.
- [x] 2.5 Unregistered component type is not widget-bar (test-plan #E5). Input:
  pending `pu` with `_promptBusComponent = { type: "definitely-not-registered" }`
  and no `toolCallId` · Trigger: same call · Observable: `pu` IS returned —
  unknown types use the panel's `generic-dialog` renderer — still free-floating
  (registry, not producer claim, decides). Pins the documented
  limitation that the registry, not the producer's claim, decides.
- [x] 2.6 Tool-paired batch ask does not enter the stack (test-plan #E8). Input:
  pending `method:"batch"` ask `pb` whose row carries a `toolCallId`, plus
  free-floating `p1` · Trigger: same call · Observable: returns `["p1"]`.
  Pins the batch clause's "that belongs to the panel" scoping.

## 3. Panel lifecycle and stability (L1, vitest)

- [x] 3.1 Single pending ask renders a one-card panel (test-plan #E6). Input:
  `MultiAskPanel requests={[p1]}` · Trigger: render · Observable:
  `multi-ask-panel` node present with exactly one `multi-ask-card-*`. Promotes
  C4's setup step into an explicit always-panel assertion.
- [x] 3.2 Empty set hides the panel (test-plan #E7). Input:
  `MultiAskPanel requests={[]}` · Trigger: render · Observable: no
  `multi-ask-panel` node. Already covered by C5 — extend or reuse rather than
  duplicating.
- [x] 3.3 Late arrival appends without disturbing the incumbent (test-plan #F1).
  Input: panel rendered with `[p1]` · Trigger: rerender with `[p1, p2]` ·
  Observable: two `multi-ask-card-*` nodes, `p1` still present.
- [x] 3.4 Drain to empty hides the panel (test-plan #F2). Input: panel rendered
  with `[p1, p2]` · Trigger: rerender with `[]` · Observable: no
  `multi-ask-panel` node.
- [x] 3.5 Placement is stable with respect to the pending set (test-plan #F3).
  Input: panel with one `method:"input"` ask `p1`, user types `"hello"` into
  its field · Trigger: sibling `p2` arrives (rerender `[p1, p2]`) ·
  Observable: `p1`'s input still reads `"hello"` — the card was not remounted.
  This is the row that falsifies any future "panel only when 2+" rule, so
  assert the preserved value, not merely the node count.
- [x] 3.6 Answering one card resolves only its own id (test-plan #F4). Input:
  panel with `[p1, p2]` · Trigger: click confirm on `p2` · Observable:
  `onRespondToUi` called exactly once with `"p2"`. Already covered by C2 —
  extend or reuse rather than duplicating.

## 4. Review

- [x] 4.1 `review-code` pass on the added tests and the spec delta before
  commit — specifically that no test was written to pass by construction
  (each must fail if its clause is deleted from the derivation).

## 5. Validate

- [x] 5.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and grep the
  summary; the new cases visibly executed, no new failures attributable to the
  change.
  Outcome: multi-ask-panel suite 16/16 green (E1–E8, F1–F4 executed); the full
  suite retained exactly the 5 documented pre-existing faux-session.integration
  failures — verified red on origin/develop, on the branch base, and on the
  merged tree (identical register-timeout failures; environment-level,
  server/extension integration, untouched here).
  server-auto-start reds were full-suite load contention (22/22 in isolation).
- [x] 5.2 `openspec validate harden-multi-ask-panel --strict`.
