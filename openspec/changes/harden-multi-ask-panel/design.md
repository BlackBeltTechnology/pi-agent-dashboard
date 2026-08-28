## Context

`#538` shipped three collaborating pieces:

- `derivePendingFreeFloating(messages, interactiveRequests)`
  (`pending-free-floating.ts`) — filters to `status === "pending"`, drops
  entries whose `requestId` maps to a `toolCallId` found by scanning
  `messages`, and drops widget-bar-owned components via
  `isWidgetBarPrompt(cmp.type)`.
- `ChatView` — memoises that list, derives `panelRequestIds`, hides the matching
  rows inline (`isRowVisible` → `false`, line 906), and renders `<MultiAskPanel
  requests={pendingFreeFloating} …/>` at the transcript bottom (line 1941).
- `MultiAskPanel` — returns `null` when `requests.length === 0`.

The synced spec describes only two of the three placement categories the code
implements. This change reconciles the text with the code. **It changes no
production source.**

## Goals / Non-Goals

**Goals**
- The written requirement cannot be implemented as a double-render.
- Behaviours the code already has — always-panel, pending-set placement
  stability — are stated rather than incidental.
- The behaviours the spec now asserts are covered by tests.

**Non-Goals**
- No `toolCallId`-on-the-request refactor, no missing-anchor fallback, no
  grouping threshold, no panel anchoring, no `placement`-field migration, no
  embed work, no orphan cleanup. Rationale for each: `proposal.md`.

## Decision 1 — Precedence, not a flat category list

The three categories are not naturally disjoint: nothing stops a widget-bar
registered component from being claimed inside a tool call, so one ask can be
*both* widget-bar owned and carrying a `toolCallId`. An earlier draft asserted
"three placement categories are mutually exclusive" and review showed that to be
wishful — the requirement issued two conflicting SHALLs for such an ask (render
in the slot only / keep inline paired with the tool row).

**Chosen:** state an explicit precedence order — widget-bar, then tool-paired,
then free-floating — so a multi-matching ask has exactly one defined placement.

This matches shipped behaviour. In `derivePendingFreeFloating` both checks
exclude from the panel, so panel membership is order-independent; but in
`ChatView.isRowVisible` the widget-bar branch hides the inline row, so the slot
wins the *render*. Precedence documents the resolution the code already makes.

## Decision 2 — Specify always-panel and pending-set stability

Both are current behaviour, unstated:

- `MultiAskPanel` returns `null` only on an empty list, so one pending ask
  yields a one-card panel.
- Nothing in the derivation depends on the *size* of the pending set, so no
  ask's placement moves when a sibling arrives or resolves.

The second is worth writing down because it is the property a plausible future
"optimisation" would break. The panel keys cards by `requestId`
(`MultiAskPanel.tsx:26-27`); the inline stream keys them by `msg.id`
(`ui-<requestId>`, `ChatView.tsx:1832-1836`). A card moving between the two is a
different key at a different tree position, so React discards the instance —
taking `BatchRenderer`'s `answers` array and wizard `step`
(`BatchRenderer.tsx:74-79`), `InputRenderer`'s typed value and images
(`:17-18`), and `EditorRenderer`'s draft (`:11`) with it. A "panel only when 2+"
rule would fire that on every 1↔2 crossing, in both directions, triggered by
events outside the control of the user whose input is destroyed.

Writing the invariant into the spec converts that from a trap a future author
must rediscover into a requirement they must consciously break.

## Decision 3 — Pin the unasserted behaviour with tests

The spec's assertions must be falsifiable, and two of them currently are not
tested at all:

- **Widget-bar exclusion** — `derivePendingFreeFloating` applies
  `isWidgetBarPrompt`, but no test covers it. This is the requirement whose
  absence caused the defect, so it gets the test.
- **Single-ask panel** — asserted implicitly by C4's first render in
  `multi-ask-panel.test.tsx`, not as its own case.

The precedence rule (widget-bar ask that also carries a `toolCallId`) is the
third: it is the case the flat category list got wrong, so it is worth an
explicit test even though the current code happens to satisfy it.

These are pure additions to the existing derive-level tests; no helper rework is
needed because classification still comes from the message row, exactly as the
current helpers assume.

## Risks

- **R1 — the spec now pins a heuristic.** Widget-bar ownership is decided by
  component-registry membership while the protocol carries an unconsulted
  producer-declared `placement`. Writing the registry rule into the spec makes
  current behaviour normative; a plugin declaring `placement:"widget-bar"` on an
  unregistered type still lands in the panel. Mitigated by stating the
  limitation in the requirement itself rather than silently implying the
  protocol field is authoritative.
- **R2 — a spec-only change can drift from code again.** The tests in Decision 3
  are the guard: each newly-written assertion gets a corresponding test, so the
  reconciliation is executable rather than prose-only.
- **R3 — the deferred provenance work stays deferred and forgotten.** The
  missing-anchor hazard is real but unreachable; `proposal.md` records the
  trigger condition (a transcript-pruning/windowing/compaction feature) so the
  next author of such a feature inherits the requirement rather than
  rediscovering the hole.
