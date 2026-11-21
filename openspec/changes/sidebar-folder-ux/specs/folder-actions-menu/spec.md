## ADDED Requirements

### Requirement: Menu offers one-step removal from the sidebar

The `directory` group SHALL contain a **Remove from sidebar** item (`id: remove-from-sidebar`, no tone — it renders neutral) for a folder that is pinned or owned by a workspace. Activating it SHALL detach the folder from its workspace and unpin it via the existing `remove_folder_from_workspace` / `unpin_directory` messages, as applicable. When any session of the folder has status other than `ended` it SHALL first require confirmation (see scenarios).

#### Scenario: Pinned folder inside a workspace
- **GIVEN** a folder that is in workspace W and also pinned, with only ended sessions
- **WHEN** the user activates Remove from sidebar
- **THEN** `remove_folder_from_workspace` for W and `unpin_directory` SHALL both be sent
- **AND** the folder SHALL leave the default sidebar without archiving any session

#### Scenario: Pinned top-level folder
- **GIVEN** a pinned folder outside any workspace
- **WHEN** the user activates Remove from sidebar
- **THEN** only `unpin_directory` SHALL be sent

#### Scenario: Live sessions require confirmation
- **GIVEN** a pinned folder with two sessions whose status is not `ended`
- **WHEN** the user activates Remove from sidebar
- **THEN** a confirm dialog SHALL open listing both live sessions
- **AND** nothing SHALL be sent until the user confirms

#### Scenario: Hidden live sessions are included
- **GIVEN** a pinned folder with a live session that the "show hidden" filter hides (headless worker or automation run)
- **WHEN** the user activates Remove from sidebar and confirms
- **THEN** that session SHALL be listed in the dialog and SHALL receive a `shutdown` message like any other live session

#### Scenario: Worktree sessions in the folder's card are included
- **GIVEN** a pinned folder `/repo` whose card also contains a live unpinned worktree session (`gitWorktree.mainPath = /repo`, `cwd = /repo/.worktrees/x`)
- **WHEN** the user activates Remove from sidebar and confirms
- **THEN** that session SHALL be listed in the dialog and SHALL receive a `shutdown` message

#### Scenario: Confirm ends live sessions then removes
- **GIVEN** the confirm dialog for a pinned folder with live sessions A and B
- **WHEN** the user confirms
- **THEN** a `shutdown` message SHALL be sent for every session in the folder's group (same grouping key as the card, including unpinned worktree sessions shown in it) whose status is not `ended` at the moment of confirming (including one that went live after the dialog opened)
- **AND** the removal messages (`remove_folder_from_workspace` / `unpin_directory`, as applicable) SHALL be sent after them

#### Scenario: Long live-session list stays usable
- **GIVEN** a folder with many live sessions (for example 60) with long names
- **WHEN** the confirm dialog opens
- **THEN** every live session SHALL be listed inside a height-capped scrollable container (`max-h-32 overflow-y-auto`, as in `CloseWorktreeDialog`), with long names truncated
- **AND** the Cancel and Confirm buttons SHALL remain visible

#### Scenario: One failing shutdown does not abort the rest
- **GIVEN** the confirm dialog for a folder with live sessions A and B, where sending `shutdown` for A throws
- **WHEN** the user confirms
- **THEN** `shutdown` SHALL still be sent for B, the removal messages SHALL still be sent, and the dialog SHALL close (best-effort, no client ack; the user may retry)

#### Scenario: Shutdown callback unavailable
- **GIVEN** a mount of the folder menu without an `onShutdown` callback and a folder with live sessions
- **WHEN** the menu opens
- **THEN** no Remove from sidebar item SHALL render for that folder
- **AND** a folder with no live sessions SHALL still offer the item

#### Scenario: Dialog outlives the menu
- **GIVEN** the confirm dialog opened from the folder menu
- **WHEN** the menu closes, or the folder leaves the list while the dialog is open
- **THEN** the dialog SHALL remain open until the user confirms or cancels

#### Scenario: Cancel changes nothing
- **GIVEN** the confirm dialog is open
- **WHEN** the user cancels or presses Escape
- **THEN** no message SHALL be sent and the folder SHALL stay in the sidebar

#### Scenario: Confirm dialog is accessible and defaults to Cancel
- **WHEN** the confirm dialog opens
- **THEN** it SHALL expose `role="dialog"` with `aria-modal="true"` and an accessible title
- **AND** keyboard focus SHALL be on Cancel, with Tab contained in the dialog
- **AND** on close, focus SHALL return to the folder's menu trigger (`folder-actions-menu-<cwd>`) when that element is still in the document

#### Scenario: Not offered where there is nothing to remove
- **GIVEN** an unpinned folder outside every workspace
- **WHEN** the menu opens
- **THEN** no Remove from sidebar item SHALL render

#### Scenario: Sessions stay reachable and a new session restores the folder
- **GIVEN** a folder removed from the sidebar
- **WHEN** the user types its path in the Folder filter, or a new session starts in it
- **THEN** the folder SHALL appear again with its sessions intact

### Requirement: Menu content stays reachable at short desktop heights

On a desktop-form (popover) folder actions menu, every item SHALL be reachable by wheel scroll and by keyboard when the menu is taller than the viewport space available to it: the panel SHALL be bounded to the viewport and scroll internally. The same SHALL hold for any other popover that lists directories or workspaces.

#### Scenario: Tall menu on a 1280×720 window
- **GIVEN** a viewport 1280px wide and 720px tall and a folder menu whose content exceeds 720px
- **WHEN** the menu opens
- **THEN** the panel bottom SHALL be at or above the viewport bottom
- **AND** scrolling the panel SHALL bring the last item into view

#### Scenario: Keyboard reaches the last item
- **GIVEN** the same open menu
- **WHEN** the user moves focus to the last item with the keyboard
- **THEN** that item SHALL be scrolled into view

## MODIFIED Requirements

### Requirement: Folder menu items carry an optional semantic tone

Every folder menu item, whether host or plugin-contributed, MAY carry one `UiTone`. Rendering, the `data-action-tone` hook, disabled behaviour and the contrast floors SHALL follow the session actions menu (`session-actions-menu`, "Menu items carry an optional semantic tone"):
- the icon takes the tone's `--accent-<hue>-text` token, and the label keeps the neutral item colour;
- an enabled `danger` item, while hovered or focused, renders on `--tint-red-bg` with icon and label in `--accent-red-text`;
- invalid tone values, including inherited object keys, render neutral;
- a disabled item drops the colour but keeps `data-action-tone`.

This applies in both the dropdown and the narrow-viewport sheet form. The `Group sessions by` radio items (`menuitemradio`) SHALL NOT be toned. `tone` has no effect on a host item that renders through its `node` escape hatch (add-to-workspace), because that node owns its own markup.

**Host item tones:**

| Tone | Items |
|---|---|
| create | Enable OpenSpec for this folder |
| caution | Clean up broken (N); Project setup… while an update is pending |

All other host items are neutral, including Remove from sidebar (it ends live sessions only after an explicit confirm dialog, which carries the severity; the menu item itself stays neutral), Remove from workspace (it only removes the folder from the workspace list and discards nothing), Project setup… when no update is pending, and the add-to-workspace node item. `danger` is reserved for actions that end a process or discard work.

**First-party plugin tones:**

| Plugin | Tone | Items |
|---|---|---|
| goal | create | New goal |
| automation | create | New automation |
| team | create | Enable team for this folder |
| team | danger | Disable team |
| kb | caution | the KB action item, only while its kind is `index` ("Index now"), `reindex` ("Reindex now") or `retry` ("Retry") |

The KB action item is neutral when its kind is `pin`, `configure`, `missing` or `busy`. The team items Team and Team settings… are neutral.

**Badge colour:** the item badge is 10 px text, so it SHALL use the text-role token `--accent-orange-text`, which reaches at least 4.5:1 on the menu surface in every built-in palette and mode. No host-rendered folder menu element SHALL compute its colour from a raw Tailwind palette class (for example `text-amber-400`). The `node` escape hatch owns its own markup and is excluded.

#### Scenario: Disable team is red
- **WHEN** the folder actions menu opens for a team-managed folder whose team can be disabled
- **THEN** **Disable team** SHALL carry `data-action-tone="danger"` and an `--accent-red-text` icon
- **AND** while hovered, its background SHALL be `--tint-red-bg` and its label `--accent-red-text`

#### Scenario: Remove from workspace stays neutral
- **WHEN** the folder actions menu opens for a folder that belongs to a workspace
- **THEN** **Remove from workspace** SHALL carry no `data-action-tone`

#### Scenario: Project setup is caution only while an update is pending
- **WHEN** the folder's init status reports a pending update
- **THEN** **Project setup…** SHALL carry `data-action-tone="caution"`
- **AND WHEN** no update is pending
- **THEN** it SHALL carry no `data-action-tone`

#### Scenario: KB tone follows the action kind
- **WHEN** the KB section's action kind is `reindex`
- **THEN** its folder menu item SHALL carry `data-action-tone="caution"`
- **AND WHEN** the kind becomes `pin` ("Pin folder")
- **THEN** the item SHALL carry no `data-action-tone`

#### Scenario: Radio items stay neutral
- **WHEN** the folder actions menu opens
- **THEN** no `menuitemradio` SHALL carry `data-action-tone`

#### Scenario: Tones render in the sheet form
- **WHEN** the folder actions menu opens as a sheet, because the viewport is narrower than 768 px or shorter than 600 px (for example 1200×560)
- **THEN** **Clean up broken (N)** SHALL still carry `data-action-tone="caution"` with an `--accent-orange-text` icon

#### Scenario: Badge uses the text-role token
- **GIVEN** the KB item shows its stale badge
- **WHEN** the menu opens
- **THEN** the badge's computed colour SHALL equal the resolved `--accent-orange-text`
- **AND** no host-rendered element of the open menu SHALL carry a raw palette colour class such as `text-amber-400`
