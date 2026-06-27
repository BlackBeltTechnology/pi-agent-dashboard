# Design — improve-dashboard-attention-routing

## Context

Grounded review (live :8000 + source) of the session-card attention signals.
Every UX decision below cites an external documented rule per the
`frontend-mockup-loop` corpus (Nielsen heuristics, Laws of UX, WCAG 2.2).

### Current state machine (as built)

| State (`session`) | `ActivityIndicator` | rail (`deriveRailBgColor`) | dot (`deriveDotColorWithFlags`) | card overlay (`getCardPulseClass`) |
|---|---|---|---|---|
| `currentTool==="ask_user"` (chat) | purple "Waiting for input" | **none → green** (no branch) | **none → green** (no branch) | `card-input-stripes` (purple) |
| `streaming` / `currentTool` | green "Thinking…" / yellow tool | amber | yellow | `card-working-pulse` |
| `resuming` | yellow "Resuming…" | amber | yellow | `card-working-pulse` |
| `hasError` | (chat) | red | red | — |
| `idle` / `active` | grey "Waiting for input" | green | green | `card-unread-pulse` if unread |
| `ended` | — | surface | surface | — |

The two rows in **bold** are the bug: `ask_user` collides with `idle/active` on
both rail and dot, and shares the `"Waiting for input"` string.

## Goals / Non-Goals

**Goals**
- "Needs you" becomes the single most isolated, multi-channel state (Von Restorff).
- Differentiation never relies on hue alone (WCAG 2.2 §1.4.1).
- Tokenize status color so the 4 themes stay consistent (ui-contract rule).
- Make blocked sessions findable without scanning (rollup + opt-in sort).

**Non-Goals**
- No server / event-pipeline / `DashboardSession` schema change.
- No change to push notifications (separate change).
- No change to the streaming barber-pole / unread-stripe animations (only the
  *static* rail+dot colors and the label gain an `ask_user` branch).

## Decisions

### D1 — Add `ask_user` to the color precedence chain
`deriveRailBgColor` and `deriveDotColorWithFlags` gain an `ask_user` branch
(suppressed when `useHasWidgetBarPrompt` owns the prompt, mirroring existing
`getCardPulseClass` logic). Precedence: `error` > `ask_user` > `resuming`/`retry`
> `streaming`/`tool` > `active`/`idle` > `ended`. Why above streaming: a blocked
agent is doing nothing useful until the user acts — it outranks "busy".
*Rule: Von Restorff isolation; H1 visibility of status.*

### D2 — Disambiguate the label
`ActivityIndicator`: `ask_user` → **"Needs you"** (was "Waiting for input");
`idle`/`active` → **"Idle"** (was "Waiting for input"). Distinct strings remove
the H4 consistency violation; the flow-routed / widget-bar suppression rule is
unchanged. *Rule: H4 consistency & standards; H2 match real world.*

### D3 — Dot shape as the non-hue channel
The status dot encodes state by **shape** as well as color:
needs-you ●(filled) · working ◐(pulsing/half) · idle ○(ring) · error ✕.
This survives reduced-motion and color-blind viewing — the
`session-card-status` spec already mandates a static reduced-motion cue; this
extends it to the dot. *Rule: WCAG 2.2 §1.4.1 use of color.*

### D4 — Semantic status tokens (the contract)
Replace `purple-400` / `green-500` / `amber-500` / `red-500` literals in the
status helpers with `--status-needs-you` / `--status-idle` / `--status-working`
/ `--status-error`, defined per theme. Keeps cross-theme consistency and lets a
theme tune urgency contrast to pass 3:1 UI-contrast. *Rule: ui-contract — every
value references a token, never a literal.*

### D5 — Needs-you rollup (recognition over recall)
Folder header shows a compact clickable *"N need you"* pill when ≥1 child
session is `ask_user`; click scrolls to / filters the blocked ones. Hidden at 0.
Optional global header mirror. *Rule: H6 recognition rather than recall; reduce
scan cost.* Reuses the existing per-folder session aggregation already computed
for `deriveProposalCardState`.

### D6 — Opt-in urgency sort (Tesler / user control)
A per-folder display-pref (default **off**) floats `ask_user` sessions to the
top of the active list. Default-off preserves the user's stable spatial memory
(Jakob's Law) for those who prefer fixed order; opt-in absorbs the complexity
for power users with many sessions. *Rule: H7 flexibility & efficiency; H3 user
control.*

## Risks / Open Questions

- **Q1**: token contrast — `--status-needs-you` must hit ≥3:1 against
  `--bg-tertiary` in all 4 themes. Verify in the mockup TEST step; may need a
  per-theme shade. Hard gate.
- **Q2**: precedence vs `unread` overlay — `ask_user` color (rail/dot) is
  independent of the `card-*-stripes` overlay; confirm they reinforce, not
  fight (existing precedence in `getCardPulseClass` already puts ask_user top).
- **Q3**: rollup placement on mobile folder header — limited width; may collapse
  to an icon+count. Resolve in MOCKUP at 375px.
- **Q4**: should urgency sort be global default-on later? Out of scope; ship
  opt-in, measure, revisit.

## Verification approach (frontend-mockup-loop)

1. axe + contrast pass on the 4 themes (hard gate, Q1).
2. HTML mockups in `mockups/` (dark+light, 3 breakpoints), `serve_mockup`.
3. `score_mockup` 22-item rubric until green.
4. PROMOTE in an isolated env (`isolated-ui-verification`), never against :8000.
