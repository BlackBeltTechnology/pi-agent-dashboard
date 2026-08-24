# overlay-layering Specification

## Purpose
TBD - created by archiving change add-overlay-layering-system. Update Purpose after archive.
## Requirements
### Requirement: A single named z-index layer scale is the only source of stacking order

The dashboard client SHALL define exactly one named z-index layer scale, exposed as CSS custom
properties and matching Tailwind utilities, and every portaled overlay SHALL choose its stacking order
by referencing a layer token — never a raw numeric z-index.

The canonical layers, in ascending paint order, are:

| Token | For |
|---|---|
| `base` | normal document flow |
| `raised` | sticky headers and other in-flow affordances that lift over adjacent flow |
| `sidebar` | the resizable sidebar and folder chrome |
| `overlay` | scrims / mobile backdrops behind a surface |
| `popover` | menus, dropdowns, comboboxes, folder-action flyouts |
| `dialog` | modals and full-pane preview surfaces |
| `toast` | transient notifications |
| `lightbox` | full-screen media |

Raw `z-[NNNN]` and ad-hoc numeric utilities (`z-50`, `z-[9999]`, …) on a portaled overlay are
PROHIBITED, because a bare number carries no ordering intent and cannot be reasoned about against the
other 27 overlays. In-flow, non-portaled decorations that order only *within their own parent* (a sticky
header, a scrollbar shim) MAY keep a small local `z-*`; they are not portaled overlays and are out of
scope of the token requirement.

Because a text scan cannot tell a portaled overlay from an in-flow decoration, the prohibition is
enforced as a **frozen baseline ratchet** (like the repo's `knip-ratchet`): the current set of raw-z
occurrences is captured as a baseline the guard permits, and the guard FAILS when a NEW raw-z occurrence
appears that is not a token utility. The baseline may only shrink. This needs no per-node AST analysis —
it gates additions, and the enumerated baseline doubles as the inline-popover migration backlog.

This requirement exists so that `kb_search` for **z-index**, **layering**, **stacking context**,
**underlap**, **overlay**, **popover**, **dropdown**, or **portal** returns this spec, and an author
adding a new overlay is instructed here rather than re-deriving (or re-breaking) the order.

#### Scenario: New overlay adopts a layer token
- **GIVEN** an author adds a new menu or popover to the client
- **WHEN** they set its stacking order
- **THEN** they reference a layer token (e.g. the `popover` layer) rather than a raw number
- **AND** a raw `z-[NNNN]` or ad-hoc `z-50` on that portaled overlay is rejected by lint

#### Scenario: Layer order is total and unambiguous
- **GIVEN** any two portaled overlays on the same screen
- **WHEN** both are open
- **THEN** their relative paint order across DISTINCT layers is fully determined by their layer tokens
- **AND** no two distinct layer roles resolve to the same numeric value
- **AND** two overlays SHARING one layer token break the tie by portal-mount order (later mount on top) — the token fixes the cross-layer order; within a single layer, mount/DOM order decides

### Requirement: Box-escaping overlays SHALL portal to a top-level layer root

Any overlay that can extend past its parent element's box — a menu, popover, dropdown, combobox, folder
flyout, dialog, toast, or lightbox — SHALL render through a portal to a top-level layer root attached at
or near `<body>`, and SHALL NOT be positioned inline as `position:absolute` inside the content tree.

A numeric z-index only orders siblings *within the nearest ancestor stacking context*. An inline
absolutely-positioned overlay is trapped inside whatever stacking context an ancestor establishes
(`transform`, `will-change`, `opacity < 1`, `filter`, or an ancestor's own `z-*`), so a neighbouring
card that establishes its own context paints over the overlay regardless of how large the overlay's
z-index is. Portaling to the layer root removes the overlay from those ancestor contexts, which is what
actually prevents underlap; the layer token then orders it against the other portaled layers.

Where a component renders differently by form factor, ALL forms SHALL portal — a component MUST NOT
portal on one breakpoint and render inline on another, because the inline form is the defect class.

An ANCHORED portaled overlay (menu, popover, dropdown, folder flyout) is positioned `position: fixed`
from its trigger's viewport rect, and SHALL re-measure that rect while open on scroll (including scroll of
an ANCESTOR scroll container, e.g. the sidebar list) and on resize, so the panel tracks its trigger and
never detaches (a capture-phase window `scroll` listener observes inner-scroller events, which do not
bubble). A NON-ANCHORED overlay (dialog, toast, lightbox) has no trigger — it positions by its own layout
(viewport-centered or corner-fixed); the trigger-rect rule does not apply to it.

**Migration boundary (bounded, tracked exception).** This rule is normative for every overlay this
capability introduces or modifies, and for every NEW overlay authored after it lands. A finite,
enumerated set of PRE-EXISTING inline-`absolute` popovers MAY remain inline until migrated — that set is
the frozen lint allowlist (see the layer-scale requirement's ratchet) and SHALL only shrink, never grow.
A new or modified box-escaping overlay gets NO exemption. The allowlist is the migration backlog, not a
permanent carve-out; the rule above is the end state it converges to.

#### Scenario: Folder-actions menu no longer underlaps session cards
- **GIVEN** a folder-actions menu (or folder flyout) opened over a list of session cards
- **WHEN** the menu is open
- **THEN** the menu renders through the portal layer root on every breakpoint
- **AND** it paints fully above every session card, none of which shows through it

#### Scenario: A portaled menu tracks its trigger when the sidebar scrolls
- **GIVEN** an open folder-actions menu whose trigger sits inside the scrollable sidebar list
- **WHEN** the sidebar list scrolls
- **THEN** the portaled `fixed` panel re-measures the trigger rect and repositions to stay anchored
- **AND** the panel does not detach from or drift away from its trigger

#### Scenario: A new or modified inline-absolute overlay is rejected
- **GIVEN** a box-escaping overlay that is newly authored, or an existing one being modified, as inline
  `position:absolute` in the content tree
- **WHEN** the change is reviewed or linted
- **THEN** it is flagged as non-conforming and converted to a portaled layer-root surface

#### Scenario: The pre-existing inline-popover allowlist is finite and only shrinks
- **GIVEN** the frozen allowlist of pre-existing inline-`absolute` popovers awaiting migration
- **WHEN** the lint ratchet runs
- **THEN** removing an entry (by portaling that popover) is allowed
- **AND** adding a new entry is rejected — the backlog may only shrink

### Requirement: An open overlay SHALL paint above sibling content regardless of stacking context

An open portaled overlay SHALL paint above all sibling content on the screen — session cards, folder
rows, list items — irrespective of any stacking context those siblings establish. Underlap (an overlay
painting behind, or a sibling showing through, an open overlay) is a defect.

#### Scenario: Sibling with its own stacking context does not cover the overlay
- **GIVEN** an open overlay and a sibling card that establishes its own stacking context
  (via `transform`, `will-change`, `opacity < 1`, or its own `z-*`)
- **WHEN** the two regions overlap on screen
- **THEN** the overlay paints entirely above the sibling
- **AND** the sibling's content does not bleed through the overlay's surface

#### Scenario: Overlapping overlays stack by layer, not by DOM order
- **GIVEN** a `popover`-layer menu open beneath a `dialog`-layer modal
- **WHEN** both occupy the same region
- **THEN** the modal paints above the menu because `dialog` outranks `popover`
- **AND** the outcome does not depend on which mounted first or their DOM order

