## 1. Tests first (TDD)

- [x] 1.1 In `AutomationBoard.test.tsx`, ensure the render harness supplies the `ui:popover` primitive (reuse `withUiPrimitiveProvider` as sibling tests do).
- [x] 1.2 Add a failing test: clicking `overflow-<name>` renders `overflow-menu-<name>` with visible `edit-<name>` and `delete-<name>` items, queried at the document/body level (not nested under the card `<li>`).
- [x] 1.3 Add a failing test: outside click and Esc close the menu without firing Edit/Delete callbacks.
- [x] 1.4 Run `npm test` for the automation-plugin suite; confirm the new tests fail for the right reason (menu not portaled).

## 2. Replace inline dropdown with the popover primitive

- [x] 2.1 In `AutomationBoard.tsx`, resolve the popover via `useUiPrimitive(UI_PRIMITIVE_KEYS.popover)` (import `UI_PRIMITIVE_KEYS` + `useUiPrimitive` as sibling components do).
- [x] 2.2 Attach a ref to the `⋯` trigger (extend `CardBtn` with `forwardRef`, or inline a `CardBtn`-styled `<button>`) so it can serve as `anchorEl`.
- [x] 2.3 Replace the `absolute … z-10 mt-1` menu block with `<Popover anchorEl={ref.current} onDismiss={() => setMenuOpen(false)}>`, mounted only when `menuOpen && ref.current`.
- [x] 2.4 Move Edit / Delete `CardBtn`s inside the popover content; keep `data-testid`s `overflow-<name>`, `overflow-menu-<name>`, `edit-<name>`, `delete-<name>`.
- [x] 2.5 Remove the now-dead bespoke open/close markup and any unused `relative` wrapper; keep `menuOpen` state as the mount gate.

## 3. Verify

- [x] 3.1 `npm test` — automation-plugin suite green (169/169; AutomationBoard 14/14).
- [x] 3.2 Type-check clean (`tsc -p packages/automation-plugin/tsconfig.json --noEmit` exit 0).
- [x] 3.3 Manual/e2e sanity: on the board, `⋯` opens a visible menu over the card near the bottom edge; Edit and Delete work; outside-click/Esc dismiss. (User-confirmed on the running production build.)
- [x] 3.4 Confirm card FX (glow/stripe/ring/rail) still clipped to the rounded border — `<li>` `overflow-hidden` + FX layers untouched (diff scoped to overflow menu + `CardBtn` forwardRef).
