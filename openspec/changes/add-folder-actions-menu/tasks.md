## 1. Planning gates

- [x] 1.1 doubt-driven-review cycles 1 and 2 complete; cross-model ran on @propose-review-1 both cycles; all actionable findings reconciled
- [x] 1.2 scenario-design complete; test-plan.md written with 33 scenarios after the HARD gate resolved 3 spec gaps
- [x] 1.3 Automated manifest rows folded into sections 8-9; manual-only rows folded into section 11
- [ ] 1.4 Re-verify every MODIFIED and REMOVED requirement title in specs/ still exists verbatim in openspec/specs/ before implementation starts — `openspec validate` does not check this, and two inert MODIFIED blocks are what forced this change to be split out of its umbrella

## 2. Folder actions menu component

- [ ] 2.1 Create the `FolderActionsMenu` component in `packages/client/src/components/folder/` — trigger plus grouped popover
- [ ] 2.2 Implement the host-owned group taxonomy (workspace membership, then directory) with a stable order, rendering a group only when it holds at least one item
- [ ] 2.3 Key open state per folder scope so opening one folder's menu never opens another's; reuse the existing `addToWsMenuFor` scope-key pattern rather than a cwd key
- [ ] 2.4 Stop click propagation on the trigger so opening neither navigates to the directory home page nor toggles collapse
- [ ] 2.5 Expose `aria-haspopup="menu"` and `aria-expanded` on the trigger, `role="menuitem"` on items
- [ ] 2.6 Implement keyboard operation: open, move between items, Escape to dismiss, focus returns to the trigger
- [ ] 2.7 Render as a full-width sheet whenever the existing mobile predicate is true; reuse `useMobile` verbatim (compound `<768w OR <600h`) rather than re-deriving a width threshold
- [ ] 2.8 Expose `folder-actions-menu-<cwd>` on the trigger and a per-item test id derived from each item's stable id
- [ ] 2.9 Use `mdiFolderCogOutline` for the trigger; do NOT use `mdiDotsHorizontal`, which `WorktreeActionsMenu` already renders on worktree session cards inside the folder body
- [ ] 2.10 Ensure an open menu survives or cleanly closes when its folder collapses or is drag-reordered — no orphaned popover

## 3. Collapse the header cluster

- [ ] 3.1 Replace the trailing cluster in `SessionList.renderGroup` with the single menu trigger
- [ ] 3.2 Move urgency sort into the directory group, preserving the per-folder persisted preference
- [ ] 3.3 Move pin/unpin into the directory group, keeping the label state-dependent
- [ ] 3.4 Move add-to-workspace into the workspace group, preserving `renderAddToWorkspaceButton`'s popover behaviour and the `add-to-workspace-btn-<cwd>` test id
- [ ] 3.5 Move remove-from-workspace into the workspace group; the `AddToWorkspaceMenu` popover keeps its own remove entry (accepted duplication)
- [ ] 3.6 Move the Directory Settings cog off `FolderActionBar` into the directory group
- [ ] 3.7 Rename `onOpenPiResources` to `onOpenDirectorySettings` through `FolderActionBar`, `SessionList` and `App.tsx` (`handleOpenPiResources` → `handleOpenDirectorySettings`); it already routes to `buildFolderSettingsUrl`, only the name is wrong
- [ ] 3.8 Hide `FolderActionBar` entirely when it holds no controls — with the cog gone, a configured folder with no pending init and no broken sessions leaves it empty
- [ ] 3.9 Delete the `mdiOpenInNew` button and the `folder-open-home-<cwd>` test id
- [ ] 3.10 Add a hover affordance to the folder leaf name so the row reads as a link
- [ ] 3.11 Keep `min-h-[44px] md:min-h-0` on the header row (WCAG 2.5.5)
- [ ] 3.12 Replace the pin toggle with a non-interactive `mdiPin` indicator shown only when the directory is pinned; it must not be focusable or activatable

## 4. Preserve placement gating

- [ ] 4.1 Add-to-workspace item renders only where the affordance renders today (top-level rows, gated on `onCreateWorkspace || workspaces.length`)
- [ ] 4.2 Remove-from-workspace item renders only for workspace-owned folders
- [ ] 4.3 Pin item renders only outside a workspace container, matching today's behaviour

## 5. Session card

- [ ] 5.1 Remove the `renderAddToWorkspace` prop and its render-prop plumbing from `SessionCard.tsx`
- [ ] 5.2 Remove the session-card call site and the `session:<id>` popover scope from `SessionList.tsx`

## 6. Icons

- [ ] 6.1 Verify `mdiFolderCogOutline` is unused before adopting it
- [ ] 6.2 Enumerate every glyph the rendered card shows (not the repo) and confirm none carries two meanings, accepting the two recorded echoes: trigger cog vs Directory Settings `mdiCog`, and header `mdiPin` indicator vs menu pin action
- [ ] 6.3 Confirm `mdiViewGridPlus` is used on the directory card only for add-to-workspace

## 7. Docs

- [ ] 7.1 Delegate `docs/` prose updates to DocScribe in caveman style and apply the returned tree rows
- [ ] 7.2 Update directory `AGENTS.md` rows for every added, changed and deleted file
- [ ] 7.3 Run `kb dox lint` and fix rows this change makes stale

## 8. Tests — L1 unit (folded from test-plan.md)

- [ ] 8.1 Cluster collapses to one control — top-level folder outside a workspace · header renders · cluster contains exactly 1 element and zero sort/pin/add-to-workspace/remove/settings test ids; extend `packages/client/src/components/__tests__/SessionList.test.tsx` (test-plan E1)
- [ ] 8.2 Top-level group contents — top-level folder with `workspaces.length > 0` · menu opens · workspace group has add-to-workspace, directory group has pin, urgency sort, directory settings, no remove item; see `SessionList.test.tsx` (test-plan E2)
- [ ] 8.3 Workspace-owned group contents — folder inside a workspace container · menu opens · workspace group has remove and NOT add-to-workspace, directory group has NO pin; see `SessionList.test.tsx` (test-plan E3)
- [ ] 8.4 Empty group omitted — `workspaces = []` with no create handler · menu opens · workspace group heading absent, directory group still rendered; see `SessionList.test.tsx` (test-plan E4)
- [ ] 8.5 Gating unchanged — `workspaces = []` with a create handler present · menu opens · add-to-workspace item present; see `SessionList.test.tsx` (test-plan E5)
- [ ] 8.6 Test id preserved — folder at cwd `/a/b` · menu opens · element with test id `add-to-workspace-btn-/a/b` exists inside the menu; see `SessionList.test.tsx` (test-plan E6)
- [ ] 8.7 Menus scoped per folder — two folder cards `/a` and `/b` · open `/a`'s menu · `/a` open and `/b` closed, opening `/b` closes `/a`; see `SessionList.test.tsx` (test-plan E7)
- [ ] 8.8 Empty action bar does not render — configured folder, `hasHook:false, configured:true`, 0 broken sessions · header renders expanded · no `FolderActionBar` node; extend `packages/client/src/components/__tests__/FolderActionBar.test.tsx` (test-plan E8)
- [ ] 8.9 Action bar keeps its own controls — folder with 2 broken sessions · header renders expanded · action bar renders `Clean up broken (2)` and no Directory Settings cog; see `FolderActionBar.test.tsx` (test-plan E9)
- [ ] 8.10 Pin from the menu — unpinned folder outside a workspace · activate the menu pin item · `onPinDirectory` called once with that cwd and the menu closes; see `SessionList.test.tsx` (test-plan E10)
- [ ] 8.11 Unpin from the menu — pinned folder outside a workspace · activate the menu pin item · `onUnpinDirectory` called once with that cwd; see `SessionList.test.tsx` (test-plan E11)
- [ ] 8.12 Pinned indicator is inert — pinned folder · header renders · non-interactive `mdiPin` indicator present, not a `button`, no tabindex; see `SessionList.test.tsx` (test-plan E12)
- [ ] 8.13 Unpinned renders no indicator — unpinned folder · header renders · no `mdiPin` indicator in the header; see `SessionList.test.tsx` (test-plan E13)
- [ ] 8.14 Accepted remove duplication behaves identically — folder inside a workspace · open the menu, then the AddToWorkspaceMenu popover · both expose a remove control and either calls `onRemoveFolderFromWorkspace` with identical args; see `SessionList.test.tsx` (test-plan E14)
- [ ] 8.15 Directory Settings item navigates — folder at cwd `/Users/u/proj` · activate the Directory Settings item · navigation to that directory's settings route with the `packages` page by default; see `SessionList.test.tsx` (test-plan E15)
- [ ] 8.16 Escape closes and restores focus — menu open with focus inside · press Escape · menu closes and focus returns to the trigger; see `packages/client/src/components/__tests__/MobileActionMenu.test.tsx` for menu-harness glue (test-plan X1)
- [ ] 8.17 Outside click closes — menu open · click outside · menu closes and no item handler fires; see `MobileActionMenu.test.tsx` (test-plan X2)
- [ ] 8.18 Trigger click does not propagate — trigger inside the navigating header row · activate the trigger · no navigation and no collapse toggle; see `SessionList.test.tsx` (test-plan X3)
- [ ] 8.19 Menu ARIA contract — menu closed then open · inspect the trigger · `aria-haspopup="menu"`, `aria-expanded` flips false to true, items expose `role="menuitem"`; see `MobileActionMenu.test.tsx` (test-plan X4)

## 9. Tests — L3 Playwright e2e (folded from test-plan.md)

- [ ] 9.1 Opening the menu neither navigates nor collapses — expanded folder · click the trigger · menu open, folder still expanded, route unchanged; see `tests/e2e/directory-home.spec.ts` for harness glue (test-plan F1)
- [ ] 9.2 Row click opens the home page — any directory row · click the header row outside the trigger · route becomes `/folder/<encodedCwd>`; see `tests/e2e/directory-home.spec.ts` (test-plan F2)
- [ ] 9.3 Row navigation does not collapse — expanded folder · click the header row · route changed and folder still expanded; see `tests/e2e/directory-home.spec.ts` (test-plan F3)
- [ ] 9.4 No dedicated open icon — pinned folder where the icon used to render · header renders · zero nodes with test id `folder-open-home-<cwd>`; see `tests/e2e/directory-home.spec.ts` (test-plan F4)
- [ ] 9.5 Narrow viewport presents a sheet — viewport 375×900 · open the menu · sheet form, full width, no horizontal overflow; see `tests/e2e/directory-home.spec.ts` (test-plan F5)
- [ ] 9.6 Short-but-wide viewport presents a sheet — viewport 1200×560 · open the menu · sheet form; see `tests/e2e/directory-home.spec.ts` (test-plan F6)
- [ ] 9.7 Desktop viewport presents a popover — viewport 1200×900 · open the menu · floating popover, not a sheet; see `tests/e2e/directory-home.spec.ts` (test-plan F7)
- [ ] 9.8 Cluster survives a narrow sidebar — folder with a long path, sidebar 220px · header renders · trigger on one line top-right, no wrap, parent path truncates before the leaf; see `tests/e2e/kb-folder-slot.spec.ts` (test-plan F8)
- [ ] 9.9 Folder and worktree triggers differ — folder containing a worktree session card · both rendered · the two triggers resolve to different glyph paths; see `tests/e2e/folder-membership-drag.spec.ts` (test-plan F9)
- [ ] 9.10 Session cards carry no add-to-workspace — folder with at least one session card · sidebar renders · zero `session-card-add-to-workspace-*` nodes on desktop and mobile; see `tests/e2e/folder-membership-drag.spec.ts` (test-plan F10)
- [ ] 9.11 Collapse while the menu is open — menu open on folder `/a` · `/a` collapses (e.g. spawn auto-collapse) · menu closes or stays anchored to a rendered trigger, no orphaned popover, no console error; see `tests/e2e/folder-membership-drag.spec.ts` (test-plan X5)
- [ ] 9.12 Drag-reorder while the menu is open — menu open on a folder · drag-reorder it in the sidebar · no orphaned popover at the old position, no console error; see `tests/e2e/folder-membership-drag.spec.ts` (test-plan X6)

## 10. Tests — regression migration (existing tests that assert the old behaviour)

- [ ] 10.1 Rewrite `SessionList.test.tsx:840-845`, which asserts the cluster is exactly `[folder-urgency-sort, add-to-workspace-btn, folder-open-home, unpin-dir-btn]` — inverted by task 8.1
- [ ] 10.2 Rewrite `SessionList.test.tsx:889-900`, which asserts `session-card-add-to-workspace-s1` exists — inverted by task 9.10
- [ ] 10.3 Migrate `SessionList.test.tsx:664-755`, which drives `folder-open-home`, to the header row
- [ ] 10.4 Migrate `tests/e2e/directory-home.spec.ts:27,66,80` to navigate via `folder-home-row-<cwd>`
- [ ] 10.5 Migrate `tests/e2e/folder-membership-drag.spec.ts:49,136,151,171,189,194` — open the menu before clicking `add-to-workspace-btn-<cwd>` and `ws-remove-`, and navigate via the header row
- [ ] 10.6 Migrate `tests/e2e/kb-folder-slot.spec.ts:26,65,85`, which anchors rows on `folder-urgency-sort-<cwd>`

## 11. Manual verification (deferred post-merge)

- [ ] 11.1 Folder name hover affordance reads as a link without looking clickable at rest (test-plan: manual-only)
- [ ] 11.2 Menu sheet item order and grouping are scannable one-handed on a real phone (test-plan: manual-only)

## 12. Verification

- [ ] 12.1 `npm test` green; pipe once to a tmp file and grep rather than re-running
- [ ] 12.2 `npm run quality:changed` clean
- [ ] 12.3 `openspec validate add-folder-actions-menu --strict` passes
- [ ] 12.4 Confirm no new design token was added
- [ ] 12.5 Confirm every automated test-plan.md row maps to exactly one task in sections 8-9 and every manual-only row to one task in section 11
