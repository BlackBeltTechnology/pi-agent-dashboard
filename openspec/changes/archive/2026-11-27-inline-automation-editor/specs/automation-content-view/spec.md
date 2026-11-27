## MODIFIED Requirements


### Requirement: Automation card shows a last-run summary and a Stop action

Each valid automation card that is not editing SHALL show a last-run summary inline, derived from the runs already loaded: the latest run's status pill, its human start label and duration, a findings chip when the count is above 0, an **Open session** link when the run has a session id, and a Monitor, Result or Log link chosen by status. When the automation has a `running` or `orphaned` run, the card SHALL expose a **Stop** action for that run; otherwise, while the card is not editing, it SHALL expose **Run now**. **Edit** SHALL be a visible card action (not inside the overflow control); activating Edit or the automation's name SHALL expand that card into the inline editor, and activating the trigger summary SHALL do the same with focus on the Trigger section. While the card is editing, Edit SHALL read **Close editor** and SHALL collapse the editor; the Stop action and the orphaned-run notice SHALL stay visible, while Run now, Enable/Disable, the last-run summary and the run history SHALL be hidden until the editor closes. Delete (with confirmation) SHALL remain available under the overflow control. The overflow control's menu SHALL render in a body-mounted portal (via the `ui:popover` primitive) so the card's clip does not hide it, and SHALL dismiss on outside click or Esc.

When the latest run is `orphaned`, the card SHALL show an **orphaned** status pill and a warning notice. The notice SHALL state that the run is no longer tracked (for example because the server restarted while it was running), that its completion was not recorded, and whether its session is still connected, and SHALL link to the session.

#### Scenario: Last-run summary rendered on the card

- **WHEN** an automation has at least one prior run
- **THEN** its card SHALL show the latest run's status, human start label, duration, an Open session link when a session id exists, and the status-specific Monitor/Result/Log link.

#### Scenario: Stop replaces Run now while running

- **WHEN** an automation has a `running` run
- **THEN** the card SHALL show a Stop action (not Run now) that stops that run.

#### Scenario: Orphaned run is named and stoppable

- **WHEN** an automation's latest run is reported `orphaned`
- **THEN** the card SHALL show an orphaned pill, a warning notice explaining that the run is no longer tracked, and a Stop action.

#### Scenario: Edit is directly reachable

- **WHEN** a valid automation card is rendered
- **THEN** an Edit action SHALL be visible on the card without opening the overflow menu
- **AND** activating the automation's name SHALL expand the same inline editor in that card.

#### Scenario: Editing card hides Run now and Disable

- **GIVEN** an idle, enabled automation
- **WHEN** its card is editing
- **THEN** Run now and Disable SHALL NOT render on that card, and SHALL render again after the editor closes

#### Scenario: Edit expands the card in place

- **WHEN** the user activates Edit on a card
- **THEN** the editor SHALL render inside that card, below its header and summary, with no modal dialog or backdrop
- **AND** the button SHALL read "Close editor" with `aria-expanded="true"`
- **AND** focus SHALL move to the first control of the Trigger section

#### Scenario: Trigger summary opens the editor on Trigger

- **WHEN** the user activates a card's trigger summary
- **THEN** the card SHALL expand into the editor with focus inside the Trigger section

#### Scenario: Close editor restores the card and focus

- **WHEN** the user activates "Close editor" or Cancel on a clean editor
- **THEN** the card SHALL collapse back to its summary, last-run line and run history
- **AND** focus SHALL return to the control that opened the editor

#### Scenario: Overflow menu is visible over the card when opened

- **WHEN** a user activates the `⋯` overflow control on an automation card
- **THEN** the Delete action SHALL render in a portal anchored to the control, positioned so the card's clipping container does not clip it, and SHALL stay in the viewport when the card sits near a viewport or scroll-container edge.

#### Scenario: Overflow menu dismisses on outside click or Esc

- **WHEN** the overflow menu is open
- **AND** the user clicks outside the menu and its trigger, or presses Esc
- **THEN** the menu SHALL close without invoking Delete.


## ADDED Requirements

### Requirement: Create Automation opens an inline draft

The board's "Create Automation" action and the folder actions menu "New automation" item SHALL open a new-automation draft: an inline editor at the top of that folder's board list, never a modal dialog. The menu item SHALL navigate to the board with the draft already open. Closing or creating the draft SHALL leave no history entry that reopens it.

#### Scenario: New automation from the folder menu opens the board draft

- **WHEN** a user activates the "New automation" item in a folder's actions menu
- **THEN** the dashboard SHALL navigate to that folder's automation board
- **AND** the board SHALL show the new-automation draft open at the top of the list, with no modal dialog

#### Scenario: Board Create opens the draft inline

- **WHEN** a user activates "Create Automation" on the board
- **THEN** a draft card holding the editor SHALL appear at the top of the automation list, with no modal dialog

#### Scenario: Closing the draft does not reopen it on Back

- **GIVEN** the board was opened from the folder menu "New automation" item
- **WHEN** the user cancels or creates the draft and then uses Back
- **THEN** the draft SHALL NOT reopen

#### Scenario: Draft on an empty folder

- **GIVEN** the folder has no automations
- **WHEN** the user arrives from the folder menu "New automation" item
- **THEN** the empty-state explanation SHALL stay and the draft SHALL show below it

#### Scenario: Load failure shows the error, not a draft

- **GIVEN** the board's automation list fails to load
- **WHEN** the user arrives from the folder menu "New automation" item
- **THEN** the board SHALL show its load-error state with Retry and SHALL NOT show a draft

### Requirement: Automation editor writes the chosen scope, action and model

The editor SHALL edit the trigger, actions (incl. additional fan-out actions), agent, model, name and scope (`folder` | `global`, create only), `mode`, `concurrency`, `sandbox` and `visibility`, and SHALL write `automation.yaml` (plus `prompt.md` for prompt actions) to the chosen scope, keeping keys it does not edit. The model SHALL be picked through `ModelSelector`, directly or as an `@role` from its Role tab listing the live built-in and custom roles.

#### Scenario: Create writes to chosen scope

- **WHEN** a user creates an automation with scope `global`
- **THEN** `~/.pi/automation/<name>/automation.yaml` SHALL be written and the automation SHALL appear with scope `global`.

#### Scenario: Prompt action writes prompt.md

- **WHEN** a user creates a `prompt` automation
- **THEN** a `prompt.md` SHALL be written next to `automation.yaml` and referenced by `action.prompt`.

#### Scenario: Saving keeps keys the editor does not show

- **GIVEN** an automation with `disabled: true` and `maxConcurrentSpawns: 3`
- **WHEN** the user edits its prompt and saves
- **THEN** the written `automation.yaml` SHALL still declare `disabled: true` and `maxConcurrentSpawns: 3`

#### Scenario: Custom role is selectable in the editor

- **GIVEN** a custom role `nightly` exists
- **WHEN** the user opens the automation editor's model picker Role tab
- **THEN** `nightly` SHALL be offered and selecting it SHALL store `model: "@nightly"`

### Requirement: Direct model carries a thinking level, a role does not

When no ACP agent is chosen, on the direct-model branch the editor SHALL render a thinking-level control beside the model selector, offering the picked model's `supportedThinkingLevels`; the level SHALL be written as a `:<level>` suffix on `model`, and no override SHALL write the bare `"<provider>/<id>"`. When a role is selected no thinking-level control SHALL render and `model` SHALL be the bare `@role`.

#### Scenario: Direct model with a thinking level

- **WHEN** a user picks model `anthropic/claude-sonnet-4-5` and level `high` on the direct-model branch
- **THEN** the written `automation.yaml` SHALL declare `model: "anthropic/claude-sonnet-4-5:high"`.

#### Scenario: Role branch offers no level control

- **WHEN** a user selects a role on the model picker's Role tab
- **THEN** no thinking-level control SHALL render
- **AND** the written `model` value SHALL be the bare `@role` token with no suffix.

### Requirement: Inline editor presentation

The editor SHALL render inside the board card it edits, with no backdrop, grouped into Trigger, Runs as (agent + model), a collapsed Advanced group whose header shows the current mode, concurrency and sandbox, and Action. Name and Scope SHALL be editable only in the create draft. The next-run preview SHALL show a relative duration with a pulsing dot. Action ids and descriptions SHALL wrap. Text controls SHALL show a visible token border.

#### Scenario: Inline groups, no modal

- **WHEN** the editor opens for an existing automation
- **THEN** Trigger, Runs as, Advanced and Action SHALL render inside the card with no backdrop, and Name and Scope SHALL NOT be editable fields

#### Scenario: Next-run shown as a relative duration

- **WHEN** the `schedule` trigger has a valid cron
- **THEN** the next-run preview SHALL show the time until the next fire with a pulsing status dot.

#### Scenario: Text controls are visibly bordered

- **WHEN** the editor shows the Cron, Name or Prompt control in any theme
- **THEN** each control SHALL render a visible border and field background from theme tokens, not plain text

#### Scenario: Action names are not truncated

- **WHEN** the action picker lists `core.prompt`, `core.skill` and `flows.run` with their descriptions
- **THEN** each action id and description SHALL be fully readable, wrapping rather than truncating

### Requirement: Editor save bar

A save bar SHALL stay visible at the bottom of the editing card while the board scrolls. It SHALL show the scope and write path, the editor's unsaved-change count, Cancel, and Save (edit) or Create with the next-run time (create). Save SHALL be disabled while an edit has no unsaved change. An untouched editor SHALL report no unsaved change.

#### Scenario: Unsaved count is shown

- **WHEN** the user changes the schedule of an existing automation
- **THEN** the save bar SHALL report 1 unsaved change and Save SHALL be enabled

#### Scenario: Save bar stays reachable

- **WHEN** the editor is taller than the board viewport and the user scrolls the board
- **THEN** the save bar with Cancel and Save SHALL stay visible at the bottom of the visible card area
- **AND** the board root SHALL remain the only vertical scroller, also with a long prompt, and its header with Back SHALL stay visible above the save bar

#### Scenario: Save bar names where it writes

- **WHEN** the editor is open for a global automation `pr-triage`
- **THEN** the save bar SHALL show that it writes under `~/.pi/automation/pr-triage/`

#### Scenario: Unchanged edit cannot be saved

- **WHEN** the editor opens for an existing automation and nothing is changed, including a worktree automation in a folder without git
- **THEN** the save bar SHALL report no unsaved change and Save SHALL be disabled

### Requirement: Editor fits phone widths

At 375 px the editor SHALL render in one column with no horizontal scroll in the card or board. Planned trigger kinds SHALL fold into one "coming soon" marker.

#### Scenario: Phone width has no horizontal scroll

- **WHEN** the board renders at 375 px wide with a card editing
- **THEN** the editor SHALL render in one column with no horizontal scroll inside the card or board
- **AND** planned trigger kinds SHALL fold into one "coming soon" marker

#### Scenario: Stop stays on a phone while editing

- **GIVEN** an automation with a `running` run
- **WHEN** its card is editing at 375 px wide
- **THEN** its Stop action SHALL stay visible in the card header

### Requirement: One inline editor at a time with an unsaved-changes guard

The board SHALL show at most one open editor. Opening another editor (also via this folder's menu "New automation" item), Close editor or Cancel while the open editor has unsaved changes SHALL keep it open with an inline warning naming the count and offering Discard and Save & switch (Save & close when closing). Discard SHALL continue unsaved; Save SHALL continue only on success. Leaving the board is not guarded.

#### Scenario: Clean editor switches immediately

- **GIVEN** card A's editor is open with no unsaved changes
- **WHEN** the user activates Edit on card B
- **THEN** card A SHALL collapse and card B SHALL open its editor

#### Scenario: Dirty editor warns before switching

- **GIVEN** card A's editor has 2 unsaved changes
- **WHEN** the user activates Edit on card B
- **THEN** card A's editor SHALL stay open with a warning naming 2 unsaved changes and offering Discard and Save & switch
- **AND** card B SHALL NOT open yet

#### Scenario: Re-requesting the open editor does nothing

- **GIVEN** card A's editor has unsaved changes
- **WHEN** the user activates card A's name or trigger summary
- **THEN** no warning SHALL appear and the edits SHALL stay, with focus moved to the requested section

#### Scenario: Discard continues without saving

- **GIVEN** the unsaved-changes warning is shown for card A while switching to card B
- **WHEN** the user activates Discard
- **THEN** no save request SHALL be sent and card B SHALL open its editor

#### Scenario: Failed save keeps the edits

- **GIVEN** the unsaved-changes warning is shown for card A
- **WHEN** the user activates Save & switch and the save fails
- **THEN** card A's editor SHALL stay open with its edits and the error, and card B SHALL NOT open

#### Scenario: Closing a dirty editor warns

- **GIVEN** card A's editor has unsaved changes
- **WHEN** the user activates Close editor or Cancel
- **THEN** the editor SHALL stay open with the warning offering Discard and Save & close

#### Scenario: Back is not intercepted

- **GIVEN** an editor with unsaved changes is open
- **WHEN** the user activates the board's Back control
- **THEN** the board SHALL navigate through the shell's back action without a warning and the edits SHALL be discarded

## REMOVED Requirements

### Requirement: Create Automation entry point

**Reason**: Creating no longer opens a modal editor outside the board; the folder actions menu "New automation" item (which replaced the row's "+ New" in move-slot-actions-to-menu) now opens the board's inline draft.
**Migration**: Replaced by "Create Automation opens an inline draft" (the folder menu "New automation" item navigates to the board with the draft open), "Automation editor writes the chosen scope, action and model" and "Direct model carries a thinking level, a role does not"; those carry every other create behaviour over unchanged.

### Requirement: Editor visual presentation

**Reason**: The bordered-box modal layout with segmented Scope/Action controls, header "armed on save" chip and footer caption is replaced by the inline card editor.
**Migration**: Replaced by "Inline editor presentation", "Editor save bar" and "Editor fits phone widths"; the next-run relative preview is kept.
