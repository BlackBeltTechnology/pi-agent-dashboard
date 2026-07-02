## Why

The `⋯` overflow menu on each automation definition card (Edit / Delete) never appears when clicked. The card's `<li>` carries `overflow-hidden` (needed to clip the decorative glow / stripe / ring / rail FX to the rounded border), so the absolutely-positioned menu — which opens downward from a button on the card's bottom action row — is clipped out of existence. Users cannot reach Edit or Delete, making valid automations un-editable and un-deletable from the board.

## What Changes

- Replace the hand-rolled `absolute … z-10` dropdown in `AutomationBoard.tsx` with the existing `ui:popover` primitive (body-mounted portal), so the menu renders **over** the card and escapes the `overflow-hidden` clip.
- Anchor the popover to the `⋯` button via a `ref`; render Edit / Delete as its content.
- Popover already handles outside-click / Esc dismissal and viewport flip/shift — drop the bespoke `menuOpen` open/close plumbing in favor of the primitive's contract (keep a boolean to gate mount + anchor readiness).
- Preserve existing `data-testid`s (`overflow-<name>`, `overflow-menu-<name>`, `edit-<name>`, `delete-<name>`) so current tests keep asserting the same hooks.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `automation-content-view`: the overflow control's menu MUST render in a portal that escapes the card's `overflow-hidden`, so Edit/Delete are visible and clickable regardless of the card's clip or position near a scroll/viewport edge.

## Impact

- Code: `packages/automation-plugin/src/client/AutomationBoard.tsx` (overflow menu block, ~lines 397–409); `packages/automation-plugin/src/__tests__/AutomationBoard.test.tsx` (menu-visibility assertions).
- Dependencies: none new — `ui:popover` primitive (`UI_PRIMITIVE_KEYS.popover`) is already registered in `packages/client/src/main.tsx` and consumed by sibling automation components via `useUiPrimitive`.
- Behavior: no protocol/server change; purely client rendering of an existing control.
