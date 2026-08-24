# folder-actions-menu Specification

## Purpose
TBD - created by archiving change add-folder-actions-menu. Update Purpose after archive.
## Requirements
### Requirement: Folder actions menu replaces the header action cluster

The folder header SHALL expose exactly one trailing control: a folder actions menu trigger.

Every directory mutation on the card SHALL be reachable from that menu and SHALL NOT also render as a standalone control. The only mutation permitted outside the menu is the tier-0 banner's own call to action, which exists precisely because the folder cannot proceed without it.

The previous carve-out — that the slot pills' own action buttons were "outside its scope and continue to render" — no longer holds. Every slot action is now an item in this menu, and the pill grid is state-only.

**Accepted duplication.** The `AddToWorkspaceMenu` popover already offers its own
remove-from-workspace entry. The gesture is reachable both from that popover and from the folder
actions menu's workspace group. Both SHALL continue to work and SHALL have identical effect.

Activating the trigger SHALL stop click propagation so it neither navigates to the directory
home page nor toggles the folder's collapsed state.

Menu open state SHALL be keyed per folder scope so opening one folder's menu never opens
another's.

#### Scenario: Cluster is a single control

- **WHEN** a folder header renders its trailing cluster
- **THEN** exactly one control SHALL render in the cluster
- **AND** the urgency-sort, pin, add-to-workspace, remove-from-workspace and directory-settings controls SHALL NOT render as separate cluster buttons

#### Scenario: No mutation control renders outside the menu

- **WHEN** an expanded folder card renders
- **THEN** no mutation control SHALL render outside the folder actions menu, other than the tier-0 banner's call to action
- **AND** the slot pills SHALL render no action buttons

#### Scenario: Controls outside the header row are unaffected

- **WHEN** an expanded folder card renders while `FolderActionBar` holds an Initialize or cleanup control
- **THEN** those controls SHALL continue to render on their own row
- **AND** their presence SHALL NOT be treated as a violation of this requirement

#### Scenario: Opening the menu neither navigates nor collapses

- **GIVEN** an expanded folder
- **WHEN** the user activates the folder actions trigger
- **THEN** the menu SHALL open
- **AND** the client SHALL NOT navigate to the directory home page
- **AND** the folder SHALL remain expanded

#### Scenario: Menus are scoped per folder

- **GIVEN** two folder headers rendered in the sidebar
- **WHEN** the user opens one folder's actions menu
- **THEN** the other folder's menu SHALL remain closed

### Requirement: Menu groups are a fixed host-owned taxonomy

Menu items SHALL be grouped by concern under host-defined headings, rendered in a stable
order. A group SHALL render only when it contains at least one item.

The taxonomy SHALL be the five verb groups `WORKSPACE · DIRECTORY · CREATE · OPEN ·
MAINTENANCE`, extending the two the menu shipped with. Grouping SHALL be by verb, never one
group per plugin — per-plugin grouping produces single-item groups and leaks the extension
architecture into the user's mental model. Every action previously rendered by a slot pill
SHALL be an item in this taxonomy:

| Former control | Group |
|---|---|
| new automation, new goal | `CREATE` |
| OpenSpec archive, OpenSpec specs | `OPEN` |
| KB reindex (with its stale badge), the unified refresh | `MAINTENANCE` |

Group membership SHALL respect the folder's existing placement gating rather than widening it:
an add-to-workspace item SHALL appear only where that affordance renders today, a
remove-from-workspace item only for workspace-owned folders, and a pin item only where pinning
is meaningful.

The `directory` group SHALL additionally contain a **manage-worktrees** item,
opening the shared worktree list in `manage` mode for that folder's `cwd`. It is
the only session-independent entry point to worktree removal, so it SHALL be
gated on the folder being a git repository rather than on any session state.

**Within** a group, items SHALL be ordered by an explicit, registration-independent key:
host-owned items first in their declared order, then contributed items sorted by the
contributing plugin's identity and, within one plugin, by contribution id. Declaring only that
order "is stable" without naming the key leaves two plugins' items in whatever order they
mounted.

#### Scenario: Top-level folder outside a workspace

- **WHEN** the folder actions menu opens for a top-level folder outside any workspace **that is a git repository**
- **THEN** the workspace group SHALL contain an add-to-workspace item
- **AND** the directory group SHALL contain pin, urgency sort, directory settings, and manage worktrees
- **AND** for a folder that is NOT a git repository the same groups SHALL appear WITHOUT the manage-worktrees item

#### Scenario: Workspace-owned folder omits what does not apply

- **WHEN** the folder actions menu opens for a folder inside a workspace container
- **THEN** the workspace group SHALL contain a remove-from-workspace item
- **AND** it SHALL NOT contain an add-to-workspace item
- **AND** the directory group SHALL NOT contain a pin item

#### Scenario: Manage worktrees is gated on the folder being a git repository

- **WHEN** the folder actions menu opens for a folder that is not a git repository
- **THEN** the directory group SHALL NOT contain a manage-worktrees item

#### Scenario: Manage worktrees does not depend on session state

- **WHEN** the folder actions menu opens for a git repository with no live sessions
- **THEN** the directory group SHALL still contain a manage-worktrees item

#### Scenario: Create actions land in CREATE

- **WHEN** the menu opens on a folder with the automation and goal plugins active
- **THEN** the `CREATE` group SHALL contain the new-automation and new-goal items

#### Scenario: Group order is registration-independent

- **GIVEN** two plugin load orders producing the same item set
- **WHEN** the menu renders
- **THEN** the group order and the within-group item order SHALL be identical

#### Scenario: Empty group does not render

- **GIVEN** a folder for which no workspace-group item applies
- **WHEN** the menu opens
- **THEN** the workspace group heading SHALL NOT render

### Requirement: Menu trigger glyph is unique on the rendered card

The trigger's glyph SHALL NOT be a glyph already rendered as a menu trigger elsewhere on the
same card. In particular it SHALL NOT reuse the worktree actions menu's glyph, because a
worktree session card renders inside the folder body and the two triggers would otherwise be
visually identical with different scopes.

Glyph uniqueness SHALL be assessed against what the **rendered card** displays, not against
the set of glyphs used across the repository.

#### Scenario: Folder and worktree triggers are distinguishable

- **GIVEN** a folder containing a worktree session card, which renders its own actions menu trigger
- **WHEN** the folder header and that session card are both visible
- **THEN** the two triggers SHALL render different glyphs

### Requirement: Menu is accessible and adapts to viewport

The trigger SHALL expose `aria-haspopup="menu"` and an `aria-expanded` state bound to whether
its menu is open. Items SHALL expose `role="menuitem"`.

The menu SHALL support keyboard operation: opening, moving between items, dismissing with
Escape, and returning focus to the trigger on dismissal.

The menu SHALL present as a full-width sheet rather than a floating popover whenever the
application's existing mobile predicate is true. That predicate is compound — viewport width
below 768px **or** viewport height below 600px — and SHALL be reused verbatim rather than
re-derived, so a short-but-wide window also gets the sheet. In the sheet form every item SHALL
remain reachable and meet the platform touch-target minimum.

The trigger SHALL expose the test id `folder-actions-menu-<cwd>`, and each item SHALL expose a
test id derived from its stable item id so automation need not depend on labels.

#### Scenario: Trigger exposes menu semantics

- **WHEN** the folder actions trigger renders
- **THEN** it SHALL expose `aria-haspopup="menu"`
- **AND** `aria-expanded` SHALL reflect whether the menu is open

#### Scenario: Escape closes and restores focus

- **GIVEN** an open folder actions menu
- **WHEN** the user presses Escape
- **THEN** the menu SHALL close
- **AND** focus SHALL return to the trigger

#### Scenario: Narrow viewport presents a sheet

- **GIVEN** a viewport 375px wide and 900px tall
- **WHEN** the folder actions menu opens
- **THEN** it SHALL present as a full-width sheet, not a floating popover
- **AND** every item SHALL be reachable without horizontal scrolling

#### Scenario: Short-but-wide viewport also presents a sheet

- **GIVEN** a viewport 1200px wide and 560px tall, for which the mobile predicate is true on height
- **WHEN** the folder actions menu opens
- **THEN** it SHALL present as a full-width sheet

#### Scenario: Desktop viewport presents a popover

- **GIVEN** a viewport 1200px wide and 900px tall
- **WHEN** the folder actions menu opens
- **THEN** it SHALL present as a floating popover, not a sheet

### Requirement: The three plain slot refreshes collapse to one

The per-slot plain refresh controls (automations, goals, OpenSpec) SHALL be replaced by a single refresh item — per-slot refetch is data plumbing leaking into the UI.

Activating it SHALL refresh every slot the folder currently renders: the refreshers registered by plugin sections **and** the host-owned OpenSpec refresher, which is a `SessionList` prop rather than a registration. Defining the fan-out as "registered refreshers" alone would silently exclude OpenSpec. Each section keeps its own data hook. A section that is not mounted is not refreshed, which is harmless because it fetches on mount.

The KB controls (`reindex` / `index now` / `retry`) SHALL fold into **one** reindex item that remains distinct from that refresh, because rebuilding an index is not refetching a view. That item SHALL keep the KB stale badge and SHALL reflect the KB's state (retry vs index-now vs reindex) through its label and disabled state, not through separate items.

#### Scenario: One refresh item replaces three

- **WHEN** the menu opens on a folder with automations, goals and OpenSpec present
- **THEN** exactly one plain refresh item SHALL render
- **AND** activating it SHALL refetch all three slots, including the host-owned OpenSpec section

#### Scenario: KB reindex stays distinct and badged

- **GIVEN** a folder whose KB reports stale chunks
- **WHEN** the menu opens
- **THEN** a separate KB reindex item SHALL render carrying the stale badge

#### Scenario: KB state drives one item, not several

- **GIVEN** a folder whose KB is in the `error` state
- **WHEN** the menu opens
- **THEN** a single KB item SHALL render labelled for retry
- **AND** no additional KB index-now or reindex item SHALL render

### Requirement: The menu renders badge and disabled state

A menu item carrying a badge SHALL render it, and a disabled item SHALL render as disabled and SHALL NOT invoke its callback on activation. Both SHALL be exposed to assistive technology — the disabled state as a disabled control, the badge as part of the item's accessible name.

This is stated because the menu's current item renderer draws an icon and a label only; the KB reindex item's stale badge and its disabled `indexing`/pending state have nowhere to appear without it.

#### Scenario: Badge renders on the item

- **GIVEN** a contributed item carrying a badge
- **WHEN** the menu opens
- **THEN** the badge SHALL render on that item and form part of its accessible name

#### Scenario: Disabled item does not fire

- **GIVEN** a contributed item marked disabled
- **WHEN** the user activates it
- **THEN** its callback SHALL NOT run
- **AND** it SHALL be exposed as a disabled control

### Requirement: Ambiguous item labels are slot-qualified

Because a verb group no longer says which slot an item came from, any label that would be ambiguous across slots SHALL be qualified with its slot ("OpenSpec archive", not "Archive").

#### Scenario: Archive is qualified

- **WHEN** the `OPEN` group renders the OpenSpec archive item
- **THEN** its label SHALL name OpenSpec

### Requirement: The Pi Resources surface keeps exactly one menu home

The Pi Resources surface SHALL remain reachable from the folder actions menu's existing `DIRECTORY` group item labelled "Directory Settings", which already routes to it. No second entry point SHALL be created for it in `OPEN` or anywhere else.

This is stated because the feature came close to being lost twice: change 1's first draft deleted its container without rehoming it, and a draft of this change proposed adding it to `OPEN` — which would have mandated the same navigation from two groups, since "Pi Resources" and "Directory Settings" are the same control after the re-label.

#### Scenario: Pi Resources is reachable from exactly one item

- **WHEN** the folder actions menu opens
- **THEN** the `DIRECTORY` group SHALL contain the "Directory Settings" item routing to that directory's resources surface
- **AND** no `OPEN`-group item SHALL duplicate that destination

### Requirement: Plugins contribute declarative menu items, not markup

Removing `SlotPill.actions` SHALL be a compile-time break for any consumer that still passes it. No runtime compatibility path SHALL be added: the prop is not silently ignored, and no shim converts a passed node into a contribution. A supported plugin is a compiled one, so a type error is the correct and complete signal.

Plugins SHALL contribute menu items as data to a folder-scoped contribution registry. The plugin-facing contribution type SHALL be `{ id, group, label, icon, onSelect, badge?, disabled? }`, where `id`, `group`, `label`, `icon` and `onSelect` are **required**. It SHALL NOT accept a `ReactNode`, and it SHALL NOT accept the host's `pressed` toggle field: the host cannot group, order, keyboard-navigate or mobile-adapt opaque nodes.

The **host's** own item type MAY retain its existing `node` escape hatch and `pressed` field — today used by add-to-workspace, whose popover and test-id contract must survive verbatim, and by urgency sort's `aria-pressed`. That exception SHALL NOT be exposed to plugins.

`group` SHALL be one of the fixed taxonomy values; a contribution naming an unknown group SHALL be dropped rather than rendered ungrouped — an unknown group indicates a version mismatch, and inventing a home for it hides that. A contribution missing any required field SHALL degrade to a no-op without breaking sibling items.

Each registration SHALL carry the identity of the contributing plugin — the same `pluginId` the existing slot registry uses, read from the plugin context by the registration API rather than supplied in the contribution payload, so a plugin SHALL NOT be able to declare itself as another. That identity is what makes the ordering and collision rules below evaluable; without it they reference data the model cannot supply.

Registrations SHALL be keyed by the PAIR `(pluginId, contributionId)`, and the two collision rules apply to different cases:

- **Same `pluginId` AND same `id`** — a re-registration of one key. The **most recent** registration SHALL win, so a section that unmounts and remounts (including a development double-mount) keeps a live callback rather than a dropped one. Recency SHALL NOT decide anything else.
- **Different `pluginId`, same `id`** — two distinct keys competing for one rendered item. The winner SHALL be chosen by a stable comparison of the plugin identities (never by recency or mount order), so the outcome is identical across load orders.

Stating only "most recent wins" would make the cross-plugin case depend on mount order, which the ordering rule above exists to eliminate.

#### Scenario: Markup contribution is no longer possible

- **WHEN** a plugin renders a `SlotPill`
- **THEN** no `actions` prop SHALL be accepted

#### Scenario: Remount keeps the live callback

- **GIVEN** a slot section registered a contribution and then unmounted and remounted, re-registering the same id
- **WHEN** the user activates that item
- **THEN** the most recent registration's callback SHALL run

#### Scenario: Unmounted section leaves no ghost item

- **GIVEN** a slot section that registered a contribution
- **WHEN** that section unmounts, for example because its plugin was disabled
- **THEN** its item SHALL NOT render in the menu

#### Scenario: A late-mounting section updates an open menu

- **GIVEN** the folder actions menu is open
- **WHEN** a slot section mounts and registers a contribution
- **THEN** the open menu SHALL render the new item without being closed and reopened

#### Scenario: Card-placement sections do not register

- **GIVEN** a KB section rendered in the worktree-card placement, whose scope has no folder actions menu
- **WHEN** it renders
- **THEN** it SHALL NOT register a contribution

#### Scenario: Unknown group is dropped

- **GIVEN** a contribution naming a group outside the fixed taxonomy
- **WHEN** the menu renders
- **THEN** that item SHALL NOT render
- **AND** sibling items SHALL render normally

### Requirement: Refreshers register separately from menu items

A slot section SHALL be able to register a **refresher** — a callback with no menu item of its own — so the single `MAINTENANCE` refresh item can fan out to it. Registering a refresher SHALL NOT render an item, because the folded refresh renders exactly one item for the whole folder.

Without a registration path distinct from item contribution, the automations and goals refresh callbacks have nowhere to live once their buttons are removed, and the unified refresh cannot reach them.

#### Scenario: A refresher renders no item of its own

- **GIVEN** a slot section that registered only a refresher
- **WHEN** the menu opens
- **THEN** no item SHALL render for that registration

#### Scenario: The unified refresh reaches every registered refresher

- **GIVEN** automations and goals sections have each registered a refresher
- **WHEN** the user activates the single refresh item
- **THEN** both refreshers SHALL run
- **AND** the host-owned OpenSpec refresher SHALL also run

#### Scenario: Malformed contribution does not break the menu

- **GIVEN** a contribution missing a required field
- **WHEN** the menu renders
- **THEN** the item SHALL be skipped and the remaining items SHALL render

