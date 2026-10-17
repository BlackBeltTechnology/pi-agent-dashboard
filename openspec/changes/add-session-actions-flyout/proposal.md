## Why

Action buttons are the biggest space cost on the desktop session card:
- the Resume/Fork/+Session/+Worktree chips are 32 px tap targets that wrap to a second row in a narrow sidebar;
- the OpenSpec primary and its `⋯`, the worktree actions, and a `⋯` on every subcard legend;
- the flows buttons in the FLOWS subcard;
- the plugin action-bar footer.

A card that could fit in about five rows takes eight or more, so fewer sessions fit on screen.

The folder header already went through the same move (`add-folder-actions-menu`, `move-slot-actions-to-menu`): inline actions collapsed into one grouped menu. The session card is the remaining surface that has not.

## What Changes

- **New: session actions flyout.** It is one grouped menu that holds every session action on the desktop session card. Groups, in a fixed order, each omitted when empty:
  - **NEXT:** at most one emphasised primary, the OpenSpec next step or Merge (same `isMergePrimary` decision as today). When Merge wins, the OpenSpec primary stays in OPENSPEC without emphasis.
  - **SESSION**, **OPENSPEC**, **GIT**, **PLUGINS**, **VIEW**.
  - Rarely used items fold behind one inline `More…` expander per group, and only when there are at least 2 of them.
- **Four ways to open the same menu:**
  - a new header trigger (`mdiDotsVertical`);
  - a right-edge hover strip on the card (32 px wide, full card height), which opens after a dwell when the pointer is moving slowly;
  - right-click on the card, opening at the pointer (links, text inputs, selected text and drags keep the native menu);
  - Shift+F10 or the ContextMenu key while focus is inside the card.
- **Placement and layering.** The flyout opens beside the card, over the chat pane. It is portaled with `LayerPortal`, positioned `fixed`, uses the `z-popover` layer, and tracks the sidebar scroll. One actions menu is open at a time across session and folder scopes.
- **Desktop card condensed to state only.**
  - Removed: Resume/Fork/+Session/+Worktree chips; the OpenSpec primary button and its `⋯` (including the archived / missing Detach `⋯`); the unattached attach combo, + Change, Propose, Explore and Bulk Archive (an unattached READY session shows no OPENSPEC subcard); the `WorktreeActionsMenu` row; every subcard legend `⋯`; the header Rename button (double-click rename stays); the action-bar footer; the FLOWS subcard's action buttons.
  - Kept inline: Archive and Exit in the header, next to the new trigger. Also kept: controls that act on one running thing (PROCESS row stop/kill/expand, `ProcessSafetyChip`, the running-flow abort) and the disabled-OPENSPEC remediation control.
  - Kept as clickable status: the P·D·S·T·A lifecycle bar, the change link, the archived / missing letters and badges, the branch, dirty and PR pills, and plugin status pills. The flyout also lists each status action.
- **Plugins, with no new API.**
  - `session-card-action-bar` claims stay mounted for the card's lifetime, so their effects and the dialogs they own survive. Their output shows only in the PLUGINS group.
  - Intent action lists render as real menu items; React claims render as a labelled group.
  - **flows-plugin** moves Run Flow… / Open flow… / New / Edit… / Delete from its FLOWS-subcard claim to an action-bar claim, along with the edit-mode reconcile. The FLOWS subcard keeps flow status only and shows only when there is flow activity.
- **Fix: `client-utils` `Popover` layering.** It portals straight to `body` at inline `zIndex: 1000`, above dialog, toast and lightbox. It moves to `LayerPortal` + `var(--z-popover)`, and `scripts/z-layer-lint.mjs` additionally flags inline numeric `zIndex`, without growing the baseline.
- **Spec alignment.**
  - `sleek-card-design`'s footer action-row requirements are removed; they already contradicted shipped code.
  - `overlay-layering` records the dialog layer host that `LayerPortal` already implements.
  - The +Session spec now matches the code: Fork shows for any session with a `sessionFile`.
- Unchanged: the mobile session card, the composer strip, and the per-session OpenSpec panel on board cards keep their current controls.
- Out of scope (follow-up change): controls inside other plugin-owned sections stay on the card — the MEMORY "Details" button, KB re-index on worktree cards, and the browser-relay badge popover.
- Mockup: mockups/session-card-hover-flyout (in this change)

## Capabilities

### New Capabilities
- `session-actions-menu`: the flyout. Covers its trigger set (`⋯`, hover strip, right-click, keyboard), the group taxonomy, the NEXT rule, `More…` folding, availability parity, mirrored status, placement and layering, hover intent, keyboard and dismissal, and plugin hosting.

### Modified Capabilities
- `session-card-subcards`: the six-subcards layout loses the header Fork, the footer slot and the GIT worktree-actions row. +Session, +Worktree and the cwd-missing Resume gate become menu items. READY + unattached renders no OPENSPEC subcard. A new requirement defines the controls the card keeps.
- `openspec-attach-combo`: on the desktop session card, the attached-session primary and `⋯`, the archived / missing Detach `⋯`, the unattached combo, + Change, Explore and Bulk Archive render in the flyout. Inline-block surfaces are unchanged.
- `openspec-card-section`: board session rows keep the primary + `⋯` block, decoupled from the session card.
- `worktree-lifecycle`: on the desktop card, `WorktreeActionsMenu` items render in the flyout. Card scenarios move to NEXT / menu wording.
- `session-card-section-visibility`: the legend menu is replaced by VIEW `Card sections…` (group folder) and `Card section defaults…` (global). The `spawn` and `actionbar-<pluginId>` ids gate menu items.
- `overlay-layering`: shared portaled primitives use the layer portal and the popover token; the ratchet flags inline `zIndex`; the dialog layer host is recorded in the portal requirement.
- `dashboard-shell-slots`: flow actions render via `session-card-action-bar`, and the FLOWS subcard carries flow status.
- `flow-pre-run-attach`: Open flow… moves from the FLOWS subcard to the session actions menu.
- `flows-plugin`: separate gates for menu flow actions and for the FLOWS status subcard; the edit-mode reconcile moves to the action-bar claim.
- `sleek-card-design`: removes "Session card action row with divider" and "Source badge in action row".
- `chat-view`: the composer ↔ card parity wording now references the session actions menu.

## Impact

- **Client:**
  - `packages/client/src/components/session/SessionCard.tsx` (desktop branch);
  - new `components/session/SessionActionsMenu.tsx` and `lib/session/session-menu-items.ts`;
  - `SessionList.tsx` (shared folder/session open state);
  - `openspec/SessionOpenSpecActions.tsx`, `worktree/WorktreeActionsMenu.tsx` and `session/SubcardLegendMenu.tsx`, which expose item derivers.
- **Plugins:** `flows-plugin` (new action-bar claim, a slimmer FLOWS claim, manifest and predicates). `goal-plugin` is unchanged; `GoalControl` renders in the menu.
- **Shared UI:** `packages/client-utils/src/Popover.tsx` (`LayerPortal` + token); its `ui:popover` consumers include `automation-plugin` and `team-app`. `client-utils/ActionList` gains a menu context. Also `scripts/z-layer-lint.mjs` and its tests.
- **Tests:** `session-card-spawn-sibling` and `session-card-spawn-worktree` move onto menu items. Card and flows tests that query inline controls need updating.
- **Server, protocol, persistence:** none. No migration. Rollback means reverting the client and plugin commit; persisted card-section config keeps the same ids.

## Discipline Skills

- `doubt-driven-review`: removing visible primaries from the card is hard to walk back once users adapt. Stress-test before tasks freeze.
- `performance-optimization`: the hover-intent pointer tracking runs across every card. It must stay off the render path, using no React state per `pointermove`.
- `review-code`: a large client change with an a11y-sensitive menu.
