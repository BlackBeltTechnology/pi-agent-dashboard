# Test Plan — move-slot-actions-to-menu

Stage: design   Generated: 2026-08-14

Clarification gate: **passed**. Three unfillable slots were resolved and folded
back into the spec as requirements — plugin identity is the existing `pluginId`
read from the plugin context, the prop removal is a compile-time break with no
runtime shim, and "zero action buttons" is asserted structurally (no focusable
elements in the pill grid beyond the pill roots). No `[NEEDS CLARIFICATION]`
markers remain.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Tier 3 is state-only | decision-table | L1 | automated | directory card rendering all four slot pills | card renders | the pill grid contains zero focusable/interactive elements other than the pill roots |
| E2 | Tier 3 is state-only | decision-table | L1 | automated | same card | card renders | no `mdiRefresh`, `mdiPlus`, `mdiArchiveOutline` or `mdiFileDocumentOutline` renders inside a pill |
| E3 | Fixed verb taxonomy | decision-table | L1 | automated | folder with the automation and goal plugins active | menu opens | the `CREATE` group contains the new-automation and new-goal items |
| E4 | Fixed verb taxonomy | decision-table | L1 | automated | folder with OpenSpec present | menu opens | the `OPEN` group contains slot-qualified archive and specs items |
| E5 | Group order is registration-independent | decision-table | L1 | automated | two plugin load orders producing the same item set | menu renders | group order and within-group item order are identical across both |
| E6 | Within-group ordering key | decision-table | L1 | automated | two plugins each contributing one `CREATE` item, registering in either order | menu renders | items order by `pluginId`, host items first — never by mount order |
| E7 | Empty group does not render | BVA (zero boundary) | L1 | automated | folder for which no workspace-group item applies | menu opens | no workspace group heading renders |
| E8 | Placement gating is not widened | decision-table | L1 | automated | folder inside a workspace container | menu opens | workspace group has remove-from-workspace, no add-to-workspace; directory group has no pin |
| E9 | Three refreshes collapse to one | decision-table | L1 | automated | folder with automations, goals and OpenSpec present | menu opens | exactly one plain refresh item renders |
| E10 | KB folds to one item | decision-table | L1 | automated | folder whose KB is in the `error` state | menu opens | a single KB item renders labelled for retry; no additional index-now or reindex item |
| E11 | KB item keeps its stale badge | EP | L1 | automated | folder whose KB reports stale chunks | menu opens | a KB reindex item renders carrying the stale badge, distinct from the plain refresh |
| E12 | Ambiguous labels slot-qualified | EP | L1 | automated | the OpenSpec archive item | menu opens | its label names OpenSpec |
| E13 | Pi Resources keeps one home | decision-table | L1 | automated | any folder | menu opens | the `DIRECTORY` group's Directory Settings item routes to the resources surface, and no `OPEN` item duplicates that destination |
| E14 | Plugin type is declarative only | decision-table | L1 | automated | a contribution attempting to carry a `node` or `pressed` field | type-checked / registered | the plugin-facing type rejects it; the host's own item type still accepts both |
| E15 | Required-field set | decision-table | L1 | automated | contributions each missing one of `id`/`group`/`label`/`icon`/`onSelect` | menu renders | each malformed item is skipped and sibling items still render |
| E16 | Unknown group dropped | decision-table | L1 | automated | contribution naming a group outside the taxonomy | menu renders | the item does not render; siblings unaffected |
| E17 | Badge and disabled render | decision-table | L1 | automated | a contributed item with a badge, and one marked disabled | menu opens | the badge renders and forms part of the accessible name; the disabled item is exposed as a disabled control |
| E18 | Disabled item does not fire | decision-table | L1 | automated | a contributed item marked disabled | user activates it | its callback does not run |
| E19 | KB disabled window covers pending | BVA (window boundary) | L1 | automated | KB where `busy` is `pending` but `stats.indexing` is still false | menu opens | the KB item is disabled — the guard covers the optimistic window, not only the polled state |
| E20 | Refreshers register separately | decision-table | L1 | automated | a section registering only a refresher | menu opens | no item renders for that registration |
| E21 | Unified refresh reaches everything | decision-table | L1 | automated | automations and goals refreshers registered; OpenSpec host-side | user activates the single refresh item | both registered refreshers run AND the host OpenSpec refresher runs |

### Performance

None. The change moves controls between surfaces; it adds no data path, no
polling and no new fetch. The registry holds a handful of items per folder.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Latest registration wins | state-transition | L1 | automated | a section that registered, unmounted, then remounted re-registering the same id | user activates that item | the most recent registration's callback runs — not the first |
| F2 | Unmount deregisters | state-transition | L1 | automated | a section that registered a contribution | that section unmounts, e.g. its plugin is disabled | its item no longer renders and no stale callback remains reachable |
| F3 | Late mount updates an open menu | state-convergence | L3 | automated | the folder actions menu is open | a slot section mounts and registers | the open menu converges to include the new item without being closed and reopened |
| F4 | Card placement does not register | decision-table | L1 | automated | a KB section rendered in the worktree-card placement | it renders | it registers nothing — its scope has no folder actions menu |
| F5 | Cross-plugin id collision | state-transition (illegal edge) | L1 | automated | two distinct plugins registering the same contribution id | menu renders | the winner is decided by `pluginId` comparison, identically across both load orders |
| F6 | Pill remains a single control | state-transition | L1 | automated | a slot pill after the actions prop is gone | user tabs to the pill and presses Enter | the pill's own navigation fires, and no nested control receives focus first |
| F7 | Menu trigger neither navigates nor collapses | state-transition (illegal edge) | L3 | automated | an expanded folder | user activates the folder actions trigger | the menu opens, the folder stays expanded, no navigation to the directory home |
| F8 | Menus are scoped per folder | state-transition | L3 | automated | two folder headers in the sidebar | user opens one folder's menu | the other folder's menu remains closed |
| F9 | Mobile sheet presentation | state-transition | L3 | automated | the menu below the mobile breakpoint | user opens it | it presents as a full-width sheet and returns focus to the trigger on dismissal |
| F10 | Menu density after consolidation | visual/subjective | — | manual-only | the menu on a folder with every plugin active | human opens it | [judgment: five groups and ~a dozen items still read as scannable rather than a wall — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Prop removal is a compile-time break | fault-injection (stale consumer) | L1 | automated | a consumer still passing `actions` to `SlotPill` | type-check runs | compilation fails; no runtime shim silently accepts or converts it |
| X2 | Malformed contribution is contained | fault-injection (bad input) | L1 | automated | a contribution whose `onSelect` throws when invoked | user activates it | the failure does not break the menu or its sibling items |
| X3 | Deregistration during an open menu | fault-injection (races) | L3 | automated | the menu is open showing a plugin's item | that plugin's section unmounts while the menu is open | the item disappears or is inert; activating it never invokes a dead callback |

---

## Coverage summary

- Requirements covered: 14/14 across the seven delta specs
- Scenarios by class: edge 21 · perf 0 · frontend 10 · error 3
- Scenarios by level: L1 27 · L2 0 · L3 6 · manual-only 1
- Scenarios by disposition: automated 33 · manual-only 1

No L2 rows: the change is client + plugin-runtime only, with no process,
install or multi-OS runtime surface.

## New infra needed

None. L1 rows extend the existing `SlotPill`, folder-section and menu test
files; L3 rows extend the Playwright suite against the docker harness (port from
`.pi-test-harness.json` `dashboardPort`).

Note for the L1 author: F1/F2/F5 and X3 need a test harness that can mount and
unmount slot sections independently of the menu. Build that helper once — six
scenarios depend on it, and it is the part of this change most likely to be
under-tested because the failure modes are silent.
