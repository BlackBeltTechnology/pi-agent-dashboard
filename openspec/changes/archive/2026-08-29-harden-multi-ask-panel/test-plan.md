# Test Plan — harden-multi-ask-panel

Stage: design   Generated: 2026-08-28

This change alters **no production source** — it reconciles the written
requirement with shipped behaviour. So every scenario below is a *characterisation
test*: it must pass against today's code. Value comes from the rows that are
currently **unasserted** (E3, E4, F3) — those are the ones whose absence let the
spec drift into mandating a double-render.

Placement is decided by two independent booleans on a pending ask —
`hasToolCallId` × `isWidgetBarType` — so the requirement is a **decision table**
with four combinations. E1–E4 enumerate all four; that is the technique's whole
point and it is what pins the new precedence rule.

Concrete harness values (no invented slots):
- `architect-prompt` is a **built-in** widget-bar registered type
  (`prompt-component-registry.ts`), so no plugin registration is needed to
  exercise widget-bar rows.
- An unregistered type falls back to `generic-dialog` (`placement: "inline"`),
  which is how a non-widget-bar ask is expressed.
- The widget-bar signal reaches the helper as
  `params._promptBusComponent = { type: "architect-prompt" }`.

Scope note (not a gap): the client-shell obligation the spec can assert is
"SHALL NOT be pulled into the panel", observable on
`derivePendingFreeFloating`. "SHALL render in that slot" is the widget-bar
host's own contract and is not re-asserted here.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 precedence §3 free-floating | decision-table (¬tcid, ¬wb) | L1 | automated | pending `p1`, no `toolCallId`, no `_promptBusComponent` | `derivePendingFreeFloating(messages, requests)` | returns `["p1"]` — `p1` belongs to the panel |
| E2 | R1 precedence §2 tool-paired | decision-table (tcid, ¬wb) | L1 | automated | pending `p3` whose `interactiveUi` row carries `toolCallId: "tool-call-1"`, plus free-floating `p1` | same call | returns `["p1"]` — `p3` excluded |
| E3 | R1 precedence §1 widget-bar | decision-table (¬tcid, wb) | L1 | automated | pending `pw` with `params._promptBusComponent = { type: "architect-prompt" }`, no `toolCallId`, plus free-floating `p1` | same call | returns `["p1"]` — `pw` excluded from the panel |
| E4 | R1 precedence §1 beats §2 | decision-table (tcid, wb) | L1 | automated | pending `pw` with `_promptBusComponent.type = "architect-prompt"` **and** row `toolCallId: "tool-call-9"`, plus free-floating `p1` | same call | returns `["p1"]` — `pw` excluded; widget-bar wins, no inline pairing claimed |
| E5 | R1 unregistered type is not widget-bar | decision-table (negative) | L1 | automated | pending `pu` with `_promptBusComponent = { type: "definitely-not-registered" }`, no `toolCallId` | same call | `pu` IS returned — unknown types fall back to `generic-dialog`/inline, so they are free-floating (pins the documented R1 limitation) |
| E6 | R1 always-panel, single ask | EP (n=1 boundary) | L1 | automated | `MultiAskPanel requests=[p1]` | render | `multi-ask-panel` node present with exactly one `multi-ask-card-*` |
| E7 | R1 always-panel, empty set | EP (n=0 boundary) | L1 | automated | `MultiAskPanel requests=[]` | render | no `multi-ask-panel` node |
| E8 | R1 batch clause scoped to panel members | decision-table | L1 | automated | pending `method:"batch"` `pb` whose row carries a `toolCallId`, plus free-floating `p1` | `derivePendingFreeFloating` | returns `["p1"]` — a tool-paired batch ask does not enter the stack |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R1 late arrival appends | state-transition 1→2 | L1 | automated | panel rendered with `[p1]` | rerender with `[p1, p2]` | two `multi-ask-card-*` nodes; `p1` still present |
| F2 | R1 drain hides panel | state-transition 2→0 | L1 | automated | panel rendered with `[p1, p2]` | rerender with `[]` | no `multi-ask-panel` node |
| F3 | R1 placement stability wrt pending set | state-transition + state-preservation | L1 | automated | panel with one `method:"input"` ask `p1`; user types `"hello"` into its field | a sibling ask `p2` arrives (rerender `[p1, p2]`) | `p1`'s input still reads `"hello"` — card was not remounted. **Falsifies any future 2+ grouping rule**, which would move `p1` between trees and clear it |
| F4 | R1 independent resolution | state-transition | L1 | automated | panel with `[p1, p2]` | click confirm on `p2` | `onRespondToUi` called exactly once, with `"p2"` |

### Performance

None. This change adds no code path, no load, and no latency budget.

### Error-handling

None. No dependency, fault, or failure mode is introduced or altered; the
change is specification text plus characterisation tests.

---

## Coverage summary

- Requirements covered: 1/1 (the single MODIFIED requirement, all four
  precedence combinations plus the always-panel, batch-scoping and stability
  clauses)
- Scenarios by class: edge 8 · perf 0 · frontend 4 · error 0
- Scenarios by level: L1 12 · L2 0 · L3 0
- Scenarios by disposition: automated 12 · manual-only 0

Everything routes to L1: the requirement is a pure predicate over
`interactiveRequests` plus a component that renders from props. No process,
install, or live-bridge behaviour is involved, so neither the qa/ smoke tier
nor the Playwright tier is engaged — routing either there would be a
downgrade-to-smoke or a harness cost with no added signal.

## New infra needed

None. `multi-ask-panel.test.tsx` already renders `MultiAskPanel` via
Testing Library and exercises `derivePendingFreeFloating` directly; every row
above extends that file's existing harness.
