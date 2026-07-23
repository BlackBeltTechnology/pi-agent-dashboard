## Context

`SlotPill` is the shared single-concern chip for all four folder-card sections (Automations /
Goals / Knowledge base / OpenSpec). It lives in `dashboard-plugin-runtime` precisely so those
sections — each in its own plugin package — share one presentational source without a new
cross-package dependency, and so Tailwind (which `@source`-scans that package) compiles every
class variant regardless of caller.

The same `FolderKbSection` component is claimed for **two** slots (`packages/kb-plugin/package.json`):

- `sidebar-folder-section` — rendered in the sidebar folder card.
- `worktree-card-section` — rendered inside a worktree **session card** (only worktree sessions;
  a worktree never gets its own sidebar folder card, so this is the only surface reaching its KB).

Both currently render the identical raised `SlotPill`. The raised treatment is correct on the
sidebar background but wrong inside a session card, whose established language is the translucent
flat `SessionSubcard` panel.

```
SESSION CARD (worktree)                         SIDEBAR FOLDER CARD
├── OPENSPEC ┐                                  ├── Automations  ┐
├── GIT      ┤ SessionSubcard  (flat,           ├── Goals        ┤ SlotPill (raised, opaque
├── PROCESS  ┘  translucent, no shadow)         ├── Knowledge b. ┤  bg-secondary + shadow) ✔ correct
└── KNOWLEDGE BASE  SlotPill (raised) ✗ outlier └── OpenSpec      ┘
```

## Goals / Non-Goals

- **Goal:** the KB row inside a session card visually matches the sibling subcards (flat,
  translucent, no shadow) while the sidebar folder cards keep their raised pill.
- **Goal:** one shared component, no duplicated markup, sidebar untouched.
- **Non-Goal:** converting the native subcards to `SlotPill`, or restyling the sidebar.
- **Non-Goal:** any change to KB data, state derivation, reindex affordance, copy, or layout.

## Decisions

### D1 — Surface variant on `SlotPill`, selected by placement (chosen)

Add `surface?: "raised" | "flat"` to `SlotPill` (default `"raised"`). `"flat"` swaps only the body
background + shadow for the `SessionSubcard` surface tokens; border, radius, hover-border, glyph
chip, and the capsule legend are identical across variants. Placement is threaded from the slot
consumer:

```
worktree-card-section consumer  ──placement:"card"──▶  FolderKbSection  ──surface:"flat"──▶  SlotPill
sidebar-folder-section consumer ──(default sidebar)─▶  FolderKbSection  ──surface:"raised"─▶  SlotPill
```

`FolderKbSection` reads `placement?: "sidebar" | "card"` (default `"sidebar"`) from its slot props
and maps `card → flat`. `WorktreeCardSectionSlot` supplies `placement: "card"` to every claim it
renders, so if another folder section is ever claimed for `worktree-card-section` it inherits the
flat surface for free.

Why not alternatives:

| Approach | Verdict |
|---|---|
| **A. Flip `SlotPill`'s bg globally to flat** | ✗ Breaks the sidebar folder cards, which are correctly raised. `SlotPill` is shared across sidebar + card. |
| **B. Wrap the card KB row in `SessionSubcard`** | ✗ `SlotPill` already renders its own capsule legend → double title; and the raised body would still show through. |
| **C. Fork a second card-specific component** | ✗ Duplicates markup + accent map; drifts from the shared `SlotPill` the section is designed around. |
| **D1. `surface` variant + placement (chosen)** | ✓ One component, sidebar unchanged, minimal blast radius, extensible to other card folder slots. |

### D2 — Flat surface tokens exactly mirror `SessionSubcard`

`"flat"` uses `bg-[color-mix(in_srgb,var(--bg-surface)_50%,transparent)]` and omits the shadow —
the literal tokens from `SessionSubcard`'s panel contract — so the KB body is
pixel-consistent with OPENSPEC / GIT / PROCESS across all four themes (studio / earth / athlete /
gradient), since both resolve the same CSS variables. Both class strings are literals in
`SlotPill.tsx` so Tailwind JIT-compiles them.

### D3 — Keep the SlotPill capsule legend; do not add a SessionSubcard wrapper

The KB row's own `KNOWLEDGE BASE` capsule already matches the subcard legends (same fieldset-legend
tokens). Wrapping it in a `SessionSubcard` would duplicate the title. So the change is body-surface
only; the title path is untouched.

## Risks / Tradeoffs

- **Shared component, two consumers:** the default (`raised`) preserves current sidebar behavior;
  the flat path is opt-in via placement, so a regression can only reach the card, not the sidebar.
  Covered by the raised-default + flat-variant tests.
- **Future folder slots in the card:** any new `worktree-card-section` claim inherits `flat`
  automatically (placement is set at the consumer, not per-plugin) — intended.

## Migration

None. Presentational; no persisted data, no protocol, no config.
