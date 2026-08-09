# Test Plan — add-folder-actions-menu

Stage: design   Generated: 2026-08-07

All three spec gaps raised at the HARD gate were answered before this file was written, so no
`[NEEDS CLARIFICATION]` markers remain:

- mobile sheet gates on the existing compound mobile predicate (`<768w OR <600h`), reused verbatim
- pinned state is a **non-interactive** `mdiPin` indicator in the header
- `remove-from-workspace` duplication (popover + menu) is an accepted trade-off, and is tested as such

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | folder-actions-menu · replaces the header action cluster | decision-table | L1 | automated | a top-level folder outside any workspace | header renders | trailing cluster contains exactly 1 element; zero nodes matching the sort / pin / add-to-workspace / remove / settings test ids |
| E2 | folder-actions-menu · groups are a fixed host-owned taxonomy | decision-table | L1 | automated | top-level folder, `workspaces.length > 0` | menu opens | workspace group contains add-to-workspace; directory group contains pin, urgency sort, directory settings; no remove item |
| E3 | folder-actions-menu · groups are a fixed host-owned taxonomy | decision-table | L1 | automated | folder inside a workspace container | menu opens | workspace group contains remove-from-workspace and NOT add-to-workspace; directory group contains NO pin item |
| E4 | folder-actions-menu · groups are a fixed host-owned taxonomy | decision-table | L1 | automated | `workspaces = []` and no create-workspace handler | menu opens | workspace group heading absent; directory group still rendered |
| E5 | add-to-workspace-affordance · preserved behavior and gating | EP | L1 | automated | `workspaces = []`, create handler present | menu opens | add-to-workspace item present (gating unchanged from today) |
| E6 | add-to-workspace-affordance · test id preserved | EP | L1 | automated | folder at cwd `/a/b` | menu opens | an element with test id `add-to-workspace-btn-/a/b` exists inside the menu |
| E7 | folder-actions-menu · menus are scoped per folder | state-transition | L1 | automated | two folder cards, cwd `/a` and `/b` | open `/a`'s menu | `/a` menu open, `/b` menu closed; opening `/b` closes `/a` |
| E8 | folder-action-bar · empty action bar does not render | decision-table | L1 | automated | configured folder, `hasHook:false, configured:true`, 0 broken sessions | header renders expanded | no `FolderActionBar` node in the tree |
| E9 | folder-action-bar · layout | decision-table | L1 | automated | folder with 2 broken sessions | header renders expanded | action bar renders with `Clean up broken (2)`; no Directory Settings cog on it |
| E10 | pinned-directories-ui · pin toggle | state-transition | L1 | automated | unpinned folder outside a workspace | activate the menu's pin item | `onPinDirectory` called once with that cwd; menu closes |
| E11 | pinned-directories-ui · pin toggle | state-transition | L1 | automated | pinned folder outside a workspace | activate the menu's pin item | `onUnpinDirectory` called once with that cwd |
| E12 | pinned-directories-ui · pinned indicator | EP | L1 | automated | pinned folder | header renders | a non-interactive `mdiPin` indicator is present; it is not a `button` and has no tabindex |
| E13 | pinned-directories-ui · unpinned group renders no indicator | EP | L1 | automated | unpinned folder | header renders | no `mdiPin` indicator in the header |
| E14 | folder-actions-menu · accepted duplication | decision-table | L1 | automated | folder inside a workspace | open the menu, then open the AddToWorkspaceMenu popover | both expose a remove-from-workspace control; activating either calls `onRemoveFolderFromWorkspace` with identical args |
| E15 | directory-settings-page · menu item opens Directory Settings | EP | L1 | automated | folder at cwd `/Users/u/proj` | activate the Directory Settings menu item | navigation to that directory's settings route, `packages` page by default |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | folder-actions-menu · opening neither navigates nor collapses | state-transition | L3 | automated | expanded folder in the sidebar | click the menu trigger | menu open AND folder still expanded AND route unchanged |
| F2 | directory-home-page · row click opens the home page | state-transition | L3 | automated | any directory row (pinned, unpinned, workspace-owned) | click the header row outside the trigger | route becomes `/folder/<encodedCwd>` |
| F3 | directory-home-page · whole-row navigation does not collapse | state-transition | L3 | automated | expanded folder | click the header row | route changed AND folder still expanded |
| F4 | directory-home-page · no dedicated icon open control | state-transition | L3 | automated | pinned folder (where the icon used to render) | header renders | zero nodes with test id `folder-open-home-<cwd>` |
| F5 | folder-actions-menu · adapts to viewport | state-transition | L3 | automated | viewport 375×900 | open the menu | menu renders in sheet form, full-width, no horizontal overflow |
| F6 | folder-actions-menu · adapts to viewport | BVA | L3 | automated | viewport 1200×560 (mobile predicate true on height) | open the menu | menu renders in sheet form |
| F7 | folder-actions-menu · adapts to viewport | BVA | L3 | automated | viewport 1200×900 | open the menu | menu renders as a floating popover, not a sheet |
| F8 | sidebar-folder-header · cluster stays top-right at any width | BVA | L3 | automated | folder with a long path, sidebar narrowed to 220px | header renders | trigger still on one line in the top-right; cluster does not wrap; parent path truncated before the leaf name |
| F9 | folder-actions-menu · trigger glyph unique on the rendered card | state-transition | L3 | automated | folder containing a worktree session card | both rendered | folder trigger and worktree trigger resolve to different glyph paths |
| F10 | folder-workspaces · session cards carry no add-to-workspace | state-transition | L3 | automated | folder with ≥1 session card | sidebar renders | zero nodes with test id `session-card-add-to-workspace-*`, desktop and mobile |
| F11 | directory-home-page · folder name signals it is a link | visual/subjective | — | manual-only | folder header row | human hovers the leaf name | judgment: the hover affordance reads as a link without looking clickable at rest |
| F12 | folder-actions-menu · sheet ergonomics | visual/subjective | — | manual-only | menu sheet on a real phone | human opens and scans it | judgment: item order and grouping are scannable one-handed |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | folder-actions-menu · accessible | fault-injection (interaction) | L1 | automated | menu open, focus inside it | press Escape | menu closes AND focus returns to the trigger element |
| X2 | folder-actions-menu · accessible | fault-injection (interaction) | L1 | automated | menu open | click outside the menu | menu closes; no item handler fires |
| X3 | folder-actions-menu · replaces the header action cluster | fault-injection (interaction) | L1 | automated | menu trigger inside the navigating header row | activate the trigger | trigger's click does not propagate: no navigation, no collapse toggle |
| X4 | folder-actions-menu · accessible | state-transition | L1 | automated | menu closed | inspect the trigger | `aria-haspopup="menu"` present and `aria-expanded="false"`; after opening, `aria-expanded="true"`; items expose `role="menuitem"` |
| X5 | folder-actions-menu · menus are scoped per folder | fault-injection (state) | L3 | automated | menu open on folder `/a` | `/a` collapses while the menu is open (e.g. spawn auto-collapse) | menu closes or stays anchored to a rendered trigger; no orphaned popover, no console error |
| X6 | folder-actions-menu · menus are scoped per folder | fault-injection (state) | L3 | automated | menu open on a folder | the folder is drag-reordered in the sidebar | no orphaned popover left at the old position; no console error |

### Performance

_None. This change adds no data path, no polling, and no new render loop — it replaces four
buttons with one trigger. No requirement in the delta set states a latency, throughput or memory
threshold, so no performance Triple is derivable, and inventing one would be a fabricated
threshold rather than a spec-derived scenario._

---

## Coverage summary

- Requirements covered: 12/12 (every requirement across the 8 deltas has ≥1 scenario)
- Scenarios by class: edge 15 · perf 0 · frontend 12 · error 6
- Scenarios by level: L1 19 (E1–E15, X1–X4) · L2 0 · L3 12 (F1–F10, X5–X6) · manual-only 2 (F11, F12)
- Scenarios by disposition: automated 31 · manual-only 2

**No L2 rows.** This change touches no install, spawn, process or multi-OS runtime path, so the
qa/ smoke tier has nothing to assert. Routing a rendered-UI assertion there would violate the
level boundary.

## New infra needed

None. L1 extends existing sibling tests (`SessionList.test.tsx`, `FolderActionBar.test.tsx`);
L3 extends existing specs (`directory-home.spec.ts`, `folder-membership-drag.spec.ts`,
`kb-folder-slot.spec.ts`) against the harness port recorded in `.pi-test-harness.json`.

## Regression migration (not new scenarios)

These existing tests assert the pre-change behaviour and must be migrated, not added to:

- `SessionList.test.tsx:840-845` — asserts the cluster is exactly `[folder-urgency-sort, add-to-workspace-btn, folder-open-home, unpin-dir-btn]`; inverted by E1.
- `SessionList.test.tsx:889-900` — asserts `session-card-add-to-workspace-s1` exists; inverted by F10.
- `SessionList.test.tsx:664-755` — drives `folder-open-home`; superseded by F2/F4.
- `tests/e2e/directory-home.spec.ts:27,66,80` — navigates via `folder-open-home-<cwd>`.
- `tests/e2e/folder-membership-drag.spec.ts:49,136,151,171,189,194` — `folder-open-home`, `add-to-workspace-btn`, `ws-remove-`.
- `tests/e2e/kb-folder-slot.spec.ts:26,65,85` — anchors rows on `folder-urgency-sort-<cwd>`.
