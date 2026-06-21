## Why

The sidebar **Automations** row (added by `add-automation-plugin`) does not match the **OPENSPEC** row beside it, and its link is dead:

1. **Design mismatch.** `FolderAutomationSection` renders one full-width `text-[11px]` button with its own border/weight, while the sibling `FolderOpenSpecSection` renders a compact 10px-uppercase header (title + count + `→`), a refresh icon, and right-aligned action chips (Archive / Specs). The two rows sit one above the other in the folder card and look unrelated.

2. **Dead navigation.** The automation board is claimed via the **`command-route`** slot (`/automation`). That slot's only consumer, `CommandRouteSlot`, is defined in `dashboard-plugin-runtime` but **never mounted** anywhere in `packages/client/src` — flows-plugin already migrated off it (its barrel documents the retirement). Clicking "Automations" calls `setLocation("/automation?cwd=…")`, which matches no route → blank. The Create-Automation flow is therefore stranded behind an unreachable board.

The fix: re-skin the sidebar section to mirror OpenSpec, and move the board from the dead `command-route` slot to the live **`shell-overlay-route`** slot (the pattern the OpenSpec board and flows popouts already use).

## What Changes

- `FolderAutomationSection` re-skinned to mirror `FolderOpenSpecSection` anatomy: 10px uppercase clickable title `AUTOMATIONS (N) →`, refresh icon, right-aligned `+ New` action chip. Same typography/spacing as the OpenSpec header so the two rows read as siblings.
- Automation board re-claimed from `command-route` `/automation` to **`shell-overlay-route`** `/folder/:encodedCwd/automations`. `AutomationBoard` reads `cwd` from the decoded route param instead of `session.cwd`.
- Sidebar navigation targets the new shell-overlay path; the `+ New` chip opens `CreateAutomationDialog` directly (board need not be open first).
- Invalid-count badge (`⚠ N`) preserved in the re-skinned header.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `automation-content-view`: board reachable via `shell-overlay-route` (not `command-route`); sidebar folder entry achieves visual parity with the OpenSpec folder section.

## Impact

- **Code**:
  - `packages/automation-plugin/src/client/FolderAutomationSection.tsx` — re-skin to OpenSpec-header anatomy; add `+ New` chip; navigate to `/folder/:encodedCwd/automations`.
  - `packages/automation-plugin/package.json` — change board claim slot `command-route` → `shell-overlay-route`, add `path`.
  - `packages/automation-plugin/src/client/AutomationBoard.tsx` — accept/decode `routeParams.encodedCwd` for cwd; render in shell-overlay page chrome with back action.
  - `packages/automation-plugin/src/client/index.tsx` — export updates if claim component signature changes.
- **Tests**: `packages/automation-plugin/src/__tests__/FolderAutomationSection.test.tsx` — assert OpenSpec-parity markup + navigation target; add board-route mount test.
- **Docs**: `docs/file-index-plugins.md` rows for the three touched files.
- **UX**: Automations link now opens a full-page board; sidebar row visually consistent with OpenSpec. No breaking config/data change.
