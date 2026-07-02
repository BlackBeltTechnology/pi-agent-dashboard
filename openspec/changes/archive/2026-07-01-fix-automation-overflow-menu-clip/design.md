## Context

Each automation definition renders as an `<li>` in `AutomationBoard.tsx`. The `<li>` uses `relative isolate flex overflow-hidden rounded border`. `overflow-hidden` is load-bearing: it clips the decorative glow / stripe / ring / rail FX layers to the card's rounded border. The bottom action row hosts `▶ Run now`, `Enable/Disable`, and a `⋯` overflow button whose menu (Edit / Delete) is an `absolute left-0 z-10 mt-1` `<div>` inside a `relative` wrapper. Because the menu opens downward from a button at the card's bottom edge, and the `<li>` clips overflow, the menu is painted-then-clipped and never seen. `z-10` is irrelevant — clipping happens before stacking.

The codebase already ships a `ui:popover` primitive (`packages/client-utils/src/Popover.tsx`, registered in `packages/client/src/main.tsx`): a body-mounted portal anchored to a DOM element, with viewport flip/shift positioning and outside-click / Esc dismissal. Sibling automation components (`AutomationRunMonitor`, `CreateAutomationDialog`) already resolve primitives via `useUiPrimitive(UI_PRIMITIVE_KEYS.*)`. The automation-plugin already depends on the runtime + shared packages that expose these.

## Goals / Non-Goals

**Goals:**
- Overflow menu (Edit / Delete) is visible and clickable when `⋯` is pressed.
- Menu escapes the card's `overflow-hidden` clip and stays in-viewport near edges / in scroll containers.
- Preserve the FX-clipping `overflow-hidden` on the card unchanged.
- Preserve existing `data-testid` hooks.

**Non-Goals:**
- No change to FX layers, rail, or card layout.
- No new dependency; no server/protocol change.
- No redesign of the action row or the other buttons (`Run now`, `Enable/Disable`, `Stop`).

## Decisions

**Use the `ui:popover` primitive instead of an inline `absolute` menu.**
Rationale: the primitive portals to `document.body`, so it renders outside the `overflow-hidden` ancestor by construction — the literal "open it OVER the box." It also already solves outside-click, Esc, resize/scroll reposition, and viewport flip/shift, deleting bespoke code rather than adding it.

- Alternative A — open upward (`bottom-full mb-1`): 1-line, but the menu still lives inside the clipped box; a short card or tall menu re-clips. Rejected as fragile.
- Alternative B — move `overflow-hidden` onto an inner FX-only wrapper, leave `<li>` unclipped: structurally clean but touches the FX stacking/layout and risks visual regressions across four decorative layers. Heavier than warranted for a menu bug when a portal primitive already exists.
- Alternative C — floating-ui: overkill; the in-repo primitive already covers positioning.

**Anchor via `ref` on the `⋯` button.**
`Popover` requires `anchorEl: HTMLElement`. Attach a `useRef<HTMLButtonElement>` to the `⋯` control; mount the popover only when open AND `ref.current` is non-null. Keep a boolean `menuOpen` state to gate mount; `onDismiss` sets it false. `CardBtn` currently renders its own `<button>`; the ref must reach that element (pass a ref-capable prop or wrap the trigger).

**Keep `data-testid`s.** Put `overflow-<name>` on the trigger, `overflow-menu-<name>` on the popover content container, and `edit-<name>` / `delete-<name>` on the items so existing tests assert unchanged hooks.

## Risks / Trade-offs

- [`CardBtn` does not forward a ref] → either extend `CardBtn` to accept/forward a ref, or render the `⋯` trigger as a plain button styled like `CardBtn`. Prefer the smallest change that keeps visual parity.
- [Test harness must provide the popover primitive] → sibling tests already wrap with a UI-primitive provider (`withUiPrimitiveProvider`); reuse it so the popover resolves in `AutomationBoard.test.tsx`.
- [Portal render breaks a test that queried the menu inside the card `<li>`] → assert on the body-level `overflow-menu-<name>` testid rather than DOM-nesting under the card.

## Migration Plan

Client-only, no data/persistence impact. Ship with the client build; no rollback beyond reverting the component change.

## Open Questions

- Extend `CardBtn` with `forwardRef` vs. inline a styled trigger button for `⋯`? Decide at implementation for the least-invasive diff (lean toward `forwardRef` if `CardBtn` is used for other ref-needing triggers later; otherwise inline).
