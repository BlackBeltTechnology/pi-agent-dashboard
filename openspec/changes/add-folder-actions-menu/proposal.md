## Why

The sidebar directory card's header row carries three unrelated jobs on one scan line —
identity (`📂 parent/leaf`), signal (`(723)`, `4 need you`), and mutation (sort · Workspace ·
open-in-new · pin · × remove). Four permanent buttons and two coloured elements compete for
one line, which dilutes the pre-attentive purple signal that attention-routing depends on.

Three specific defects:

1. **Scope error.** The `Workspace` pill acts on `session.cwd` — a property of the
   *directory* — yet renders once per **session card** (`SessionCard.renderAddToWorkspace`).
   A folder with 20 sessions renders 20 identical buttons producing one effect.
2. **Redundant navigation.** The header row click (`folder-home-row-<cwd>`) and the
   `mdiOpenInNew` button (`folder-open-home-<cwd>`) share one destination. The icon renders
   only on pinned/workspace rows — present where the gesture is already learned, absent on
   plain folders where it might teach it.
3. **No single home for mutations.** Sort, pin, add-to-workspace, remove-from-workspace and
   directory settings are scattered across two rows and a per-session card, so "where do I
   change this folder" has five answers.

This is the first of four sequenced changes that reorganize the directory card. It
establishes the menu that the later three depend on. Full design rationale and the live
mockup: `design.md`, `mockups/`.

## What Changes

- **New folder actions menu.** The header's trailing cluster becomes a single overflow
  trigger opening a grouped menu (workspace membership, then directory actions).
- **Collapse the cluster.** Urgency sort, pin/unpin, add-to-workspace, remove-from-workspace
  and directory settings all move into the menu. Row 1 goes from 4 permanent buttons to 1.
- **Delete `mdiOpenInNew`.** The header row already navigates; the folder leaf name gains a
  hover affordance so the row reads as a link.
- **Delete the session-card `Workspace` pill.** `SessionCard.renderAddToWorkspace` and the
  `session:<id>` popover scope are removed; the affordance lives only on the directory that
  owns the cwd.
- **Preserve placement gating.** The menu shows add-to-workspace only where the affordance
  renders today (top-level rows), remove-from-workspace only for workspace-owned folders, and
  pin only outside a workspace container. The menu does not silently widen availability.
- **Distinct trigger glyph.** `mdiDotsHorizontal` is rejected — `WorktreeActionsMenu` already
  renders it on worktree session cards *inside the folder body*, so two identical triggers
  with different scopes would share one card. The trigger uses `mdiFolderCogOutline`.
- **Mobile sheet.** Below the mobile breakpoint the menu presents as a full-width sheet, not
  a floating popover.

### Out of scope (sequenced follow-ups)

| Change | Scope |
|---|---|
| 2 · unify the folder status capsule | replaces the session count, needs-you pill and collapsed-only rollup with one severity-ordered capsule |
| 3 · directory call-to-action banner | promotes project setup, init hook, init progress/failure and broken-session cleanup to a full-width banner; makes project setup idempotent with a per-artifact tally |
| 4 · move slot actions into the menu | strips the ten slot-pill action buttons and replaces `SlotPill.actions?: ReactNode` with declarative menu contributions |

`FolderActionBar` is **not** deleted here — it still holds the init and cleanup controls until
change 3 empties it. Only the settings cog leaves it.

## Capabilities

### New Capabilities

- `folder-actions-menu`: a single grouped overflow menu that is the one home for every
  directory mutation on the card.

### Modified Capabilities

- `sidebar-folder-header`: the trailing cluster collapses to one control; the first content
  row carries the menu trigger instead of the pin button.
- `add-to-workspace-affordance`: the labelled pill becomes a grouped menu item on the folder
  card only; the session-card instance is removed.
- `folder-workspaces`: the add-to-workspace affordance is no longer required on both
  surfaces; the session-card surface is dropped.
- `pinned-directories-ui`: the pin toggle moves from a header icon into the menu.
- `directory-settings-page`: the entry-point cog moves from `FolderActionBar` into the menu.
- `directory-home-page`: the whole-row affordance becomes the only open gesture.

### Removed Capabilities

- `directory-home-page` → `Requirement: Sidebar open affordance`: superseded by
  `Requirement: Whole-row open affordance`, which already covers sidebar navigation to
  `/folder/:encodedCwd` without a dedicated icon.

## Discipline Skills

`scenario-design` (menu placement-gating matrix and the test-id migration),
`review-code` (multi-component client change before commit).

## Impact

- **Code**: `packages/client/src/components/session/SessionList.tsx` (cluster → menu,
  `renderAddToWorkspaceButton`, placement gating), `SessionCard.tsx` (drop
  `renderAddToWorkspace`), `packages/client/src/components/folder/FolderActionBar.tsx`
  (settings cog leaves; the bar survives this change).
- **Tokens**: none added.
- **Test ids**: `folder-open-home-<cwd>` and `session-card-add-to-workspace-<id>` are
  **deleted**. `add-to-workspace-btn-<cwd>`, `folder-urgency-sort-<cwd>`,
  `pin-dir-btn`/`unpin-dir-btn`, `ws-remove-<wsId>-<cwd>` and the settings cog move behind
  the menu. New: `folder-actions-menu-<cwd>` plus a per-item id derived from each item's
  stable contribution id.
- **Tests**: `tests/e2e/folder-membership-drag.spec.ts` (add-to-workspace at 151/171/194,
  `folder-open-home` at 49/136, `ws-remove-` at 189), `tests/e2e/directory-home.spec.ts`
  (navigates via `folder-open-home-<cwd>` throughout), `tests/e2e/kb-folder-slot.spec.ts`
  (anchors on `folder-urgency-sort-<cwd>`), `tests/e2e/helpers/index.ts`;
  `SessionList.test.tsx` (`:840-845` asserts the cluster is exactly the four buttons being
  collapsed — that assertion inverts; `:889-900` targets the deleted session-card control;
  `:664-755` targets `folder-open-home`).
- **A11y**: trigger carries `aria-haspopup="menu"` + `aria-expanded`; items carry
  `role="menuitem"`; the header row keeps `min-h-[44px] md:min-h-0` (WCAG 2.5.5); the mobile
  sheet returns focus to the trigger on dismissal.
- **Known pre-existing drift, not fixed here**: `pi-resources-view` still requires a "Pi
  Resources button" in the folder header, but `directory-settings-page` already replaced that
  control with the Directory Settings cog. That contradiction predates this change.
- **Risk**: medium. Moves five previously one-click actions behind a menu.
