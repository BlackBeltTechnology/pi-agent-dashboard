## Why

Change 4 of the four-way directory-card split established in
`openspec/changes/archive/2026-08-09-add-folder-actions-menu/design.md`
(decisions **D9, D10**). D9 is recorded there as a **correction**: change 1's premise
"tier 3 is state-only" was asserted without checking and is false.

1. **Ten action buttons live in the slot pills.** `directory-card-layout` mandates them:
   *"each slot section SHALL keep its own data hook and secondary actions (refresh,
   create)"*. So invariant 1 (*pills read a number; the menu changes something*) was enforced
   against the `Workspace` pill alone while nine violations sat two rows below it — and that
   false premise was the stated reason `Workspace` could not be a pill.

   | Pill | Buttons | Glyph | Resolution |
   |---|---|---|---|
   | AUTOMATIONS | `folder-automation-new-btn` | `mdiPlus` | ⋯ → CREATE |
   | | `folder-automation-refresh` | `mdiRefresh` | folded |
   | GOALS | `folder-goal-new-btn` | `mdiPlus` | ⋯ → CREATE |
   | | `folder-goals-refresh` | `mdiRefresh` | folded |
   | KB | `folder-kb-reindex` / `-index-now` / `-retry` | `mdiRefresh` (one branch at a time) | ⋯ → MAINTENANCE, keeps its stale badge |
   | OPENSPEC | `folder-openspec-refresh` | `mdiRefresh` | folded |
   | | `folder-archive-btn` | `mdiArchiveOutline` | ⋯ → OPEN |
   | | `folder-specs-btn` | `mdiFileDocumentOutline` | ⋯ → OPEN |

   The KB pill's `folder-kb-stale` badge also mirrors onto the menu's reindex item, so its
   consumers move with the ten controls.

2. **The glyph audit is worse than tier 1's.** On a rendered card `mdiRefresh` appears up to
   **four** times with four different scopes — automations, goals, OpenSpec, and KB (whose
   trailing control renders one mutually-exclusive branch, not several, and shows no icon at
   all in the `not-indexed` state, where the affordance is the text "Index now"). `mdiPlus`
   appears twice. Invariant 4 is violated either way — invisible precisely because each pill is
   locally reasonable, and visible only when counting across the rendered card. An earlier
   draft claimed six `mdiRefresh` with four from KB; that was a repo-shaped count of KB's
   state branches, i.e. the exact method D8 warns against, applied by this proposal to itself.

3. **`SlotPill.actions?: ReactNode` lets plugins inject arbitrary markup** into the directory
   card (`packages/dashboard-plugin-runtime/src/SlotPill.tsx:69`). `kb-plugin`, `goal-plugin`,
   `automation-plugin` and the host's own OpenSpec section all use it. Once those actions move
   into the menu the prop becomes untenable: the host cannot group, order, keyboard-navigate
   or mobile-adapt opaque nodes. It also nests real `<button>`s inside a `role="button"`
   pill — an ARIA anti-pattern that removal incidentally fixes.

## What Changes

- **Ten slot-pill buttons → zero.** Tier 3 becomes genuinely state-only, and invariant 1
  holds across the whole card for the first time.
- **The three plain refreshes collapse to one.** Nobody wants to refresh *only* goals;
  per-slot refetch is data plumbing leaking into the UI.
- **KB's three controls fold into one reindex item** that stays distinct — rebuilding an index
  is not refetching a view — and keeps its stale badge.
- **`Archive` / `Specs` move rather than die.** Deleting them (the board they duplicate is one
  pill-click away, as with `mdiOpenInNew` in change 1) was **rejected**: they are used often
  enough to keep a shortcut, just not a permanent button. They land in `⋯ → OPEN`.
- **`SlotPill.actions?: ReactNode` is removed.** Plugins instead contribute declarative items
  `{ id, group, label, icon, onSelect, badge?, disabled? }` to a folder-scoped contribution
  registry. Because three of the four sections' actions close over section-local state
  (Automations' refresh is a `useState` setter), contributions are **live registrations**, not
  static config — with defined unmount, remount and cross-plugin-collision semantics.
- **The host keeps its `node` / `pressed` escape hatch; plugins do not get one.** The existing
  `FolderMenuItem` carries `node?` specifically so add-to-workspace's popover and
  `add-to-workspace-btn-<cwd>` contract survive verbatim, and `pressed?` for urgency sort's
  `aria-pressed`. The plugin-facing type is a strict declarative subset.
- **OpenSpec does not use the registry.** Its `onRefresh` / `onOpenSpecs` / `onOpenArchive` are
  already props owned by `SessionList`, the component that renders the menu; it contributes
  host-side alongside the existing items.
- **Groups are a fixed host-owned verb taxonomy** — `WORKSPACE · DIRECTORY · CREATE · OPEN ·
  MAINTENANCE` — **not** one group per plugin. Per-plugin grouping would produce single-item
  groups (`KB` → one item) and leak the extension architecture into the user's mental model.
  Groups render only when non-empty; order is stable regardless of plugin registration order.
- **Ambiguous labels are slot-qualified** ("OpenSpec archive", not "Archive"), because a verb
  group no longer says which slot an item came from.
- **`Pi Resources` must not be lost — nor duplicated.** It is the same control as "Directory
  Settings" after the `directory-settings-page` re-label, and is already a `DIRECTORY`-group
  item. Nothing is rehomed; the two stale `pi-resources-view` requirements describing the old
  header button are removed so they stop mandating a control nothing renders. `OPEN` therefore
  holds the two OpenSpec navigations only.
- Net: the menu holds roughly a dozen items across 5 groups. The exact count depends on what
  change 2 contributes and is illustrative, not normative.

### Out of scope

- The status capsule (D2) → `unify-folder-status-capsule`.
- The tier-0 banner and idempotent project setup (D4–D7) → `add-folder-action-banner`.
- Any new plugin capability beyond menu contribution.

## Capabilities

### Modified Capabilities

- `directory-card-layout`: the *"each slot section SHALL keep its own … secondary actions
  (refresh, create)"* requirement is **retired** — it is the mandate that produced the ten
  buttons. Tier 3 becomes state-only.
- `folder-actions-menu`: gains the CREATE, OPEN and MAINTENANCE groups, the fixed host-owned
  taxonomy, the stable-order rule and the slot-qualified-label rule.
- `directory-card-layout`: `SlotPill.actions?: ReactNode` is removed — this is the spec that
  governs the pill's surface, so the prop's removal is specified there rather than in
  `dashboard-shell-slots`, which never mentions `SlotPill`.
- `kb-folder-slot`: its "reindex affordance" in the KB row is removed — the row shows count and
  state only, and reindexing is the menu item.
- `kb-plugin-folder-section`: the three state-variant controls collapse to one menu item whose
  disabled window covers the whole `pending` + `indexing` span, preserving the existing
  double-submit guard.
- `goals-folder-page`: the nav slot's `+ Goal` affordance is removed; goal creation is a
  `CREATE`-group item opening the same shared dialog.
- `openspec-folder-section`: the section becomes state-only — both the section requirement and
  the single-line-entry requirement drop their Refresh control, and the dedicated Refresh /
  Specs / Archive requirements are removed.
- `pi-resources-view`: its two stale requirements describing the superseded header button and
  its "right-aligned position in the action bar" are **removed**; the entry point is the menu's
  `OPEN` group. Resolved here rather than carried further — after this change they would
  mandate a button nothing renders.

## Discipline Skills

`scenario-design` (group-ordering, empty-group and plugin-registration-order matrix),
`doubt-driven-review` (removing a public plugin prop is irreversible for third-party authors),
`review-code` (cross-package client + plugin-runtime change before commit).

## Impact

- **Code**: `packages/dashboard-plugin-runtime/src/SlotPill.tsx` (drop `actions`, lines
  69/82/116-120), the four consumers — `packages/goal-plugin/src/client/FolderGoalsSection.tsx`,
  `packages/automation-plugin/src/client/FolderAutomationSection.tsx`,
  `packages/kb-plugin/src/client/FolderKbSection.tsx`,
  `packages/client/src/components/openspec/FolderOpenSpecSection.tsx` — plus
  `FolderActionsMenu.tsx` (`FolderMenuItem` gains `badge?` / `disabled?`) and `SessionList.tsx`
  (host contributions).
- **Test ids**: `folder-automation-new-btn`, `folder-automation-refresh`,
  `folder-goal-new-btn`, `folder-goals-refresh`, `folder-kb-reindex` / `-index-now` /
  `-retry`, `folder-openspec-refresh`, `folder-archive-btn`, `folder-specs-btn` all move
  behind `folder-actions-menu-<cwd>`; consumers need a menu-open step.
- **Tests**: `packages/dashboard-plugin-runtime/src/__tests__/SlotPill.test.tsx` gains a red
  test for the removed prop (it asserts nothing about `actions` today), plus the per-slot
  client tests that anchor on the ten moved ids. The blast radius is **unit tests, not E2E** —
  a grep of `tests/e2e/` for the ten ids returns nothing, so no Playwright spec anchors on
  them.
- **Breaking for plugin authors, deliberately.** The trade: plugins lose the ability to render
  markup into the directory card; the host gains one place to enforce grouping, a11y and the
  mobile sheet. Needs a migration note in the plugin docs and a CHANGELOG entry.
- **A11y**: items carry `role="menuitem"`; group headers are non-focusable labels; the mobile
  sheet returns focus to the trigger on dismissal.
- **Risk**: high — cross-package, removes a published plugin prop, and moves ten previously
  one-click actions one level deeper.
