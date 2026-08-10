# Redesign the folder → workspace add flow

## Why

Opening the home page of a folder that has live sessions but is neither pinned nor a workspace member lands on a
dead end: `DirectoryHomeView`'s eligibility guard refuses to render and shows "This folder isn't available as a
home page". Every folder row navigates to that page (`directory-card-clickable-select` made the whole row
clickable), so the guard turns a normal affordance into a wall — the folder is unusable until the user discovers
the 10px `+ws` text token floating outside the row's icon cluster.

The organise gestures around it are equally weak: `+ws` is cryptic and easy to miss, and `PinDirectoryDialog`
wraps a single-select `PathPicker` where clicking a row both descends *and* commits the answer, so multiple
folders cannot be added in one pass and folders the user already works in are invisible unless the path is typed.

Interactive mockup (dark + light, verified 420 → 1440 px): `mockups/add-flow.html`.

## What Changes

- **Remove the directory-home eligibility guard.** Any cwd that can be grouped renders its home page. The
  "not available" notice and its pin CTA are deleted. **BREAKING** for `directory-home-page`'s guard scenarios.
- **Replace the `+ws` text token** with a compact `mdiFolderPlus` + `mdiMenuDown` ghost icon button (28×20,
  44px touch) that joins the folder row's existing icon cluster in the order `sort · add-to · home · pin`.
  Kept in **both** current placements — the folder row *and* the session card header.
- **Drop "Pin to dashboard" as a choice.** Adding a folder always pins it (pin *is* visibility); unpinning
  removes it from the sidebar immediately. The popover loses its pin entry and the add dialog loses its pin
  checkbox, leaving exactly one question: which workspace, if any.
- **Turn the folder picker into a real explorer.** Row click navigates *into* a directory (trailing
  `mdiChevronRight` as the explicit descend affordance); a per-row **checkbox** selects. Selected paths collect
  in a removable-pill basket and commit in one batch.
- **Surface loose cwds in the picker** with a session-count badge, so folders the user already works in are
  one click away without typing a path.
- **Add an optional single-select workspace destination** to the picker, honouring the existing
  single-membership invariant. When no workspaces exist it renders "None — no workspaces yet" plus
  `+ New workspace…` instead of an empty control.
- **Replace every emoji glyph in `PathPicker`** (`⬆` parent, `📁` folder, `＋` create) with `@mdi/js` paths so
  iconography inherits `currentColor` and stops shifting with platform font.
- **Guarantee the folder-row icon cluster never wraps.** The cluster is `flex:none; white-space:nowrap`; the
  parent path collapses before the folder name, which keeps a legible floor.

## Capabilities

### New Capabilities
- `multi-select-folder-picker`: explorer-semantics directory picker — click-to-navigate vs checkbox-to-select,
  multi-path basket, batch commit, always-pin-on-add, optional single workspace destination with an empty
  state, loose-cwd session badges, and MDI-only iconography.

### Modified Capabilities
- `directory-home-page`: the pinned-OR-workspace eligibility guard and the "not available" notice are removed;
  the home page renders for any groupable cwd.
- `folder-workspaces`: the add-to-workspace affordance becomes a compact icon+caret button present on the
  folder row and the session card; its popover no longer offers a pin destination.
- `filesystem-browser`: `PathPicker` gains multi-select + explorer navigation semantics and drops emoji glyphs
  for `@mdi/js` paths.
- `dashboard-add-buttons`: the dashboard- and workspace-scoped Add Folder buttons open the multi-select picker;
  the workspace-scoped one preselects its own workspace as the destination.
- `sidebar-folder-header`: the header icon cluster SHALL fit the top-right at any sidebar width without
  wrapping, with defined name-truncation priority.

## Impact

- **Client**: `packages/client/src/components/primitives/PathPicker.tsx` (multi-select + MDI),
  `components/workspace/PinDirectoryDialog.tsx` (becomes the Add Folders dialog),
  `components/workspace/AddToWorkspaceMenu.tsx` (pin entry removed),
  `components/session/SessionList.tsx` (`renderGroupWithWorkspaceMenu` → clustered icon button; cluster
  no-wrap + truncation CSS), `components/folder/DirectoryHomeView.tsx` (guard deleted), session card header.
- **Protocol/server**: batch add path — existing `add_folder_to_workspace` + `pin_directory` messages are
  reused per path; no new message type is required unless batching proves chatty (see design).
- **Tests**: `PathPicker.test.tsx`, `PinDirectoryDialog.test.tsx`, `SessionList.test.tsx` all assert current
  single-select / `+ws` / guard behaviour and will need updating; new specs get scenario coverage.
- **i18n**: new keys for the picker destination + empty state; `directoryHome.notPinnedTitle`,
  `notPinnedBody`, `pinCta` become unused.
- **Docs**: `docs/architecture.md` folder/workspace section; directory `AGENTS.md` rows for every touched file.

## Discipline Skills

`doubt-driven-review` (removing the eligibility guard and redefining pin as implicit are hard-to-reverse
behaviour changes), `scenario-design` (multi-select, batch-commit, and empty-workspace edge cases need real
scenarios, not smoke tests), `review-code` (non-trivial multi-file client change before commit).
