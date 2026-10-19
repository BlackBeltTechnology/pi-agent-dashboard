## Context

See proposal.md for the motivation, and `specs/session-actions-menu/spec.md` for the contract.

Current state (cited):
- **Trigger component.** `SessionActionsMenu.tsx:91-116` renders the trigger inside `<span className="relative inline-flex">`. The `<button>` uses `min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px]`, `mdiDotsVertical`, and `onPointerEnter`/`onFocus` panel prefetch. The same component renders the lazy panel through `LayerPortal`.
- **Mount point.** `SessionCard.tsx:1460` mounts `<SessionActionsMenu>` in the header row, between Archive and ✕.
- **Card root.** `SessionCard.tsx:1342`: `relative isolate pl-1.5 pr-2 py-2 … border` (1 px border), `group/card`, `hover:-translate-y-0.5`. The mobile branch returns earlier (`SessionCard.tsx:1189`) and never mounts the menu.
- **Selected-ring trap.** `index.css:819` (`.card-selected-ring > * { position: relative; z-index: 2 }`) forces every direct child of a selected card into normal flow. The drag bead escapes it with `.card-drag-bead { position:absolute; z-index:20 }` (`index.css:949-952`), declared later in the file. The edge trigger's wrapper is a direct child, so it falls into the same trap.
- **Left-edge precedent.** `card-drag-bead` (`SessionCard.tsx:~1377`): 15×26, `-left-[19px] top-1/2 -translate-y-1/2`, `--bg-primary` + `--border-subtle`, `--grip-dot` glyph.
- **Measured clearance** on the live layout: card border-box right edge at 460, folder enclosure border at 467 (7 px gap), first `overflow-x:hidden` ancestor at 474. That leaves the ≥14 px glow clearance `session-card-selection` requires.
- **Hover intent.** `session-hover-intent.ts`: the strip arms only for `rect.right - 32 <= x <= rect.right`. It never arms while the target is inside `button, a, [role='button']` (around lines 160-184).
- **Programmatic refocus** finds the trigger by `[data-testid^='session-actions-trigger-']` (`SessionCard.tsx:1054,1095`), independent of its DOM position.
- **Palettes.** Base dark/light live in `index.css` (`:root` at :87, `[data-theme="light"]` at :263). Eight more palettes in `lib/theme/themes.ts` (`CSS_VAR_KEYS`) override `--bg-primary` and the text ramp, but not `--grip-dot`.
  - `--grip-dot` therefore drops below 3:1 on some palettes: nord dark 2.91, tokyo-day light 2.67, nord light 3.00.
  - `--text-tertiary` stays at 5.79:1 or above on all 18 palette/mode pairs, and `--text-secondary` at 6.66:1 or above. Ratios were computed from `themes.ts` and `index.css`.
- **Borders.** The declared border tokens are `--border-primary` and `--border-subtle`. There is no bare `--border`.
- **Prefetch.** `prefetchSessionActionsPanel` (`lazy-session-menu.ts:23`) calls a dynamic `import()`. The module system caches that promise after the first call.

## Goals / Non-Goals

**Goals:**
- One visible, clickable, keyboard-focusable trigger centred on the card's right edge, mirroring the drag bead.
- Keep the trigger's ARIA, test id, toggle, Escape handling and focus return exactly as they are.
- A hit area of at least 24×24 that never overlaps another control, on every card shape.

**Non-Goals:**
- No change to the menu panel, groups, placement (still beside the card, top aligned), hover-dwell constants, right-click, or keyboard entry.
- No change to the folder actions menu or the mobile card.
- No dwell-progress animation on the pill. It would need a channel from hover-intent into the card; deferred.

## Decisions

### D1: Same `<button>`, new mount point (last child of the card root)
`SessionActionsMenu` keeps owning both the trigger and the portal. `SessionCard` moves `<SessionActionsMenu>` out of the header row and mounts it as a direct child of the card `<li>`, immediately after the card's content flex row (`</div>{/* end flex row */}`, `SessionCard.tsx:~1719`). Conditional dialog hosts that follow it (`LazySessionCardDialogs`, archive `Confirm`) are modal and unaffected.

- **After the content row** puts the trigger after every other card control in Tab order (spec "Tab order") and in reading order. Header Archive and ✕ stay first.
- **Wrapper** `<span>` becomes the absolutely positioned edge anchor. `relative inline-flex` is removed, and `absolute card-edge-trigger` is added. As with the bead, both the `absolute` utility and the CSS rule are present, so a CSS-order regression cannot drop the wrapper into normal flow.
- **Button:** the old `min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px]` sizing is removed, because those classes would force a 32×32 box. `focus-ring`, `inline-flex items-center justify-center` and `flex-shrink-0` are kept. The button itself is the 13×26 pill and is `position: relative`, so its `::before` hit box positions against it.
- **Alternatives considered:**
  - A second "edge" button proxying to the header trigger. Rejected: it creates two `aria-expanded` sources and two focus-return targets.
  - Rendering the pill in `SessionList`. Rejected: the hover group, selected-ring stacking and `cardRef` all live in `SessionCard`.

### D2: Geometry, in border-box coordinates (R = the card's border-box right edge)
- **Card right padding** goes from `pr-2` (8 px) to `pr-[18px]`. Inward room becomes 18 px padding + 1 px border = 19 px. This is the reserved gutter (spec "Reserved gutter"). Header controls, rows and subcards end at or left of R−19, which leaves 1 px of slack against the hit box at R−18, absorbing sub-pixel rounding at fractional zoom. Cost: 10 px less content width on every desktop card.
- **Pill:** 13×26, `right:-7px` against the padding box. The padding box's right edge is at R−1, so the pill spans [R−7, R+6], leaving 1 px clear of the folder border at R+7 (spec "Bounds"). Vertical placement is `top:50%; translateY(-50%)` against the card root, so the pill is centred on the whole card (top border to bottom border) on every card height. The reserved gutter makes this safe even on short cards where mid-height falls beside ✕ / Archive.
- **Hit box:** a transparent `::before` on the button: `before:content-[''] before:absolute before:top-0 before:bottom-0 before:right-0 before:w-[24px]`. Without `content` the pseudo-element does not exist, and the target shrinks back to 13 px. It spans [R−18, R+6] × 26 px. That is entirely padding, border and gap, so it overlaps no control, whatever the card's height (spec "Hit area"). This is what fixes the overlap with ✕ and Archive that the review found on cards about 87 px tall.
- **Stacking:** a new `.card-edge-trigger { position:absolute; z-index:20 }` in `index.css`, declared next to `.card-drag-bead`, after the `.card-selected-ring > *` rule (`session-card-selection` delta).
- **Glyph:** an inline 3×13 SVG of three vertical dots, `fill="currentColor"`, `aria-hidden="true"`, `focusable="false"`. The button's `color` carries the token. The button keeps its `aria-label`/`title`. It is a single column of three dots, against the bead's two columns (7×13): left means move, right means act.
  - It is not `mdiDotsVertical`.
  - It differs from the folder trigger (`mdiFolderCogOutline`, `FolderActionsMenu.tsx:24`).
  - No other menu trigger remains on the card since `add-session-actions-flyout`.
- **Alternatives considered:**
  - Rely on the WCAG 2.5.8 spacing exception with a 13 px target. Rejected: on an 87 px card the 24 px circle still reaches ✕.
  - Centre on the body below the title row. Rejected: the inward reach still touches right-side subcard controls.

### D3: Rest and emphasis states use colour tokens only, no opacity cut
- **At rest:** dots `--text-tertiary` (at least 5.79:1 on every palette/mode), pill border `--border-subtle`, background `--bg-primary`. "Faint" comes from the mid-grey dots and an almost invisible pill outline, never from opacity. `--grip-dot` was rejected because it fails 3:1 on nord dark and tokyo-day light.
- **Full emphasis:**
  - Triggers: `group-hover/card:`, `focus-visible:`, and `aria-expanded="true"` (Tailwind `aria-expanded:` variant).
  - Rendering: dots `--text-secondary`, border `--border-primary`.
  - Hovering the pill itself adds `--bg-hover`.
  - The open state may use the `--tint-blue-*` triple, as in the mockup.
  - `aria-expanded:` is a Tailwind v4 core variant (`packages/client/package.json`: `tailwindcss ^4.1.0`). The repo has no prior usage, so a unit test pins the generated class (task 1.2).
- No JavaScript media query is needed. "Visible on touch" is simply the rest state.

### D4: Hover dwell unchanged; the strip's dead band is accepted
The trigger and its `::before` share one event target, the button, so `session-hover-intent.ts` refuses to arm over [R−18, R] in the 26 px band at mid-height. The strip still arms everywhere else in its 32 px width and along the rest of the card height. The pill's outer half is beyond `rect.right`, where the strip never arms. No constant or module change. This dead band is intended: a pointer resting there is resting on the trigger, and the user clicks it.

### D4b: A trigger click pins a hover-opened menu (user decision)
The pill sits inside the 32 px dwell strip. Users slow down as they aim at it, so the dwell often opens the menu just before the click lands. Today's plain toggle (`SessionActionsMenu.tsx:104`, `if (open) onOpenChange(false)`) would close the menu the user meant to open.
- **New rule:** when `open && source === "hover"`, a click calls `onOpenChange(true, { source: "trigger", opener })` instead of closing. The menu becomes click-opened: `SessionList`'s menu state source changes from `"hover"` to `"trigger"`, so the hover close-grace and hover `close()` no longer apply (`SessionList.tsx:980-987`). A further click closes the menu.
- **Wiring:** `SessionActionsMenu` needs the current open source. `SessionCard` passes it down from the menu state it already receives.
- **Alternatives:** a plain toggle (rejected: it closes what the user aimed to open); ignoring the click (rejected: the menu would still close on pointer leave even though the user committed with a click).

### D5: Panel prefetch, focus ring, stacking
- **Prefetch:** `onPointerEnter` / `onFocus` stay on the button. The larger hit box fires prefetch slightly more often. This is harmless because `import()` (`lazy-session-menu.ts:15,23`) resolves the same cached module promise after the first call.
- **Focus ring:** `.focus-ring:focus-visible` (`index.css:344`: 2 px outline, 2 px offset) reaches R+10. While focused, that is over the folder border (R+7) but inside the R+14 clip edge. The spec exempts this transient indicator from the 1 px clearance, but it must not be clipped (task 3.2). Ungrouped lists have no folder border; their scroller keeps a 16 px right clearance (`SessionList.tsx:~3031`, `pr-4`), which contains both the pill and the ring.
- **Stacking:** `z-index:20` is local to the card root's stacking context (`isolate`, `SessionCard.tsx:1342`). Dialogs, toasts and menus portal through `LayerPortal` to body-level layers, so the trigger cannot paint above them.

## Risks / Trade-offs

- **[Trade-off] Every desktop card loses 10 px of content width** to the reserved gutter. → Accepted (user decision). Truncation already handles the name, branch and model.
- **[Risk] Some right-aligned element ignores card padding** and reaches into the gutter: a negative margin, an absolutely positioned child, plugin-injected content, or non-shrinking title-row items overflowing at the 180 px minimum sidebar (`ResizableSidebar.tsx:27`). → Task 3.3: a DOM-geometry overlap check across card shapes, including plugin slots, inline rename and a 180 px sidebar.
- **[Risk] Sub-pixel rounding at fractional zoom** paints the pill onto the folder border, or a control into the hit box. → 1 px designed clearance on both sides (D2). The bounds and overlap checks run at 100% and 125% zoom, in the grouped-folder and ungrouped containers.
- **[Trade-off] Dimmed cards** (`opacity-40` hidden, `opacity-50` closing, `SessionCard.tsx:1348`) dim the trigger with all other content, below 3:1. → Accepted. The spec's contrast floor applies to undimmed cards, consistent with the rest of the card's dimmed content.
- **[Note] Halo clearance** (≥14 px, `session-card-selection`) is unaffected. The change alters neither the card's outer width nor any clipping ancestor.
- **[Risk] `hover:-translate-y-0.5` lift** moves the pill 2 px under a resting pointer. → The hit box is 26 px tall, so this is harmless. It matches the bead.
- **[Trade-off] On tall cards the trigger is far from the header**, where users used to look. → It is always visible and mirrors the left bead. Right-click and Shift+F10 remain.
- **[Risk] Tests asserting header containment, or relying on header Tab order.** → The test id is kept. Containment and Tab-order assertions are rewritten in tasks 1.x.

## Migration Plan

Client-only. Ship with `npm run build` and `POST /api/restart`. Rollback is a revert of the client commit. No persisted state, protocol, or plugin API changes.
