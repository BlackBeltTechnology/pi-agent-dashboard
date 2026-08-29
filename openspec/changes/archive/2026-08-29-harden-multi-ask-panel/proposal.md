## Why

`surface-concurrent-ask-user-prompts` (#538) fixed the real defect — concurrent
`ask_user` prompts are no longer dropped — but its synced spec does not describe
the code it shipped. `derivePendingFreeFloating` excludes widget-bar-owned
prompts (`isWidgetBarPrompt(cmp.type)`, `pending-free-floating.ts:26-30`)
because a widget-bar slot already owns that render. The spec never mentions
widget-bar: it defines a free-floating ask as one that merely "carries no
`toolCallId`".

**Implemented literally, the spec mandates a double-render bug.** A conforming
implementation would pull a widget-bar prompt into the grouped panel while its
widget-bar slot renders it too. The shipped exclusion is correct; the written
requirement is wrong, and it is the requirement that survives into future work.

The spec is also silent on two behaviours the code already has — that the panel
renders even for a *single* pending ask, and that an ask never changes placement
because some other ask arrived or resolved. Both are load-bearing (see What
Changes), and neither is currently written down.

## What Changes

This is a **specification-only change. No production code changes.**

- **Name widget-bar as a placement category, with explicit precedence.** The
  requirement SHALL evaluate widget-bar ownership *before* tool-pairing, so an
  ask that is both a widget-bar type and carries a `toolCallId` is placed by its
  slot — matching shipped behaviour and making the double-render
  unimplementable.
- **State the always-panel rule.** The panel renders whenever one or more
  free-floating asks are pending, including the single-ask case.
- **State placement stability with respect to the pending set.** An ask
  arriving, resolving, or being cancelled SHALL NOT change any other pending
  ask's placement. This is the rule that forbids a future "group only when 2+"
  optimisation, which would remount cards and silently destroy in-progress user
  input (see Non-Goals).
- **Scope the batch clause** to asks that belong to the panel, since a
  tool-paired batch ask renders inline.
- **Pin the behaviour with tests** where it is currently unasserted — notably
  that a widget-bar ask never enters the panel.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `concurrent-ask-user-prompts`: the grouped-panel requirement gains the
  widget-bar placement category and its precedence rule, the explicit
  always-panel rule, the pending-set placement-stability rule, and a scoped
  batch clause.

## Impact

- `openspec/specs/concurrent-ask-user-prompts/spec.md` — via the delta.
- `packages/client/src/__tests__/multi-ask-panel.test.tsx` — add coverage for
  the widget-bar exclusion and the single-ask panel, which the spec now
  requires and which no test currently asserts.
- No production source, server, bridge, shared-protocol, or PromptBus change.

## Non-Goals

- **No `toolCallId`-provenance refactor.** Storing `toolCallId` on
  `InteractiveUiRequest` (so placement stops depending on a message-row scan)
  was designed and reviewed across three doubt cycles and **deferred**. Review
  established that it does not change any observable outcome today: the only
  scenario it improves is a message stream that drops an `interactiveUi` row
  while its ask is pending, and no such path exists (resolve and dismiss both
  keep the row; the sole row removal is `inlineTerminal`). It also required a
  companion "never rendered nowhere" fallback, whose interaction with the
  widget-bar category produced contradictory requirements twice. Revisit when a
  transcript-pruning, windowing, or compaction feature makes the path
  reachable — that feature is the right place to carry the cost.
- **No grouping threshold.** A "panel only when 2+ asks" rule was designed and
  **rejected**: the panel keys cards by `requestId` while the inline stream keys
  them by `msg.id`, so crossing the 1↔2 boundary remounts the card and React
  discards the renderer instance — losing `BatchRenderer`'s accumulated answers
  mid-wizard and `InputRenderer`'s typed text. Both directions fire from events
  outside the affected user's control. The spec now forbids it explicitly.
- **No panel anchoring** to an arrival position.
- **No embed-surface work.** `chat-embed/index.ts:71` re-exports `ChatView`, so
  embedders mounting it get `MultiAskPanel`. A host using the documented
  headless path (`useSessionState`) renders its own prompt surface.
- **No migration to the protocol `placement` field.** Widget-bar ownership stays
  a component-type registry decision; the producer-declared field remains
  unconsulted. The spec now says so rather than leaving it ambiguous.
- No cleanup of the pre-PromptBus orphans (`trackUiRequest` and friends).

## Discipline Skills

- `doubt-driven-review` — already applied: three cycles (single-model plus
  cross-model on `@propose-review-1`) shaped this change, and are the reason its
  scope is what it is.
- `review-code` — inline review of the added tests before commit.

No auth/secrets/PII/untrusted-input/webhook surface and no latency or
throughput budget is touched, so `security-hardening`,
`performance-optimization`, and `observability-instrumentation` do not apply.
