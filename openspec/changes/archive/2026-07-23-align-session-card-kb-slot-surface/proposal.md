## Why

On a worktree session card the **KNOWLEDGE BASE** row reads as a bright, raised, opaque
white card, while its neighbours (OPENSPEC / GIT / PROCESS) are flat, translucent, tinted
subcard panels. The KB row is the lone visual outlier in the card.

Root cause is two different rendering primitives sitting side-by-side, each with its own
background contract:

- **Native subcards** (OPENSPEC / GIT / STATUS / PROCESS / FLOWS / MEMORY) render through
  `SessionSubcard` (`packages/client/src/components/session/SessionSubcard.tsx`), whose panel
  is `bg-[color-mix(in_srgb,var(--bg-surface)_50%,transparent)]` — **50% translucent**, tinted,
  **no shadow**.
- **The KB row** renders through `WorktreeCardSectionSlot` → kb-plugin `FolderKbSection` →
  `SlotPill` (`packages/dashboard-plugin-runtime/src/SlotPill.tsx`), whose body is
  `bg-[var(--bg-secondary)]` **opaque** plus `shadow-[0_1px_2px_var(--shadow-card)]` — a raised
  chip. That opaque body + shadow is exactly the bright card in the screenshot.

The two **capsule legend titles already match** (both use the fieldset-legend overhanging pill),
so the break is purely the KB body's opacity + shadow. `SlotPill` was tuned for the **sidebar**
folder cards (Automations / Goals / KB / OpenSpec) where a raised opaque pill on the sidebar
background is correct. When `kb-row-on-worktree-session-card` reused the same `FolderKbSection`
inside the session card, it dropped that sidebar-tuned pill into the subcard context — inheriting
the raised surface unintentionally.

## What Changes

Give `SlotPill` a **surface variant** so the same component can present either as the existing
raised sidebar chip OR as a flat translucent subcard-matching panel, and select the flat variant
only when a folder section is rendered inside a session card (the `worktree-card-section` slot).
The sidebar keeps its raised pill unchanged; the KB row in the session card stops looking raised
and matches OPENSPEC / GIT / PROCESS.

- **`SlotPill` gains `surface?: "raised" | "flat"` (default `"raised"`).**
  - `"raised"` (unchanged): `bg-[var(--bg-secondary)]` + `shadow-[0_1px_2px_var(--shadow-card)]`.
  - `"flat"`: `bg-[color-mix(in_srgb,var(--bg-surface)_50%,transparent)]` + **no** shadow —
    matching `SessionSubcard`'s panel surface. Border, radius, hover-border, glyph chip, and the
    capsule legend title are unchanged in both variants.
- **`FolderKbSection` forwards a placement into `SlotPill`.** It reads a `placement?: "sidebar" |
  "card"` from its slot props (default `"sidebar"`) and passes `surface="flat"` when
  `placement === "card"`, else `surface="raised"`.
- **`WorktreeCardSectionSlot` passes `placement: "card"` to the claims it renders.** Every folder
  section rendered in a session card therefore reads flat; the `sidebar-folder-section` consumer
  passes nothing (defaults to `"sidebar"`) and stays raised.

Only the KB body surface changes. No layout, no copy, no behavior, no data-flow change. The KB
row keeps its own `KNOWLEDGE BASE` capsule title (already matching the subcards) — it is NOT
additionally wrapped in a `SessionSubcard`, so there is no double title.

## Impact

- **Shared types:** `packages/shared/src/dashboard-plugin/slot-props.ts` — the folder-section slot
  props gain an optional `placement?: "sidebar" | "card"`.
- **Plugin runtime:** `packages/dashboard-plugin-runtime/src/SlotPill.tsx` — new `surface` prop +
  the flat class strings (kept in this `@source`-scanned package so Tailwind compiles both
  variants); `slot-consumers.tsx` `WorktreeCardSectionSlot` passes `placement: "card"`.
- **KB plugin:** `packages/kb-plugin/src/client/FolderKbSection.tsx` — reads `placement`, forwards
  `surface`.
- **Client:** no session-card structural change; the KB row already sits where it belongs.
- **Sidebar:** unchanged (default `raised`).
- **Tests:** `SlotPill` renders raised surface by default and flat surface tokens under
  `surface="flat"` (asserts translucent `color-mix` bg + absence of the shadow token);
  `FolderKbSection` forwards `surface="flat"` when `placement="card"` and `"raised"` otherwise;
  `WorktreeCardSectionSlot` supplies `placement: "card"` to rendered claims.
- **Behavior:** none — purely presentational alignment of one slot's body surface.

## Discipline Skills

`review-code` (small but shared-component change touching a package consumed by multiple plugins);
`frontend-mockup-loop-dashboard` optional for a before/after visual check across the 4 themes.
