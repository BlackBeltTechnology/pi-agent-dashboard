## Purpose

Define the OpenSpec launch dialogs (Explore, Propose, New Change) and their mobile
kebab-menu entry points: their structure, controls, prompt formatting, and the
run-config row that sets the session's model and thinking effort at launch.
## Requirements
### Requirement: Explore dialog
Clicking [Explore] on a change SHALL open a modal dialog with a multiline text input and support for pasted image attachments. The dialog SHALL render via DialogPortal at document.body with z-[60]. The dialog container SHALL use `max-w-2xl` (wider than a standard small modal) and the textarea SHALL be at least `h-48` to accommodate longer exploration prompts. The dialog textarea SHALL accept clipboard-pasted images via the shared `useImagePaste()` hook, and pasted images SHALL be rendered below the textarea via the shared `<ImagePreviewStrip>` component.

The dialog header SHALL follow the shared OpenSpec dialog anatomy: a leading icon tile (via `Dialog`'s `icon` prop), the static title "Explore", the attached change name rendered as a separate chip when a change is attached, and a hint line describing the workflow's guardrail. The change name SHALL NOT be concatenated into the title string, and a long change name SHALL truncate within its chip rather than wrap the heading or run under the dialog's close control.

The paste affordance SHALL be conveyed by a persistent field note beneath the textarea rather than by placeholder text, because placeholder text disappears on focus. The field note SHALL also disclose the `Cmd/Ctrl+Enter` send accelerator. The textarea placeholder SHALL be a single short question (e.g. "What do you want to explore?").

The dialog SHALL render the run-config row defined by the `openspec-dialog-run-config` capability in its footer.

#### Scenario: Open explore dialog
- **WHEN** user clicks [Explore] on change "theme-system"
- **THEN** a dialog appears with an icon tile, the title "Explore", a separate chip reading "theme-system", a hint line, a multiline text input at least `h-48` tall, and a container sized `max-w-2xl`
- **AND** the dialog is rendered at document.body via DialogPortal

#### Scenario: Explore dialog with no attached change
- **WHEN** the Explore dialog is opened with no change name
- **THEN** the title SHALL read "Explore" with no name chip rendered

#### Scenario: Long change name does not collide with the close control
- **WHEN** the Explore dialog is opened for a change whose name exceeds the available header width
- **THEN** the name chip SHALL truncate with an ellipsis
- **AND** the chip SHALL NOT overlap the dialog's close (X) control

#### Scenario: Paste affordance is persistent
- **WHEN** the user focuses the Explore dialog's textarea, causing the placeholder to disappear
- **THEN** the field note describing the paste capability and the send accelerator SHALL remain visible

#### Scenario: Send explore command without images
- **WHEN** user types text and clicks [Explore] in the explore dialog
- **THEN** a `send_prompt` is sent with text `/skill:openspec-explore theme-system\n<user text>` and no images
- **AND** the dialog closes

#### Scenario: Paste image into explore dialog
- **WHEN** the user pastes an image into the Explore dialog's textarea
- **THEN** the image SHALL appear as a thumbnail below the textarea with a remove (×) button
- **AND** the dialog SHALL NOT close

#### Scenario: Send explore command with images
- **WHEN** user types text, pastes one or more images, and clicks [Explore]
- **THEN** a `send_prompt` is sent with text `/skill:openspec-explore theme-system\n<user text>` AND `images: ImageContent[]` containing the pasted images
- **AND** the dialog closes
- **AND** the pending images list is cleared

#### Scenario: Remove pasted image before sending
- **WHEN** user has pasted an image and clicks the remove (×) button on its thumbnail
- **THEN** the image SHALL be removed from the pending images list
- **AND** the dialog SHALL remain open

#### Scenario: Cancel explore dialog
- **WHEN** user clicks [Cancel] in the explore dialog
- **THEN** the dialog closes without sending anything
- **AND** any pasted images are discarded

### Requirement: Quick confirm dialog for Archive
Clicking [Archive] SHALL show a confirmation dialog before executing. The dialog SHALL render via DialogPortal at document.body with z-[60].

#### Scenario: Archive confirm shown
- **WHEN** user clicks [Archive] on change "theme-system"
- **THEN** a confirm dialog appears asking "Archive theme-system?"
- **AND** the dialog is rendered at document.body via DialogPortal

#### Scenario: Archive confirmed
- **WHEN** user clicks [Archive] in the confirm dialog
- **THEN** a `send_prompt` is sent with text `/opsx:archive theme-system`
- **AND** the dialog closes

#### Scenario: Archive cancelled
- **WHEN** user clicks [Cancel] in the confirm dialog
- **THEN** the dialog closes without sending anything

### Requirement: NewChangeDialog for creating changes
Clicking `+ New` in the folder OpenSpec header SHALL open a `NewChangeDialog` modal with optional name and description fields.

The dialog header SHALL follow the shared OpenSpec dialog anatomy: a leading icon tile, the title "New Change", and a hint line describing what the workflow produces. The dialog SHALL render the run-config row defined by the `openspec-dialog-run-config` capability in its footer.

#### Scenario: Dialog fields
- **WHEN** the NewChangeDialog opens
- **THEN** it SHALL show an icon tile, the title "New Change", a hint line, a single-line input for change name (placeholder: "change-name") and a multiline textarea for description

#### Scenario: Send with name and description
- **WHEN** the user enters name `"add-auth"` and description `"Add OAuth support"` and clicks Send
- **THEN** a `send_prompt` SHALL be sent with text `/opsx:new add-auth\nAdd OAuth support` to the target session
- **AND** the dialog SHALL close

#### Scenario: Send with name only
- **WHEN** the user enters name `"add-auth"` with empty description and clicks Send
- **THEN** a `send_prompt` SHALL be sent with text `/opsx:new add-auth` to the target session

#### Scenario: Send with description only
- **WHEN** the user enters no name but description `"Add OAuth support"` and clicks Send
- **THEN** a `send_prompt` SHALL be sent with text `/opsx:new\nAdd OAuth support` to the target session

#### Scenario: Send with both empty
- **WHEN** the user enters no name and no description and clicks Send
- **THEN** a `send_prompt` SHALL be sent with text `/opsx:new` to the target session

#### Scenario: Cancel dialog
- **WHEN** the user clicks Cancel in the NewChangeDialog
- **THEN** the dialog SHALL close without sending anything

#### Scenario: Target session selection
- **WHEN** the NewChangeDialog sends a prompt
- **THEN** it SHALL target the first active (non-ended) session in the folder group

### Requirement: Mobile kebab menu unattached Explore
When no proposal is attached and the session is alive, the mobile kebab menu (MobileActionMenu) SHALL show an "Explore" menu row that opens the ExploreDialog with no change name.

#### Scenario: Explore visible when unattached and alive
- **WHEN** a session has no attached proposal and status is not "ended"
- **THEN** the kebab menu SHALL show an OpenSpec section with an "Explore" row

#### Scenario: Explore hidden when ended
- **WHEN** a session has no attached proposal and status is "ended"
- **THEN** the kebab menu SHALL NOT show the unattached OpenSpec section

#### Scenario: Explore hidden when attached
- **WHEN** a session has an attached proposal
- **THEN** the unattached OpenSpec section SHALL NOT appear (the attached section renders instead)

#### Scenario: Explore sends prompt via dialog
- **WHEN** user taps "Explore" in the unattached section
- **THEN** the menu closes and the ExploreDialog opens with empty changeName
- **AND** on send, a `send_prompt` is sent with text `/skill:openspec-explore\n<user text>`

### Requirement: Mobile kebab menu unattached New Change
When no proposal is attached and the session is alive, the mobile kebab menu SHALL show a "+ New Change" menu row that opens the NewChangeDialog.

#### Scenario: New Change visible when unattached and alive
- **WHEN** a session has no attached proposal and status is not "ended"
- **THEN** the kebab menu SHALL show a "+ New Change" row in the OpenSpec section

#### Scenario: New Change sends prompt via dialog
- **WHEN** user taps "+ New Change" in the unattached section
- **THEN** the menu closes and the NewChangeDialog opens
- **AND** on send, a `send_prompt` is sent with the formatted `/opsx:new` command

### Requirement: Shared header anatomy across OpenSpec launch dialogs
The Explore, Propose, and New Change dialogs SHALL present a consistent header structure: a leading icon tile rendered through `Dialog`'s `icon` prop, a title, an optional change-name chip, and a hint line stating what the workflow does. Each dialog SHALL retain the standard close (X) control that `Dialog` renders, in addition to its Cancel action, and the header SHALL reserve horizontal space so that header content never renders beneath that control.

#### Scenario: All three dialogs share the header structure
- **WHEN** any of the Explore, Propose, or New Change dialogs is opened
- **THEN** it SHALL render an icon tile, a title, and a hint line, in that order
- **AND** it SHALL render the standard close (X) control

#### Scenario: Keyboard accelerator is disclosed only where non-obvious
- **WHEN** the Explore dialog is open
- **THEN** it SHALL disclose the `Cmd/Ctrl+Enter` accelerator
- **WHEN** the Propose dialog is open
- **THEN** it SHALL NOT render an accelerator note, because plain Enter submits its single-field form by default

### Requirement: Grammar checking in the prose OpenSpec dialogs

The Explore dialog and the New Change dialog SHALL mount the composer grammar
panel over their freeform prose field via the shared `ComposerPanelSlot`
(`composer-panel` slot consumer), forwarding the field's current text as the
read-only `draft` and the field's setter as the bounded `onApplyText`, with no
`sessionId`. When the grammar plugin is disabled or unclaimed, the slot SHALL
render nothing and the dialogs SHALL behave exactly as before. The Propose dialog
(single-line name input, no prose field) SHALL NOT mount the slot.

#### Scenario: Explore dialog offers grammar checking over its prose
- **WHEN** the Explore dialog is open with the grammar feature enabled and a
  model configured
- **THEN** a `ComposerPanelSlot` SHALL render below the explore textarea, bound
  to the textarea's text (`draft`) and setter (`onApplyText`)
- **AND** applying a correction SHALL rewrite only the textarea text, never send
  the prompt

#### Scenario: New Change description offers grammar checking
- **WHEN** the New Change dialog is open with the grammar feature enabled and a
  model configured
- **THEN** a `ComposerPanelSlot` SHALL render below the description textarea,
  bound to the description text and setter
- **AND** the change-name single-line input SHALL NOT be grammar-checked

#### Scenario: Propose dialog is unchanged
- **WHEN** the Propose dialog is open
- **THEN** no grammar panel SHALL be mounted (its only field is a single-line
  name/description input)

#### Scenario: Feature disabled leaves the dialogs unchanged
- **WHEN** the grammar plugin is disabled or does not claim `composer-panel`
- **THEN** the Explore and New Change dialogs SHALL render exactly as they did
  before this change, with no grammar affordance and no extra network calls

#### Scenario: Enabled but no model configured surfaces the same state as the composer
- **WHEN** a prose dialog mounts the slot with the feature enabled but no LLM
  model configured
- **THEN** the panel SHALL behave exactly as the chat composer does in that state
  (the check surfaces the `backend_unconfigured` outcome), NOT a dialog-specific
  path
- **AND** no correction SHALL be applied to the field until a model is configured

