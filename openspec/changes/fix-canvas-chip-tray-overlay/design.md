## Context

See proposal.md (Why). Current state, cited:

- `packages/client/src/App.tsx:2977` mounts `<CanvasDriver state=… />` as the first
  child inside `SplitWorkspaceProvider`, before `SessionDiffProvider`/`{children}`.
- `packages/client/src/components/canvas/CanvasDriver.tsx` (return block, ~:117)
  renders `<div data-testid="canvas-chip-tray" className="flex flex-wrap items-center gap-2 px-3 py-1">`.
  That is an in-flow block, so it lands in the layout flex tree.
- `openspec/specs/overlay-layering/spec.md:54-68` ("Box-escaping overlays SHALL
  portal to a top-level layer root") forbids inline-positioned overlays. Same-layer
  ties break by portal mount order (`:52`). The portal primitive is
  `LayerPortal` from `@blackbelt-technology/pi-dashboard-client-utils/LayerPortal`
  (used by `components/settings/ModelSelector.tsx:770`).
- The layer scale is defined in `packages/client/src/index.css:47-50,75-78`:
  `z-overlay` 30 < `z-popover` 40 < `z-dialog` 50 < `z-toast` 60.
  `WorktreeInitStack` (`components/worktree/WorktreeInitStack.tsx:51`) is an
  inline `fixed bottom-4 right-4 z-overlay` element (not portaled), mounted inside `{children}`.
- The composer stack in `renderSessionDetail` (`App.tsx:2254`) is several sibling rows in
  a flex column: `composer-context-strip` (`:2494-2500`, when `selectedSession && !readOnly`),
  then `StatusBar`, `QueuePanel` and `CommandInput` (`:2537-2561`, when `!readOnly`).
  `CommandInput` renders the `composer-panel` plugin slot inside its own root (`CommandInput.tsx:1260`).
- `renderSessionDetail(id, frozen)` is also called with `frozen = true` for
  route-backed overlay underlays (`App.tsx:3185-3361`), so a second, hidden composer stack
  can be mounted at the same time as the live one.

## Goals / Non-Goals

**Goals:** the tray never takes part in layout and floats above the whole composer stack.

**Non-Goals:** redesigning chip visuals; moving `CanvasDriver`'s auto-open
effect; changing canvas behaviour (auto-open, mobile gate, tap foreground);
de-conflicting `WorktreeInitStack`'s own placement.

## Decisions

**D1 — portal the tray via `LayerPortal` on `z-overlay`.** `CanvasDriver` stays at
`App.tsx:2977` because its effects need `SplitWorkspaceProvider`. Its tray renders inside
`<LayerPortal>` as `fixed z-overlay pointer-events-none flex flex-col items-end gap-2`,
with `right: 1rem`, `max-width: calc(100vw - 2rem)` and each chip `pointer-events-auto`.
This satisfies the `overlay-layering` portal requirement and escapes any ancestor
stacking context. Rejected: `fixed` without a portal, which the spec forbids and which
regresses as soon as an ancestor gains `transform`. Rejected: a chat-column slot, which
needs new slot plumbing through every session layout.

**D2 — anchor on a zero-height sentinel at the top of the live composer stack.**
App owns both `CanvasDriver` and the composer stack. In `renderSessionDetail`, when
`!frozen && !readOnly`, App renders `<div aria-hidden data-testid="composer-stack-anchor"
className="h-0 shrink-0" ref={setComposerAnchor} />` immediately before
`composer-context-strip`. Its top edge equals the stack's top edge whichever rows
(strip, `StatusBar`, `QueuePanel`, `CommandInput` with its `composer-panel` slot) are
rendered. `StatusBar` and `QueuePanel` return `null` when idle or empty
(`components/shell/StatusBar.tsx:40`, `components/session/QueuePanel.tsx:56`), and neither forwards a ref, so the anchor cannot
be one of them. The callback ref writes React state (`useState<HTMLElement | null>`), so
unmount explicitly yields `null`, which selects the fallback. App passes the element as
`<CanvasDriver anchor={…} />`. The prop is **optional** (`anchor?: HTMLElement | null`):
absent or `null` means the safe-area fallback, so existing call sites and tests that render
`<CanvasDriver state={…} />` keep compiling.

Rejected: a wrapper `<div>` around the stack. `composer-root` sizes itself with
`max-h-[40%]` against its flex parent (`components/chat/CommandInput.tsx:949`,
fix-quota-widget-clipping), and a wrapper would change that percentage base. The
sentinel adds no box height and no gap unit: the composer rows are direct children of
the chat pane, which `SplitWorkspace.tsx:106-112` renders as a `flex flex-col` with no
`gap`/`space-y`. Rejected: a global `--composer-h` CSS variable
written by `CommandInput`: it measures only the composer, leaks into `chat-embed`
hosts, and has no owner.

**D2a — offset maths.** `CanvasDriver` computes
`bottom = viewportBottom − anchor.getBoundingClientRect().top + 8px`, where
`viewportBottom = visualViewport ? visualViewport.offsetTop + visualViewport.height : innerHeight`.
This keeps the tray above the soft keyboard, where `innerHeight` does not shrink.
The sentinel is 0×0, so observing it alone never fires when the stack grows: the
stack's growth moves the sentinel without resizing it. `CanvasDriver` therefore
observes, with one `ResizeObserver`, every element that follows the sentinel in its
parent (the strip, `StatusBar`, `QueuePanel`, `composer-root`, and anything else in the
stack). A `MutationObserver` (`childList`) on that parent re-collects the set when a row
mounts or unmounts (e.g. `StatusBar` appearing as streaming starts). It also
re-measures on window/`visualViewport` `resize`,
with `typeof ResizeObserver !== "undefined"` and `window.visualViewport?.` guards
(jsdom has no `visualViewport`). All observers and listeners are disconnected on cleanup. With no anchor,
`bottom` is `calc(1rem + env(safe-area-inset-bottom))`. While an anchor exists but has
not been measured yet, the tray renders `visibility: hidden`, so it never flashes at
the fallback position and covers the composer.

**D2b — frozen underlay.** On desktop, live session content is not rendered while a
route-backed overlay is open: the `App.tsx:3129` desktop gate checks
`!settingsMatch && !previewOverlayOpen && …`. The frozen copy exists only as
`RouteBackedOverlay backgroundContent` (`App.tsx:3185-3361`). On mobile, overlay routes
replace the detail panel (`App.tsx:3073-3089`), and the mobile and desktop shells never co-render (`App.tsx:3005`). Live and frozen stacks therefore do not
co-mount, and the `!frozen` condition on the sentinel is a defensive guard that
makes this explicit. While a dialog is open the tray has no anchor, falls back to
bottom-right, and is painted under the dialog (`z-overlay` < `z-dialog`).

**D2c — chip width.** Every flex level in the chain must be allowed to shrink. The tray
child, the `CanvasServerChip` outer `div` and both chip `<button>`s (server chip in
`CanvasServerChip.tsx:83-96`, mobile file chip in `CanvasDriver.tsx:103-116`) gain
`min-w-0 max-w-full`. The label/title/path spans gain `min-w-0 truncate`, and the icon and
`:port` span gain `shrink-0`. This is a layout safeguard, not a visual redesign.

**D3 — `z-overlay` layer.** Composer popovers (`z-popover`), dialogs and toasts paint
over the tray. `WorktreeInitStack` (inline `fixed z-overlay`) shares the layer value, but
the tray is portaled to `document.body` (`packages/client-utils/src/LayerPortal.tsx:58-70`).
The `overlay-layering` mount-order tie-break covers two portaled overlays, which this
pair is not. Here plain DOM order decides: the portal node comes after the app root, so
at equal z-index the **tray paints on top** of the inline stack. Accepted: both are transient and the chips are
small. Recorded as a risk.

## Risks / Trade-offs

- [The tray can cover part of the `WorktreeInitStack` card while a worktree inits]
  → accepted and transient. A follow-up can stack the two in one corner region.
- [The markdown preview replaces chat + composer on tablet/mobile] → the anchor
  unmounts and the tray falls back to bottom-right over the preview. Accepted: the
  chip is a small tap target and the preview is scrollable.
- [`getBoundingClientRect` on every resize] → it runs only on observed size or
  viewport changes, not per render. One style write, no React state churn.
- [The mobile soft keyboard shrinks the visual viewport] → the `visualViewport`
  resize listener recomputes. The device check is manual.

## Migration Plan

None. Client-only. Ship with `npm run build` + `/api/restart`. Rollback: revert.
