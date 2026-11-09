# Proposal

## Why

The automation board was redesigned (`polish-automation-board`), but its selected card still uses the session card's rotating rainbow neon: two `card-glow-fx` halos plus a `card-ring-fx` rim, all a conic blue→violet→pink→cyan gradient. Every other selectable surface in the dashboard (pressed chips, sidebar toggles, OpenSpec group pills, the theme picker) uses the calm selected-chip recipe from `ui-contract.md`. The rainbow:

- clashes with the running barber-pole stripe and the status colours on the same card;
- adds three animated layers to every selected card, on a board that already animates running stripes;
- marks selection with colour and motion only; the card carries no `aria-current` and no non-colour text cue.

Making the automation selection match the selector style lets the board read as one system with the rest of the UI.

## What Changes

- The selected automation card drops all three host FX layers (`card-glow-fx` ×2 and `card-ring-fx`).
- The selected card keeps its `--accent` border and paints its **header row** (source icon, dot, name, scope, pill, actions), from the status rail to the right edge, with `--accent-soft`. The name becomes bold. The card body (schedule, last run, run history with its `--accent-text` links) stays on `--bg-secondary`, so those links keep AA contrast. `--accent-text` on `--accent-soft` measures 4.49:1 in the default dark theme, under the 4.5:1 floor.
- The selected card exposes `aria-current="true"`. Unselected cards carry no `aria-current`.
- The `GLOW_FX_CLASS`, `GLOW_FX_OUTER_CLASS` and `RING_FX_CLASS` exports are removed from `automation-card-visuals.ts`. The host FX classes stay in place, because `SessionCard` still uses them.
- The `automation-content-view` spec drops "the selected card SHALL render the neon rotating glow and rim" and the neon part of the reduced-motion scenario.
- Mockup: mockups/2026-11-09-automation-selection-style (in this change)
- Mockup: mockups/2026-11-06-addons-hub-tidy (in this change). Adopted at the user's request; this change does not implement it (see Non-goals).
- Mockup: mockups/2026-11-06-flows-edit-mode-folder-menu (in this change). Adopted at the user's request; this change does not implement it (see Non-goals).

## Non-goals

- The session card selection (iridescent ring, `session-card-selection` spec) is unchanged.
- The host FX CSS (`card-glow-fx`, `card-ring-fx`) and `HOST_FX_CLASSES` are not removed or changed.
- Status rail, dot, pill, stripe and button recipes are unchanged.
- The add-ons hub declutter and the flows folder edit-mode mocks are only stored with this change. Their UI is not built here.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `automation-content-view`: the "Board adopts the session-card status visual language" requirement replaces the selected-card neon glow/rim with the selected-chip recipe (accent border, accent-soft header row, bold name, `aria-current`), and its reduced-motion scenario no longer mentions neon.

## Impact

- `packages/automation-plugin/src/client/AutomationBoard.tsx`: `AutomationCard` root and header row classes, and the removed FX `<div>`s.
- `packages/automation-plugin/src/client/automation-card-visuals.ts`: drops the three FX constants.
- `packages/automation-plugin/src/__tests__/AutomationBoard.test.tsx`: new selection assertions.
- `packages/automation-plugin/src/client/AGENTS.md`: DOX rows for the two files.
- `ui-contract.md`: the selected-chip recipe gains a selectable-card variant (header-row fill).
- `mockups/mock-site.config.ts`: `@automation` alias (the adopted mock imports the real card helpers through it; mock-site only).
- No server, API or dependency changes.
