# Proposal

## Why

GitHub issue #1158: the folder Automations page (`/folder/:encodedCwd/automations`) has no scrollbar. Once the definitions list and its run history grow taller than the overlay, the bottom cards are cut off and cannot be reached. The board root is a plain flex column with no scroll container, and every host it mounts in (desktop dialog, mobile detail panel) clips overflow. This breaches the existing `shell-overlay-route` requirement "Route-backed overlay content SHALL be reachable". The run monitor route (`/automations/run/:sid`) has the same pattern. The overlay-layout E2E gate (`tests/e2e/overlay-layout.spec.ts` E8) already opens the automations route, but it only sees short fixture content, so the bug slipped through.

## What Changes

- The `AutomationBoard` root (both branches) becomes its own vertical scroll container that fills the slot (`flex-1 min-h-0 overflow-y-auto`, the sizing rule for flush dialog children in `dialog-system`).
- The header row holding Back becomes `sticky top-0`, following the `KbSettingsPanel` layout of an unpadded scroller, a sticky header and a padded body. Back is the only way to dismiss the flush plugin overlay and must not scroll out of view.
- `AutomationRunMonitor` gets the same structure, plus a `data-testid` on its Back button.
- Long names and paths wrap or truncate, so no horizontal scrollbar appears.
- `CreateAutomationDialog` is verified at desktop and mobile widths, and portalled to `document.body` only if the mobile panel clips it.
- No host or shell change: the plugin slot already provides a definite-height `flex-1 min-h-0 relative` wrapper. The claim body is responsible for its own scrolling.
- Regression coverage, driven by `test-plan.md`: Playwright tall-content reachability for the board (desktop + mobile) and the run monitor, plus cheap unit guards on the class tokens.
- Close GitHub issue #1158 once the fix is merged.

Out of scope: issue #1153 (Directory menu not scrollable on 13-inch). It has the same class of symptom but a different component, so it gets its own change.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `automation-content-view`: adds a requirement that the automation board and run monitor overlay surfaces keep all their content reachable by scrolling inside their own container.

## Impact

- `packages/automation-plugin/src/client/AutomationBoard.tsx` (root containers)
- `packages/automation-plugin/src/client/AutomationRunMonitor.tsx` (root container)
- `packages/automation-plugin/src/__tests__/AutomationBoard.test.tsx`, `AutomationRunMonitor.test.tsx`
- `tests/e2e/overlay-layout.spec.ts`
- No API, protocol, server, or dependency changes.

## Discipline Skills

None apply. This is a CSS-only client layout fix: no auth or untrusted input, no latency budget, no new endpoint, and no irreversible step. `review-code` runs as the standard pre-commit checkpoint.
