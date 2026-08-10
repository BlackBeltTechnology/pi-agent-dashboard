## Context

Change 4 of the four-way directory-card split (`openspec/changes/archive/2026-08-09-add-folder-actions-menu/design.md`, decisions D9–D10). D9 is recorded there as a **correction**: change 1's premise "tier 3 is state-only" was asserted without checking and is false.

Verified in source:

- **`SlotPill`** (`packages/dashboard-plugin-runtime/src/SlotPill.tsx`) exposes `actions?: ReactNode` (line 69) and renders it in a trailing `<span>` that stops propagation (lines 116-120). The pill root is itself `role="button" tabIndex={0}` (lines 93-95).
- **Four consumers pass it**: `FolderGoalsSection.tsx:42`, `FolderAutomationSection.tsx:69`, `FolderKbSection.tsx:127` (via a `trailing` variable), `FolderOpenSpecSection.tsx:57`.
- **The decisive detail**: three of the four close over **section-local state**. Goals calls `refetch()` from its own data hook; Automations calls `setReloadKey((k) => k + 1)`, a local `useState` setter; KB builds a state-dependent `trailing` control. **OpenSpec is the exception** — its `onRefresh` / `onOpenSpecs` / `onOpenArchive` are *props injected by `SessionList`*, the very component that renders the menu.
- **A menu item type already exists**: `FolderMenuItem` (`FolderActionsMenu.tsx:43-58`) carries `{ id, group, label, icon, onSelect }` **plus `pressed?`** (urgency sort, surfaced as `aria-pressed`) and **`node?`** — documented as an escape hatch for add-to-workspace, "whose `add-to-workspace-btn-<cwd>` contract and `AddToWorkspaceMenu` behaviour must survive the relocation verbatim".
- The existing `slot-registry` is keyed by `SlotId` and removes claims by `pluginId`; it hosts whole components, not ephemeral per-folder items. It provides no item-contribution mechanism to reuse, and its determinism comes from a `priority` + `pluginId.localeCompare` comparator.
- `directory-card-layout`'s pill requirement currently **mandates** the thing this change removes: *"each slot section SHALL keep its own data hook and secondary actions (refresh, create)"*.
- Change 2 (`add-folder-action-banner`) already adds two items to the menu's `DIRECTORY` group and modifies the menu's scoping requirement. This change lands **after** it.

## Goals / Non-Goals

**Goals:**

- Tier 3 becomes genuinely state-only: zero action buttons in the pill grid.
- One host-owned menu taxonomy that plugins contribute *data* to, not markup.
- Collapse six `mdiRefresh` controls and two `mdiPlus` controls into a coherent, non-colliding set.
- Keep `Archive` / `Specs` reachable — moved, not deleted — and keep the Pi Resources surface reachable from the one menu item that already routes to it.

**Non-Goals:**

- Changing what any slot's primary click does.
- Changing how any slot fetches its data.
- Adding a plugin capability beyond menu contribution.
- Re-litigating the banner or the capsule.

## Decisions

### D-A: Contributions are **registrations of live callbacks**, not static config

This is the crux, and the archived D10 understates it. `{ id, group, label, icon, badge, disabled, onSelect }` reads like static config, but `onSelect` must invoke a closure that lives inside a *sibling* component — the slot section — while the menu renders in the *header*. Automations' refresh is a `useState` setter; there is no way to express it as data.

So the contribution point is a **registry keyed by folder scope**, and a slot section registers/updates/unregisters its items as an effect of rendering. The menu reads the registry for its folder and renders whatever is currently registered. Consequences that must be designed for, not discovered:

- **The bridge is an external store, not a prop.** The menu renders in the folder *header*; the sections render in the pill-grid *subtree* mounted by `SidebarFolderSectionSlot`. They are siblings, so the registry is a provider-scoped store consumed via `useSyncExternalStore` (matching React's tearing guarantees), and an already-open menu SHALL re-render when a late-mounting section registers. This bridge is the whole implementation risk; leaving it to the implementer is how it goes wrong.
- **Registration is asynchronous with menu open.** A slot that has not mounted (collapsed folder, lazy plugin) has contributed nothing, so its items are simply absent — the menu renders correctly with a partial set, never a placeholder or a spinner.
- **Unmount must deregister**, or a disabled plugin leaves a dead item invoking a stale closure.
- **Identity is `(folderScope, contributionId)`, and the LATEST registration wins.** An earlier draft said "first registration wins", which is both self-contradictory (it presumes the deterministic order the same decision calls nondeterministic) and wrong under remount: a StrictMode double-mount or any section remount deregisters and re-registers the same id, and first-wins would permanently drop the live one. Collisions **between different plugins** are broken by the existing `pluginId.localeCompare` tiebreak so the outcome does not depend on load order.
- **Only sections in the folder placement register.** `FolderKbSection` is mounted by both `SidebarFolderSectionSlot` (folder cwd) and `WorktreeCardSectionSlot` (`placement: "card"`, worktree cwd). A worktree card has no folder actions menu, so a card-placement section SHALL NOT register — otherwise its items land in a scope with nothing to render them.

*Alternative rejected:* have the host own every callback and pass them down. That works for OpenSpec (whose callbacks are already host props) but inverts the plugin boundary for the other three — the host would need to know each plugin's fetch mechanism. **OpenSpec therefore does not need the registry**: its items are contributed directly by the host alongside the existing urgency-sort and workspace items. Forcing it through plugin registration would be indirection for symmetry's sake.

### D-B: The unified refresh is a **fan-out over registered refreshers**, not a single shared fetch

"The three plain refreshes collapse to one" is a UI statement, not a data statement. Each section keeps its own data hook (that part of the existing requirement survives). The single `MAINTENANCE → Refresh` item invokes **every** registered refresher for the folder.

This means the item's semantics are "refresh this folder's sections", and a section that is not mounted is not refreshed — acceptable, because an unmounted section will fetch on mount anyway.

Because OpenSpec contributes host-side rather than through the registry (D-A), the fan-out is **registered refreshers plus the host's OpenSpec refresher**. Defining it as "every registered refresher" alone would quietly drop OpenSpec from the one item that replaced its refresh button.

*Alternative rejected:* one shared folder-level fetch. It would require unifying four independent data sources with different shapes and cache policies — a far larger change than this one, and not what D9 asked for.

### D-C: KB keeps one item that varies, rather than three items or one static item

KB's control today is state-dependent (`retry` / `index now` / `reindex`, plus a spinner while indexing). Collapsing to one *item* whose label, badge and disabled state derive from KB state preserves the information without spending three menu rows on one slot. Rebuilding an index stays distinct from refetching a view, so it does **not** fold into D-B's refresh.

The `indexing` state renders the item **disabled** rather than hiding it — a vanishing item is worse than a disabled one for muscle memory. The disabled window SHALL span the existing `busy` definition (`pending` OR `stats.indexing`), not just the polled `indexing` state: the optimistic `pending` window is the whole point of the existing double-submit guard, and speccing only `indexing` would silently drop it.

The menu's current item renderer draws an icon and a label only, so `badge` and `disabled` need real rendering support before KB's item can express either — a small but easily-missed prerequisite.

### D-A2: Host items and plugin contributions are the same taxonomy but not the same type

`FolderMenuItem` already carries `pressed?` and `node?`. `node?` is an escape hatch the **host** relies on for add-to-workspace, whose popover and `add-to-workspace-btn-<cwd>` test id must survive verbatim; `pressed?` backs urgency sort's `aria-pressed`.

D10's "remove `ReactNode` from the contract" therefore applies to the **plugin-facing** contribution type only. The host keeps its escape hatch; plugins get a strictly declarative subset. Concretely:

- `FolderMenuItem` (host) = `{ id, group, label, icon, onSelect, pressed?, node?, badge?, disabled? }`
- `FolderMenuContribution` (plugin) = `{ id, group, label, icon, onSelect, badge?, disabled? }` — **no `node`, no `pressed`**

Required fields are `id`, `group`, `label`, `icon`, `onSelect`; a contribution missing any of them is malformed. Without naming that set, "malformed → no-op" is unenforceable.

Collapsing both into one permissive type would re-admit the arbitrary markup this change exists to remove; splitting them keeps the host's one justified exception from becoming a plugin capability.

### D-D: Groups are a fixed host-owned verb taxonomy

`WORKSPACE · DIRECTORY · CREATE · OPEN · MAINTENANCE`. Not one group per plugin: that yields single-item groups (`KB` → one item) and leaks the extension architecture into the user's mental model. Groups render only when non-empty; order is stable regardless of plugin registration order — which matters precisely because D-A makes registration order nondeterministic.

A contribution naming an unknown group is **dropped**, not rendered ungrouped: an unknown group is a version mismatch, and silently inventing a home for it hides the mismatch.

### D-E: Removing `actions` improves the pill's a11y, but does not make it a plain button

The pill root is `role="button" tabIndex={0}`, and `actions` nests real `<button>`s inside it. Nesting interactive controls inside a control is an ARIA-APG anti-pattern that degrades screen-reader and keyboard traversal — it is *not*, strictly, invalid HTML, because the root is a `<div>` rather than a `<button>`. Removing `actions` removes the nesting and the trailing cluster's own propagation-stopping wrapper.

It does **not** make the pill "a single, honest button": the root keeps its own `stopPropagation` because the pill sits inside a navigating header row. Stating the smaller, true benefit rather than the larger, false one.

### D-F: Labels are slot-qualified where a verb group makes them ambiguous

"OpenSpec archive", not "Archive". Under per-slot grouping the group header disambiguated; under verb grouping nothing does.

### D-G: `Pi Resources` already has a menu home — do not give it a second one

Change 1's first draft deleted its container without rehoming it, which would have silently removed the feature while leaving its spec requirement dangling. The instinct to "rehome it into `OPEN`" repeats the mistake from the other direction: **"Pi Resources" and "Directory Settings" are the same control**, re-labelled by `directory-settings-page`, and it is already a `DIRECTORY`-group item (`SessionList.tsx:1074-1075`, `id: "directory-settings", group: "directory"`).

So nothing is rehomed. The two stale `pi-resources-view` requirements describing the old header button are removed, and the surface stays reachable from the existing item. Adding an `OPEN` entry would mandate the same destination from two groups.

The `OPEN` group therefore contains OpenSpec archive and OpenSpec specs only.

## Risks / Trade-offs

- **[Removing a published plugin prop is breaking for third-party authors]** → Deliberate. The trade: plugins lose arbitrary markup in the card; the host gains one place to enforce grouping, a11y and the mobile sheet. Needs a CHANGELOG entry and a migration note. This is the change's irreversible step and warrants `doubt-driven-review` before it stands.
- **[Registry lifetime bugs are invisible until they bite]** → A stale registration invokes a dead closure; a missing deregistration leaves a ghost item. Both are silent. Mitigated by making unmount-deregistration an explicit requirement with its own scenario, not an implementation detail.
- **[Ten one-click actions become two clicks]** → Accepted, and the point: they were never worth permanent card real estate. The most frequent (refresh) collapses to one item, so the aggregate cost is lower than 10×.
- **[This change depends on change 2 having landed]** → It modifies the same menu spec and assumes the `DIRECTORY` group already carries the setup and cleanup items. Landing out of order produces conflicting deltas on `folder-actions-menu`. Concretely, change 2's added scenario "Slot-pill controls are unaffected" becomes **false** the moment this change lands, so this change must supersede it explicitly rather than leaving two specs disagreeing.
- **[The "13 items across 5 groups" headline is arithmetic on an unlanded change]** → It assumes change 2 contributes exactly the setup and cleanup items. Treated as illustrative, not normative; no requirement asserts a total count.
- **[The KB stale badge could end up rendered twice]** → The pill keeps its inline `⚠ N stale` marker (it is state, and tier 3 is state-only), while the menu item also carries a stale badge (it is the reindex affordance's context). These are deliberately two different surfaces of the same fact, not a duplication bug — stated because the deltas otherwise read as contradictory.
- **[`directory-card-layout`'s pill requirement is partially retired]** → Only the "secondary actions" clause goes; "each slot section SHALL keep its own data hook" survives and is load-bearing for D-B.

## Migration Plan

1. Add the contribution registry + the menu groups, with `SlotPill.actions` still present.
2. Migrate each of the four sections to register contributions instead of passing `actions`.
3. Remove `actions` from `SlotPill` once no consumer passes it.
4. CHANGELOG + plugin migration note.

Rollback: revert. No persisted state, no wire-format change — this is entirely client + plugin-runtime.

## Open Questions

1. **Does the mobile sheet need group headers at all?** Five headers on a small sheet may cost more than they clarify.
2. **Should `disabled` items render or hide?** D-C says render-disabled for KB's `indexing`. Whether that generalises to every plugin's `disabled` is unresolved.
3. **What happens when a plugin registers 20 items?** No cap is specified. The current worst case is ~13, but nothing enforces it.
4. **Do the five group labels need i18n keys added?** The taxonomy is new user-visible text; the existing menu shipped with two groups.
