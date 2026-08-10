# Tasks — move-slot-actions-to-menu (D9 · D10)

## 1. Ground truth — count across the rendered card

- [ ] 1.1 Enumerate all ten slot-pill action buttons and their test ids: `folder-automation-new-btn`, `folder-automation-refresh`, `folder-goal-new-btn`, `folder-goals-refresh`, `folder-kb-reindex` / `-index-now` / `-retry`, `folder-openspec-refresh`, `folder-archive-btn`, `folder-specs-btn`.
- [ ] 1.2 Enumerate the glyphs the **rendered card** shows (not the repo). Expect `mdiRefresh` ×4 (automations, goals, OpenSpec, KB — KB renders ONE mutually-exclusive branch, and none at all in `not-indexed`) and `mdiPlus` ×2. Count what renders, not how many code branches exist; counting branches is the same repo-shaped error D8 warns against.
- [ ] 1.3 `rg` every consumer of `SlotPill.actions` — confirmed to be exactly four: `FolderGoalsSection.tsx:42`, `FolderAutomationSection.tsx:69`, `FolderKbSection.tsx:127`, `FolderOpenSpecSection.tsx:57`.
- [ ] 1.3a Read `FolderMenuItem` (`FolderActionsMenu.tsx:43-58`): it already carries `pressed?` (urgency sort's `aria-pressed`) and `node?` (add-to-workspace's popover + `add-to-workspace-btn-<cwd>` contract). Both are HOST-only and must survive; the plugin-facing type is a strict subset.
- [ ] 1.3b Classify each of the four consumers by callback ownership: Goals (`refetch` from its hook), Automations (`setReloadKey` local state), KB (state-derived) are section-local and need the registry; **OpenSpec's are host props on `SessionList`** and are contributed host-side without it.
- [ ] 1.3c Note `FolderKbSection` also renders under `WorktreeCardSectionSlot` (`placement: "card"`), a scope with no folder actions menu — card placement must not register.
- [ ] 1.3d Add `folder-kb-stale` to the id inventory: its badge is mirrored on the menu's reindex item, so its consumers need updating too.
- [ ] 1.4 Confirm the Pi Resources entry point IS the existing `directory-settings` item (`SessionList.tsx:1074-1075`, `group: "directory"`) after the `directory-settings-page` re-label. It is not rehomed and MUST NOT gain a second entry in `OPEN` — that would mandate one destination from two groups.

## 2. Tests first (red) — folded from test-plan.md

Author these before the implementation in sections 3-4 and verify each fails. Every row below maps to exactly one manifest scenario. F1/F2/F5 and X3 need a harness that mounts and unmounts slot sections independently of the menu — build that helper first; six scenarios depend on it and its failure modes are silent.

### 2a. Pill surface — L1, extend `packages/dashboard-plugin-runtime/src/__tests__/SlotPill.test.tsx` (it asserts nothing about `actions` today; this is a new red test)

- [ ] 2.1 Structural state-only invariant: directory card rendering all four slot pills · card renders · the pill grid contains zero focusable/interactive elements other than the pill roots (test-plan #E1)
- [ ] 2.2 No moved glyphs remain: same card · card renders · no `mdiRefresh`, `mdiPlus`, `mdiArchiveOutline` or `mdiFileDocumentOutline` inside a pill (test-plan #E2)
- [ ] 2.3 Pill is a single control: a slot pill after the prop is gone · user tabs to it and presses Enter · the pill's own navigation fires and no nested control takes focus first (test-plan #F6)
- [ ] 2.4 Prop removal is a compile-time break: a consumer still passing `actions` · type-check runs · compilation fails, with no runtime shim accepting or converting it (test-plan #X1)

### 2b. Menu composition — L1, extend the folder-actions-menu tests

- [ ] 2.5 Create actions land in CREATE: folder with the automation and goal plugins active · menu opens · `CREATE` holds the new-automation and new-goal items (test-plan #E3)
- [ ] 2.6 Open actions land in OPEN: folder with OpenSpec present · menu opens · `OPEN` holds slot-qualified archive and specs items (test-plan #E4)
- [ ] 2.7 Order is registration-independent: two plugin load orders producing the same item set · menu renders · group order and within-group order identical across both (test-plan #E5)
- [ ] 2.8 Within-group ordering key: two plugins each contributing one `CREATE` item, registering in either order · menu renders · items order by `pluginId` with host items first, never by mount order (test-plan #E6)
- [ ] 2.9 Empty group: folder for which no workspace-group item applies · menu opens · no workspace group heading (test-plan #E7)
- [ ] 2.10 Gating not widened: folder inside a workspace container · menu opens · remove-from-workspace present, add-to-workspace absent, no pin item (test-plan #E8)
- [ ] 2.11 One refresh item: folder with automations, goals and OpenSpec present · menu opens · exactly one plain refresh item (test-plan #E9)
- [ ] 2.12 KB folds to one item: folder whose KB is in `error` · menu opens · a single KB item labelled for retry, no extra index-now or reindex item (test-plan #E10)
- [ ] 2.13 KB keeps its stale badge: folder whose KB reports stale chunks · menu opens · a KB reindex item carrying the stale badge, distinct from the plain refresh (test-plan #E11)
- [ ] 2.14 Labels slot-qualified: the OpenSpec archive item · menu opens · its label names OpenSpec (test-plan #E12)
- [ ] 2.15 Pi Resources keeps one home: any folder · menu opens · the `DIRECTORY` Directory Settings item routes to the resources surface and no `OPEN` item duplicates it (test-plan #E13)
- [ ] 2.16 Badge and disabled render: a contributed item with a badge, and one marked disabled · menu opens · the badge forms part of the accessible name and the disabled item is exposed as a disabled control (test-plan #E17)
- [ ] 2.17 Disabled does not fire: a contributed item marked disabled · user activates it · its callback does not run (test-plan #E18)
- [ ] 2.18 KB disabled window covers pending: KB where `busy` is `pending` but `stats.indexing` is false · menu opens · the KB item is disabled (test-plan #E19)

### 2c. Contribution contract — L1, new tests beside the registry

- [ ] 2.19 Declarative-only type: a contribution attempting to carry `node` or `pressed` · type-checked / registered · the plugin type rejects it while the host item type still accepts both (test-plan #E14)
- [ ] 2.20 Required fields: contributions each missing one of `id`/`group`/`label`/`icon`/`onSelect` · menu renders · each malformed item skipped, siblings still render (test-plan #E15)
- [ ] 2.21 Unknown group dropped: contribution naming a group outside the taxonomy · menu renders · item absent, siblings unaffected (test-plan #E16)
- [ ] 2.22 Refresher renders no item: a section registering only a refresher · menu opens · no item for that registration (test-plan #E20)
- [ ] 2.23 Unified refresh reaches everything: automations and goals refreshers registered, OpenSpec host-side · user activates the single refresh item · both registered refreshers run AND the host OpenSpec refresher runs (test-plan #E21)
- [ ] 2.24 Latest registration wins: a section registered, unmounted, remounted re-registering the same id · user activates that item · the most recent callback runs, not the first (test-plan #F1)
- [ ] 2.25 Unmount deregisters: a section that registered a contribution · that section unmounts · its item no longer renders and no stale callback stays reachable (test-plan #F2)
- [ ] 2.26 Card placement registers nothing: a KB section in the worktree-card placement · it renders · it registers nothing (test-plan #F4)
- [ ] 2.27 Cross-plugin id collision: two plugins registering the same contribution id · menu renders · the winner is decided by `pluginId` comparison, identically across load orders (test-plan #F5)
- [ ] 2.28 A throwing callback is contained: a contribution whose `onSelect` throws · user activates it · the menu and sibling items keep working (test-plan #X2)

### 2d. Rendered behaviour — L3, extend the Playwright suite (harness port from `.pi-test-harness.json` `dashboardPort`)

- [ ] 2.29 Late mount updates an open menu: the menu is open · a slot section mounts and registers · the open menu converges to include the new item without being closed and reopened (test-plan #F3)
- [ ] 2.30 Trigger neither navigates nor collapses: an expanded folder · user activates the folder actions trigger · the menu opens, the folder stays expanded, no navigation to the directory home (test-plan #F7)
- [ ] 2.31 Menus scoped per folder: two folder headers in the sidebar · user opens one folder's menu · the other stays closed (test-plan #F8)
- [ ] 2.32 Mobile sheet: the menu below the mobile breakpoint · user opens it · it presents as a full-width sheet and returns focus to the trigger on dismissal (test-plan #F9)
- [ ] 2.33 Deregistration during an open menu: the menu is open showing a plugin's item · that plugin's section unmounts while open · the item disappears or is inert and never invokes a dead callback (test-plan #X3)

- [ ] 2.34 Verify every test in section 2 fails before implementation begins.

## 3. Implement the contribution point

- [ ] 3.1 Add the folder-scoped contribution registry with the fixed taxonomy `WORKSPACE · DIRECTORY · CREATE · OPEN · MAINTENANCE`. Bridge header↔subtree via a provider-scoped external store consumed with `useSyncExternalStore` — the menu and the sections are siblings, so a prop cannot carry it.
- [ ] 3.1a Split the types: keep host `FolderMenuItem` (with `node?` / `pressed?`, gaining `badge?` / `disabled?`) and add a strict plugin-facing contribution type without them.
- [ ] 3.1b The registration API must stamp the contributing plugin's identity from the plugin context — NOT from the payload, which carries no `pluginId` and must not be able to spoof one. The within-group ordering and cross-plugin collision rules both depend on it.
- [ ] 3.1c Add a REFRESHER registration path distinct from item contribution: a callback that renders no item, so the single folded refresh can fan out to automations and goals once their buttons are gone.
- [ ] 3.1d Extend the menu's hardcoded group list (`FolderActionsMenu.tsx:36`, currently `["workspace","directory"]`) to the five-group taxonomy.
- [ ] 3.2 Remove `actions?: ReactNode` from `SlotPill.tsx` and its render branch.
- [ ] 3.3 Migrate each plugin to declarative contributions: automations (new + refresh), goals (new + refresh), KB (one reindex item), OpenSpec (refresh + archive + specs).
- [ ] 3.4 Collapse the three plain refreshes into one `MAINTENANCE` item that fans out to every refresher registered for the folder; each section keeps its own data hook.
- [ ] 3.5 KB: one item whose label/badge/disabled state varies by KB state; keep the stale badge; drop the click-propagation carve-out.
- [ ] 3.6 Slot-qualify ambiguous labels ("OpenSpec archive", "OpenSpec specs").
- [ ] 3.7 Confirm the Pi Resources surface stays reachable from exactly ONE menu item (the `DIRECTORY`-group Directory Settings) — hard gate: not lost, and not duplicated into `OPEN`.
- [ ] 3.8 Add badge + disabled rendering to the menu's item renderer (icon + label only today), including the disabled control semantics assistive tech needs — a prerequisite for KB's item.

## 4. Strip the pills

- [ ] 4.2 Remove the ten controls from the slot sections; keep each slot's data hook and its single primary click target.
- [ ] 4.3 Re-run the per-card glyph count from 1.2 and assert no glyph carries two meanings.

## 5. Migrate consumers

- [ ] 5.1 Update every unit test anchoring on the ten removed test ids.
- [ ] 5.2 Re-grep `tests/e2e/` for the ten ids before assuming E2E work: the current grep returns nothing, so the blast radius is unit tests. Update E2E only if that changes.

## 6. Breaking-change hygiene

- [ ] 6.1 CHANGELOG entry: `SlotPill.actions` removed; declarative `folder-actions-menu` contributions replace it.
- [ ] 6.2 Plugin-author migration note in the plugin docs (delegate `docs/` prose to DocScribe).
- [ ] 6.3 Grep the repo for any remaining third-party-facing reference to `SlotPill.actions`.
- [ ] 6.4 Confirm i18n keys exist for the five group labels — the taxonomy adds user-visible text and the menu shipped with two groups.

## 7. A11y + verify

- [ ] 7.1 Items carry `role="menuitem"`; group headers are non-focusable labels; the mobile sheet returns focus to the trigger on dismissal.
- [ ] 7.2 Update the affected directory `AGENTS.md` rows.
- [ ] 7.3 `npm run quality:changed`; `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`; diff failures against the pre-change baseline — zero new.
- [ ] 7.4 `npx openspec validate --changes move-slot-actions-to-menu --strict`.
- [ ] 7.4a Menu density after consolidation: open the menu on a folder with every plugin active and confirm five groups and ~a dozen items still read as scannable rather than a wall (test-plan: manual-only)
- [ ] 7.5 Manual/isolated check (`isolated-ui-verification`): every KB state, a folder with a plugin disabled, and the mobile sheet.
- [ ] 7.6 Run `doubt-driven-review` before removing the public prop (irreversible for third-party authors), then `review-code` on the diff before commit.
