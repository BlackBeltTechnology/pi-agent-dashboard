# Goal plugin — sophisticated authoring & control mockups

Companion spec for `mockups/goal/index.html`. Open that file in a browser for the
themed, clickable screens. This doc is the textual wireframe + the wiring map.

## Why these mockups exist

The `goal` plugin (driver: `@ricoyudog/pi-goal-hermes`, a Pi port of Hermes's
"Ralph loop with a judge") already has a **rich data model and command surface**,
but the dashboard UI only exposes a single objective text box. The model is
starving the UI.

```
        WHAT EXISTS (server + extension)        WHAT THE UI EXPOSES TODAY
        ────────────────────────────────        ─────────────────────────
GoalRecord {
  objective                                     [ Goal objective…  Create ]   ← only this
  criteria[] {text, done}        ✗ display-only, never editable / addable
  budget {maxTurns, maxSpendUsd} ✗ never set in UI; not pushed into the loop
  status (pursuing/paused/        ~ 3 status buttons on detail page
          achieved/cleared)
  sessionIds[] / driverSessionId  ✓ link / spawn / unlink on detail page
}

pi-goal-hermes commands the dashboard can already emit:
  /goal <text>     ✓ wired
  /subgoal <text>  ✓ server maps action:"subgoal" … but NO UI ever calls it
  /goal pause|resume|done|clear  ✓ mapped … but loop controls were demoted off
                                   the session card and never rebuilt elsewhere
```

## Two gaps (keep them separate)

1. **Authoring gap** — can't set criteria / budget / judge model at create time.
   Mostly *surfacing existing plumbing* (criteria → `/subgoal`; budget already
   accepted by the REST layer).
2. **Live-control gap** — can't pause / resume / mark-done / add-subgoal from the
   board or detail page, and there's no per-turn judge verdict history. The
   server already maps these actions to `/goal …` commands; the surface is missing.

## Sophistication dimensions (grounded in pi-goal-hermes / Hermes)

| Dimension | Source of truth | Surfaced today | Mockup element | Wiring |
|---|---|---|---|---|
| Objective | dashboard `objective` | yes | A: text input | exists |
| Acceptance criteria / checklist | `/subgoal`, `criteria[]` | display-only | A+C: editable checklist | exists (surface) |
| Turn budget (`maxTurns`, def 20) | extension + `budget.maxTurns` | no | A+C: stepper + gauge | partial |
| Spend cap (`maxSpendUsd`) | `budget.maxSpendUsd` | no | A+C: cap + gauge | partial |
| Judge model (`judgeModel{provider,modelId}`) | extension setup | no | A+C: model picker + cross-model badge | **new** |
| Same-model self-judge opt-in | extension | no | A: toggle | **new** |
| Per-turn verdict history (`lastVerdict`) | snapshot stream | chip only | C: verdict timeline | **new** |
| Lifecycle controls | `/goal pause\|resume\|done\|clear` | demoted | C: control bar | exists (surface) |
| Delete goal | `DELETE /api/folders/goals/:id` + `deleteGoal()` | **no UI** | C: control bar · B: card overflow | exists (surface) |

Legend used in the HTML:
`surfaces existing` = plumbing exists, just draw UI · `partial` = stored but not
pushed into the live loop · `needs new wiring` = new server↔extension contract.

## Visual language — reuses the OpenSpec / session grammar

The mockups deliberately adopt the dashboard's existing OpenSpec-board and
session-card design primitives so goals read as a native surface, not a bolt-on:

- **State pills** — mirror `components/StatePill.tsx` (uppercase, 9px,
  color-by-state). Goal lifecycle maps onto the same shades: `PURSUING` → amber
  (the `IMPLEMENTING` "working" shade) · `JUDGING` → blue · `PAUSED` → zinc ·
  `ACHIEVED` → green (`COMPLETE`).
- **Status dots** — mirror `lib/session-status-visuals.ts`: green = active,
  yellow `animate-pulse` = streaming/working, zinc = paused, muted = ended.
- **Neon glow** — ported `.card-glow-fx` / `.card-ring-fx` (rotating
  blue→violet→pink→cyan conic, 13s) wraps the **live (PURSUING) card** and the
  detail panel header — same cue the dashboard uses for an active session.
- **Working stripes** — the amber 45° barber-pole (`.card-stripes-running`) on the
  pursuing card.
- **Goal-loop stepper** — mirrors `components/OpenSpecStepper.tsx`: circular
  border-2 nodes (letter / icon), done = green check, current = orange
  `box-shadow` pulse. Goal loop reads `Set → Pursue ⟳ Judge → Achieve`, with the
  live turn count under the current node.

## Screens

### A · Create / Edit goal — _replaces the single text box_
Objective · editable acceptance-criteria list (add/remove, each → `/subgoal`) ·
Judge & budget block: judge-model picker (cross-model default), turn budget,
spend cap, same-model self-judge toggle · Cancel / Create.

### B · Goals board — _enriched cards_
Unchanged shell (back / refresh / + New Goal, All/Pursuing/Paused/Achieved
filters). Cards gain: status badge · live `● turns/budget` ring · last judge
verdict (`continue` / `satisfied` / `paused: budget`) · `n/m criteria` · spend
bar · linked-session count · a `⋯` overflow with Delete.

### C · Goal detail — _solves the live-control gap_
Definition header with judge-model pill · **loop control bar** (Pause / Resume /
Mark done / + Subgoal / Clear, each annotated with its `/goal …` command, plus a
right-aligned **🗑 Delete goal** → `DELETE /api/folders/goals/:id`, confirm +
unlinks sessions) · dual **budget gauges** (turns, spend) · **editable criteria**
· **judge verdict timeline** (turn-by-turn judge calls + criterion completions) ·
linked-sessions list (driver tag, open, unlink, new, link existing).

### D · Session-card goal chip — _live state inline_
Today: bare `⚑ Goal →` link. Proposed: `⚑ 7/20 · judge continue` with an inline
⏸ (→ `/goal pause`) and → (open detail). Surfaces live loop state without
opening the goal.

## What needs new wiring (feeds the OpenSpec proposal)

- **Judge model + same-model toggle** — dashboard has no field for
  `judgeModel{provider,modelId}` and the server's `goalCommandFor` never passes
  it to the extension. Needs: `GoalRecord.judge?` field + an extension command/
  setup path to set the judge model per goal.
- **Budget → live loop** — `budget.maxTurns` / `maxSpendUsd` are persisted but
  `goalCommandFor` only emits `/goal <text>` and `/subgoal <text>`; budget never
  reaches the loop. Needs a command/param to push budget into the extension.
- **Goal deletion** — NOT new wiring: `DELETE /api/folders/goals/:id` and the
  `deleteGoal()` client wrapper already exist (and clear `goalId` on linked
  sessions); only the UI affordance + confirm is missing. Listed here for
  completeness — it is `surfaces existing`, not `needs new wiring`.
- **Verdict timeline** — the snapshot carries only `lastVerdict` (latest). A
  per-turn history needs the bridge to accumulate verdicts (or the extension to
  emit them) and the server to retain them per goal.

See `openspec/changes/sophisticate-goal-authoring-and-control/` for the proposal.
