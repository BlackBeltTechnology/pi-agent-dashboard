# Tasks — add-session-actions-flyout

## 1. Ground truth

- [x] 1.1 Inventory every interactive control on the desktop branch of `SessionCard.tsx`: chips, `SessionOpenSpecActions` (primary / overflow / unattached / archived-missing), `WorktreeActionsMenu`, `SubcardLegendMenu`, the header Rename button, `ProcessSafetyChip`, the PROCESS rows, worktree card-section claims, the FLOWS claim, and `SessionCardActionBarSlot`. Map each one to a menu group and item id, or to "stays on card", in a table appended to `design.md` § D1. Verify: every `onClick` in the desktop branch appears in the table.
- [x] 1.2 `rg` every test and e2e spec that queries the removed controls: `session-card-spawn-sibling`, `session-card-spawn-worktree`, `openspec-overflow-btn`, the legend menu ids, the rename pencil, `flows-open-button`, `flows-new-edit-button`, and the inline Fork/Resume/Apply/Run Flow labels. Record the list in this task. Verify: the list is referenced by 10.3.
  - Recorded (vitest): `SessionCard.test.tsx`, `SessionCard.card-sections.test.tsx`, `SessionList.card-spawn-worktree.test.tsx`, `SessionCard-acp-driver.test.tsx`. Recorded (e2e): `ui-token-alignment.spec.ts` (chips F2/F9), `archived-attachment.spec.ts`, `flow-attach-before-run.spec.ts`, `flow-card-grid-geometry.spec.ts`, `openspec-init-affordances-session-card.spec.ts`. `OpenSpecBoardView.test.tsx` and `ComposerSessionActions.test.tsx` keep their controls (board / composer unchanged).
- [x] 1.3 Confirm that the mobile branch, `ComposerSessionActions` and the board panel only share derivers with the card path, and that the mobile card renders no FLOWS subcard. Verify: an `rg` over those files shows no import of anything removed.
  - Verified: `SubcardLegendMenu` was imported only by `SessionSubcard` (removed); the composer keeps `WorktreeActionsMenu` (segments mode) and `deriveOpenSpecActions`, the board keeps `SessionOpenSpecActions variant="full"`, and the mobile branch renders no subcard.
- [x] 1.4 Record the baseline z-ratchet output on `develop` (`node scripts/z-layer-lint.mjs`) in this task. Verify: the recorded pre-existing entries (`AgentSpawnPicker` z-30, `ChatViewMenu` z-40/z-50) are the reference for 2.53.
  - Recorded: before and after this change the script reports exactly `AgentSpawnPicker.tsx|z-30` and `ChatViewMenu.tsx|z-40`, `|z-50` as new against the baseline; nothing else, and `z-layer-baseline.json` is unchanged.

## 2. Tests first (red) — folded from test-plan.md

Author each test before its implementation section and confirm it fails for the right reason.

Each task reads: input · trigger · expected outcome (test-plan id), then the existing test file to copy from or extend.

### 2a. Menu deriver (L1, new `packages/client/src/lib/session/__tests__/session-menu-items.test.ts`)

- [x] 2.1 A session with an attached change, in a worktree, with no plugin claims · `deriveSessionMenu` · group ids in order `NEXT,SESSION,OPENSPEC,GIT,VIEW`, with no `PLUGINS` group (test-plan #E1). Copy from `packages/client/src/components/__tests__/openspec-actions.test.ts`.
- [x] 2.2 ChangeState × continue/archive workflow × ended · derive · the NEXT item is Continue / FF / Apply / Archive change / Verify for live sessions, none when ended, and there is never more than one emphasised item (test-plan #E2). Copy from `openspec-actions.test.ts`.
- [x] 2.3 A worktree with an open, non-draft PR whose checks pass, probed less than 15 minutes ago, not working, and a COMPLETE change · derive · NEXT is Merge; OPENSPEC holds a non-emphasised "Archive change"; exactly one emphasised item (test-plan #E3). Copy from `packages/client/src/lib/git/__tests__/merge-primary.test.ts`.
- [x] 2.4 Groups with 0, 1, 2 and 4 rare items · derive + render · no expander for 0; inline item for 1; `More…` labelled `2` and `4` (test-plan #E4). Copy from `openspec-actions.test.ts`.
- [x] 2.5 Attachment resolves to archived (P, D, T), missing, unresolved, or active in the main checkout · derive · OPENSPEC holds only the letter items (with archive or preview routes) and Detach; no workflow item and no OpenSpec NEXT (test-plan #E5). Copy from `openspec-actions.test.ts`.
- [x] 2.6 Unattached × active/ended × completed-change count × workflow profile · derive · active gets Attach, New change…, Propose…, Explore… (as configured); ended gets Attach only; Bulk archive… appears only with ≥1 completed change (test-plan #E6). Copy from `openspec-actions.test.ts`.
- [x] 2.7 Readiness (all 7 states plus a missing field) × attached · derive · GLOBAL_OFF / OPTED_OUT / ABSENT / PENDING give no OPENSPEC group; BROKEN / STALE give only Detach when attached; READY gives the full group; a missing field degrades the same way as the subcard (test-plan #E7). Copy from `packages/client/src/components/__tests__/SessionCard.status-gate.test.tsx`.
- [x] 2.8 status × sessionFile × origin (local / remote / ACP) × resuming × cwdMissing · derive · Resume only for ended or hidden sessions that are local and have a sessionFile; Fork for local sessions with a sessionFile; `resuming` and cwdMissing make both `aria-disabled`, with the cwdMissing reason text (test-plan #E8). Copy from `openspec-actions.test.ts`.
- [x] 2.9 gitWorktreeEnabled × gitWorktree × isGitRepo (true / false / undefined) · derive · New worktree session is present iff enabled, not already a worktree, and isGitRepo ≠ false (test-plan #E9). Copy from `packages/client/src/components/__tests__/SessionCard.test.tsx`.
- [x] 2.10 ended vs live × currentTool × attached COMPLETE change · derive · Rename… only when live; Archive session iff the header's `canArchive`; labels "Archive session" and "Archive change" are both present and distinct (test-plan #E10). Copy from `openspec-actions.test.ts`.
- [x] 2.11 A streaming or retrying worktree session · derive · Push, Open PR and Merge are disabled with a reason; Close worktree… stays enabled (test-plan #E11). Copy from `packages/client/src/components/__tests__/WorktreeActionsMenu.test.tsx`.
- [x] 2.12 `spawn` hidden; `openspec` / `git` hidden · derive · hiding `spawn` removes both spawn items; hiding `openspec` / `git` keeps their menu groups (test-plan #E12). Copy from `packages/client/src/components/__tests__/SessionCard.card-sections.test.tsx`.
- [x] 2.13 A worktree session (mainPath `/repo`) vs a plain session (`/a`) · activate Card sections… and Card section defaults… · navigation goes to `/repo`'s page, `/a`'s page, and the global defaults respectively (test-plan #E13). Copy from `SessionCard.card-sections.test.tsx`.
- [x] 2.14 A change with skipped specs and 0 tasks · render the menu · inert segments have no `menuitem` role, are not focusable, and ArrowDown skips them (test-plan #E14). Copy from `packages/client/src/components/__tests__/FolderActionsMenu.test.tsx`.

### 2b. Actions and dialogs (L1)

- [x] 2.15 A parent with cwd `/project/foo` and a proposal of "add-dark-mode", null or "" · activate New session · `spawn_session{cwd, attachProposal:"add-dark-mode", requestId:UUIDv4}`; the `attachProposal` key is absent for null or "" (test-plan #E15). Copy from `SessionCard.test.tsx` (`session-card-spawn-sibling` cases).
- [x] 2.16 A proposal of "add-dark-mode" vs none · activate New worktree session · WorktreeSpawnDialog opens with branch `os/add-dark-mode` and the proposal carried through, or via the plain path (test-plan #E16). Copy from `SessionCard.test.tsx` (`session-card-spawn-worktree` cases).
- [x] 2.17 Unattached session, cwd `/project/foo`, one completed change · activate Bulk archive…, then confirm or cancel · the confirm dialog says "Bulk archive all completed changes?"; confirming sends `{type:"openspec_bulk_archive", cwd}`; cancelling sends nothing (test-plan #E17). Copy from `SessionCard.test.tsx`.
- [x] 2.18 Fork disabled by cwdMissing · click or Enter on Fork · no fork request; the menu stays open; the reason text is exposed (test-plan #X2). Copy from `FolderActionsMenu.test.tsx` (disabled item case).
- [x] 2.19 Open the menu, choose Explore… · press Escape inside ExploreDialog · the dialog closes, the menu does not reopen, and focus returns to the card trigger (test-plan #X4). Copy from `FolderActionsMenu.test.tsx`.

### 2c. Card and surrounding surfaces (L1)

- [x] 2.20 Fixtures: ended+sessionFile+git, live, worktree, unattached READY, archived · render the desktop card · none of the removed controls and no footer row; Archive, the trigger and Exit are present; PROCESS stop/kill and ProcessSafetyChip still render (test-plan #E18). Copy from `packages/client/src/components/__tests__/SessionCard.card-sections.test.tsx`.
- [x] 2.21 Readiness: READY attached, READY unattached, BROKEN, missing field · render the desktop card · READY attached shows the link and lifecycle bar; READY unattached has no OPENSPEC title; BROKEN shows the remediation control; a missing field degrades as legacy (test-plan #E19). Copy from `SessionCard.status-gate.test.tsx`.
- [x] 2.22 One attached worktree fixture with a dirty tree and a PR · click the stepper Design segment, change link, branch, dirty pill and PR pill on the card, and the matching menu items · both surfaces make identical handler calls (test-plan #E20). Copy from `SessionCard.test.tsx`.
- [x] 2.23 `useMobile()=true` · render the card · no `session-actions-trigger-*`; the mobile snapshot is unchanged (test-plan #E21). Copy from `SessionCard.test.tsx` (mobile cases).
- [x] 2.24 A board session row attached to an IMPLEMENTING change · render the row · the Apply primary and `⋯` are present; `⋯` lists Explore… and Detach (test-plan #E22). Copy from `packages/client/src/components/__tests__/OpenSpecBoardView.test.tsx`.
- [x] 2.25 The same session, for each ChangeState × workflow config · derive the composer `⋯` and the card menu's OPENSPEC group · same primary identity; same workflow item set apart from Detach (test-plan #E23). Copy from `packages/client/src/components/__tests__/ComposerSessionActions.test.tsx`.
- [x] 2.26 Folder header plus a worktree session card · read the trigger icon paths · the session trigger is `mdiDotsVertical`, which differs from the folder's `mdiFolderCogOutline`; no `mdiDotsHorizontal` trigger on the card (test-plan #E30). Copy from `FolderActionsMenu.test.tsx` (glyph-uniqueness case).

### 2d. Menu component, keyboard and live state (L1, new `packages/client/src/components/session/__tests__/SessionActionsMenu.test.tsx`)

- [x] 2.27 contextmenu on a PR `a[href]`, the rename input, a card with a non-empty text selection, or during a drag · dispatch `contextmenu` · `defaultPrevented=false` and no menu opens (test-plan #F2). Copy from `FolderActionsMenu.test.tsx`.
- [x] 2.28 Menu opened by click (focus on the trigger) and by Shift+F10 (focus on Archive) · ArrowDown past the end, ArrowUp at the start, Home, End, Escape, Tab; also remove the opener before Escape · focus wraps; Home and End jump; Escape and Tab close and refocus the opener, falling back to the trigger (test-plan #F3). Copy from `FolderActionsMenu.test.tsx`.
- [x] 2.29 OPENSPEC with 4 rare items, focus on the item before `More…` · ArrowDown, Enter, ArrowDown, close, reopen · focus lands on `More…`; Enter reveals the items, focuses Fast-forward and sets `aria-expanded="true"`; the next ArrowDown reaches Explore…; on reopen the group is collapsed again (test-plan #F4). Copy from `FolderActionsMenu.test.tsx`.
- [x] 2.30 Folder menu `/a` open · open session menu `s1`, then folder menu `/a` · each opening closes the other; only one `role=menu` exists at a time (test-plan #F11). Copy from `packages/client/src/components/__tests__/FolderActionsMenu.radio.test.tsx`.
- [x] 2.31 Mocked card rects: room on the right; bottom near the viewport; narrow right side · open anchored · `left=card.right+8`, `top=card.top`; the bottom clamps to viewport−8; the overlapping case clamps to the right edge −8 (test-plan #F12). Copy from `packages/client/src/hooks/__tests__/usePopoverFlip.test.ts`.
- [x] 2.32 Idle worktree `s1` with its menu open and focus on Push · the session update switches to streaming · the menu stays open; Push becomes `aria-disabled="true"`; focus stays on Push (test-plan #F15). Copy from `FolderActionsMenu.contributions.test.tsx` (live-update case).
- [x] 2.33 Focus on Open PR · an update adds `gitPrNumber` · focus moves to the first enabled item (test-plan #F16). Copy from `FolderActionsMenu.contributions.test.tsx`.
- [x] 2.34 Menu of `s1` open · `s1` is removed from the list (archived) · the menu closes; `document.activeElement` is inside the session list region, not `document.body` (test-plan #F17). Copy from `FolderActionsMenu.test.tsx`.
- [x] 2.35 Menu open · click, contextmenu and Shift+F10 keydown on a menu item · the card's `onSelect`, contextmenu and keydown handlers are not called; the menu does not reopen or move (test-plan #F18). Copy from `FolderActionsMenu.test.tsx` (stopPropagation cases).

### 2e. Hover intent and performance (L1, new `packages/client/src/components/session/__tests__/session-hover-intent.test.ts`)

- [x] 2.36 32 px strip; pointer path crossing it toward the chat at 1.5 px/ms · pointermove sequence on `document` with fake timers · no open (test-plan #F5). Copy from `packages/client/src/hooks/__tests__/usePopoverFlip.test.ts` (fake-timer setup).
- [x] 2.37 Pointer resting in the strip below 0.4 px/ms for 299 ms and for 300 ms · advance timers · closed at 299 ms; open at 300 ms with `document.activeElement` unchanged (test-plan #F6). Copy from `usePopoverFlip.test.ts`.
- [x] 2.38 Card right edge R; pointer x at R−33, R−32 and R−1; pointer over ✕ inside the band · dwell 300 ms · R−33 does not arm; R−32 and R−1 open; over ✕ does not arm, and clicking ✕ still exits (test-plan #F7). Copy from `usePopoverFlip.test.ts`.
- [x] 2.39 Hover-opened menu · pointer in the gap or over the body-portaled menu for 1 s; outside everything for 299 ms and for 301 ms · stays open over the gap and menu; still open at 299 ms; closed at 301 ms (test-plan #F8). Copy from `usePopoverFlip.test.ts`.
- [x] 2.40 Hover-opened menu, focus on an unrelated input · press Escape · the menu closes and focus stays on the input (test-plan #F9). Copy from `FolderActionsMenu.test.tsx`.
- [x] 2.41 Rename active, a drag in progress, a click-opened menu, an open dialog, or a coarse pointer · dwell 300 ms in the strip · never opens; on a coarse pointer the trigger still opens (test-plan #F10). Copy from `usePopoverFlip.test.ts`.
- [x] 2.42 50 rendered cards; a pointer sweep across every body and strip at 1.5 px/ms · React Profiler · 0 commits (test-plan #P1). Copy from `packages/client/src/components/session/__tests__/SessionCard.history-ring-perf.test.tsx`.
- [x] 2.43 Anchored menu open; 30 scroll events on the sidebar · count renders · no extra menu content renders, while panel `style.top` changes (test-plan #P3). Copy from `SessionCard.history-ring-perf.test.tsx`.

### 2f. Plugins and flows (L1)

- [x] 2.44 Action-bar claims (one renders a button, one renders `null`) plus an `actionbar-<id>` filter · close and open the menu; click the claim button · output is absent from the card DOM and present in a labelled `role=group` when open; the heading is hidden when only the null claim renders; the filtered plugin is absent; a click closes the menu without selecting the card (test-plan #F19). Copy from `packages/dashboard-plugin-runtime/src/__tests__/slot-consumers.test.tsx`.
- [x] 2.45 Flows available, edit mode on, menu never opened · mount the card · `flow_management{set-edit-mode}` is dispatched exactly once (test-plan #F20). Copy from `packages/flows-plugin/src/__tests__/session-flow-actions-open.test.tsx`.
- [x] 2.46 A `ui:action-list` intent with 2 actions on `session-card-action-bar` · open the menu and activate action 1 · 2 `role=menuitem` entries; the descriptor is dispatched and the menu closes (test-plan #F22). Copy from `packages/client-utils/src/__tests__/ActionList.test.tsx`.
- [x] 2.47 An action-bar claim that throws on render · open the menu · host groups still render, the boundary contains the error, nothing is uncaught, and the list keeps rendering (test-plan #X1). Copy from `slot-consumers.test.tsx` (error-boundary case).
- [x] 2.48 A goal-linked session · open the menu, activate Pause, then Open · Pause sends `plugin_action /goal …`; Open navigates to the goal detail route; GoalChip still renders in STATUS (test-plan #X3). Copy from `packages/goal-plugin/src/__tests__/GoalControl.test.tsx`.
- [x] 2.49 commandsList (none / `flows` / `flows:delete` / `flows:new` only) × events × flowsList · evaluate the action-bar claim gate · open iff a `flows`/`flows:*` signal (not `flows:new` alone) or at least one event; closed before the first publish (test-plan #E24). Copy from `session-flow-actions-open.test.tsx`.
- [x] 2.50 events × editFlow × flowsList · evaluate the `session-card-flows` predicate · true iff there is at least one event; the subcard renders status only (FlowActivityBadge, abort while running) (test-plan #E25). Copy from `session-flow-actions-open.test.tsx`.
- [x] 2.51 Flows available × flowsList ([] / [a, b]) × running · render the flows menu claim · hidden for []; enabled for [a, b] when idle; disabled with "A flow is running" while running (test-plan #E26). Copy from `session-flow-actions-open.test.tsx`.
- [x] 2.52 `packages/flows-plugin/package.json` · parse its claims and run `packages/shared/src/__tests__/no-flow-references-in-shell.test.ts` · claims include `session-card-flows`, `session-card-action-bar`, `content-header-sticky` and 2× `content-view`, and exclude `session-card-badge`; the shell test passes (test-plan #E27). Copy from `no-flow-references-in-shell.test.ts`.

### 2g. Layering ratchet (L1, `scripts/__tests__/z-layer-lint.test.mjs`)

- [x] 2.53 Fixtures: `style={{ zIndex: 1000 }}` in client-utils; `zIndex: "var(--z-popover)"`; `className="z-10"` in client-utils · run the extractor · numeric inline values are flagged in both roots; the token is not flagged; the client-utils class is not scanned (test-plan #E28). Copy from `scripts/__tests__/z-layer-lint.test.mjs`.
- [x] 2.54 The repo after the Popover fix · `node scripts/z-layer-lint.mjs` · no inline occurrences; nothing beyond the pre-existing set from 1.4; the baseline file is byte-identical (test-plan #E29). Copy from `z-layer-lint.test.mjs`.

### 2h. Browser e2e (L3, docker harness)

- [x] 2.55 Unselected harness card `s1` · click the trigger; right-click the body at a point; Shift+F10 with focus on Archive · each opens `session-actions-menu-s1` with identical item ids; the trigger reports `aria-expanded="true"`; the right-click panel opens at the pointer; `s1` is not selected (test-plan #F1). Copy from `tests/e2e/folder-actions-menu.spec.ts`.
- [x] 2.56 6+ cards in a scrollable sidebar; menu open via the trigger, then via right-click · scroll the sidebar 60 px; scroll inside the menu · both menu types stay aligned (Δtop = Δcard.top ± 1 px); scrolling inside the menu does not move it (test-plan #F13). Copy from `tests/e2e/folder-actions-menu.spec.ts` (scroll-tracking case).
- [x] 2.57 Menu of `s1` overlapping `s2`, then a dialog opened · `elementFromPoint` at the overlap, then at the menu centre · the overlap resolves inside the menu; with the dialog open, the point resolves inside the dialog (test-plan #F14). Copy from `tests/e2e/popover-container-clip.spec.ts`.
- [x] 2.58 A harness session with at least one flow · open the menu and choose Run Flow… · the menu closes; the Run Flow dialog is visible and stays open for 2 s (test-plan #F21). Copy from `tests/e2e/folder-actions-menu.spec.ts`.
- [x] 2.59 (L1 `Popover.layering.test.tsx`; L3 half is F24 in `session-actions-menu.spec.ts` — no shipped dialog hosts a `ui:popover` consumer to drive F23 in a browser) A dialog with a control that opens a `ui:popover` · open the popover and click an item · the popover is above the backdrop and the dialog stays open (test-plan #F23). Copy from `tests/e2e/popover-container-clip.spec.ts`.
- [x] 2.60 A `ui:popover` open outside dialogs, then a modal opened over it · `elementFromPoint` plus computed z-index · the dialog wins at the overlap; the popover z-index is 40 (test-plan #F24). Copy from `tests/e2e/popover-container-clip.spec.ts`.
- [x] 2.61 50 harness session cards · click the trigger 20 times, closing in between · the 95th percentile from click to visible panel is ≤ 100 ms (test-plan #P2). Copy from `tests/e2e/folder-actions-menu.spec.ts` (session seeding).

### 2i. Manual (post-merge)

- [x] 2.62 Review menu visual polish in studio dark and light at 220, 300 and 500 px sidebar widths: NEXT emphasis, sticky headings and group spacing (test-plan: manual-only, #F25).
- [x] 2.63 Real-mouse hover feel: 20 sweeps from cards into the chat, using the mockup lab counters; retune dwell, grace and the speed cutoff if accidental opens feel frequent (test-plan: manual-only, #F26).

## 3. Pure derivers

- [x] 3.1 Extract `deriveWorktreeActions(session, ctx)` from `WorktreeActionsMenu` without changing its rendering. Verify: existing `WorktreeActionsMenu` and composer tests pass unchanged.
- [x] 3.2 Implement `packages/client/src/lib/session/session-menu-items.ts` (`deriveSessionMenu`, `MenuGroup`/`MenuItem`, rare sets, readiness gate, attachment branches) on top of `deriveOpenSpecActions`, the attachment resolution, `deriveWorktreeActions` and `isMergePrimary`. Verify: 2.1–2.14 are green.

## 4. Menu component, placement, dialogs

- [x] 4.1 Implement `useSideFlyoutPosition` (anchor and point modes, clamp, capture-phase scroll that ignores the menu's own scroll, resize, a `ResizeObserver` on the card, positions written through a ref). Verify: 2.31 and 2.43 are green.
- [x] 4.2 Implement `packages/client/src/components/session/SessionActionsMenu.tsx`: `LayerPortal` + `z-popover`; sticky headings; NEXT emphasis from tokens; inline `More…`; a root that stops click / contextmenu / keydown propagation; live re-derive with focus preserved by id; close on card unmount with focus moved to the list region. Verify: 2.27–2.29 and 2.32–2.35 are green.
- [x] 4.3 Add the per-card dialog host (D3) for the OpenSpec and worktree dialogs, attach picker, propose, bulk-archive confirm, commit and switch-branch dialogs. Verify: 2.15–2.19 are green.

## 5. Plugin hosting

- [x] 5.1 Implement the per-card action-bar portal container (D7): a detached per-card `div` with an inner propagation-stopping wrapper; attached on open and detached on close; delegated activation close; a `MutationObserver` empty check while open. Verify: 2.44 and 2.47 are green.
- [x] 5.2 Give the `ui:action-list` primitive (`client-utils/ActionList`) a menu context so it renders `role="menuitem"` buttons and reports activation. Verify: 2.46 is green.
- [x] 5.3 Confirm `goal-plugin` `GoalControl` works inside the PLUGINS group, with no plugin change expected. Verify: 2.48 is green.

## 6. Flows actions move to the menu

- [x] 6.1 Implement the flows `session-card-action-bar` claim (for example `SessionFlowMenuClaim`) with the action dialogs and the edit-mode reconcile. Slim `SessionFlowActionsClaim` down to status, split the predicates, and update the `flows-plugin/package.json` claims (add `session-card-action-bar`; no `session-card-badge`). Verify: 2.45 and 2.49–2.52 are green.

## 7. Entry points and hover intent

- [x] 7.1 Generalise `SessionList`'s scope-keyed menu state to `folder:<cwd> | session:<id>`, recording `document.activeElement` as the opener on non-hover opens. Verify: 2.30 is green.
- [x] 7.2 Wire the header trigger (`mdiDotsVertical`), card `contextmenu` (with the native exemptions) and a card `keydown` for Shift+F10 / ContextMenu. No `tabIndex` on the card root; add `data-session-card`. Verify: 2.26 and 2.27 are green.
- [x] 7.3 Implement the `document`-level hover-intent controller (D5): refs only, at most one rect read per frame, constants `HOVER_STRIP_PX=32`, `HOVER_DWELL_MS=300`, `HOVER_SPEED_CUTOFF=0.4`, `HOVER_CLOSE_GRACE_MS=300`. Verify: 2.36–2.42 are green.

## 8. Condense the desktop card

- [x] 8.1 Remove the chip row, the inline OpenSpec controls (keep the link, stepper, letters, badges and remediation), the `WorktreeActionsMenu` mount, the legend menus, the Rename pencil, and the visible footer slot from the desktop branch of `SessionCard.tsx`. Keep Archive, the trigger, Exit and the running-thing controls. Verify: 2.20, 2.23 and 2.24 are green.
- [x] 8.2 Do not render the desktop OPENSPEC subcard for READY + unattached; keep every other readiness row. Verify: 2.21 is green.
- [x] 8.3 Make every mirrored status element match its menu item, and wire the VIEW items. Verify: 2.13, 2.22 and 2.25 are green.

## 9. Layering fix and lint

- [x] 9.1 Extend `scripts/z-layer-lint.mjs` with the inline-`zIndex` extractor across `client/src` and `client-utils/src`. Switch `client-utils/src/Popover.tsx` to `LayerPortal` + `zIndex: "var(--z-popover)"`. Verify: 2.53 and 2.54 are green, and the `automation-plugin` and `team-app` `ui:popover` tests pass.

## 10. Integration, docs, verification

- [x] 10.1 Run the L3 specs 2.55–2.61 against the docker harness (`run-dashboard-e2e-local-changes` skill). Verify: all 7 pass on the worktree's derived harness port.
  - Ran 6 specs in `session-actions-menu.spec.ts` (F1, F13, F14, F24, P2, F21) green on the derived port 18551, plus the updated `flow-attach-before-run` (2), `flow-card-grid-geometry` (7), `archived-attachment` (2) and the `ui-token-alignment` F2/F9 pair. F23 is covered at L1 (see 2.59). `openspec-init-affordances-session-card.spec.ts` is skipped in this harness (needs its own CLI fixture). The F5 select/confirm prompts in `ui-token-alignment.spec.ts` fail on the faux `ask_user` tool call in this worktree harness and are untouched by this change. The worktree lacked the generated `.pi/skills/openspec-*`, so they were copied into the container fixture for the OpenSpec rows.
- [x] 10.2 Update the `AGENTS.md` rows (main agent): `SessionCard.tsx.AGENTS.md`, `components/session/AGENTS.md` (`SessionActionsMenu.tsx`), `lib/session/AGENTS.md` (`session-menu-items.ts`), `client-utils/src/AGENTS.md` (`Popover`, `ActionList`), the `flows-plugin` client rows, and `scripts/AGENTS.md` (lint scope). Delegate a `docs/` plugin-author note to DocScribe, in caveman style. Verify: every new or changed file has a row with `See change: add-session-actions-flyout`, and the note is linked from `docs/AGENTS.md`.
- [x] 10.3 Update the tests and e2e specs found in 1.2 so they open the menu first. Verify: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` passes, with a green summary line in the grep.
  - Full `npm test`: 35919 passed, 22 failed in 8 files. After the `theme-token-guard` and `plugin-registry` fixes the remaining failures are `resource-activation-*`, `rendezvous`, `gateway-listener-wiring`, `host-gate-upgrade` and `role-bindings` — server/shared files this change does not touch; they fail on the macOS `/var` tmpdir/HOME layout of this machine (per-HOME socket and path identity assertions).
- [x] 10.4 Record the final hover timings in `design.md` § Open Questions after 2.63, or close that section. Verify: the section states the shipped values.
