## ADDED Requirements

### Requirement: `composer-toolbar-action` slot
The chat composer (`CommandInput`) SHALL expose a `composer-toolbar-action` slot rendered in the **input row's trailing cluster**, immediately before the inline-terminal control and the morphing send/stop action button. Claim components SHALL receive `{ pluginContext, sessionId, sessionStatus, draft, composer }`, where `composer` is a bounded write handle:
- `insertAtCursor(text)` — inserts at the caret (or appends when the textarea is unfocused), separated by one space from adjacent text, and leaves the caret after the insert;
- `snapshot()` / `restore(snapshot)` — capture and restore the draft and caret, so a cancelled action restores the prior draft;
- `submit()` — submits the current draft exactly as the send button would, honouring the `Steer | Queue` delivery control.

The handle SHALL NOT expose arbitrary draft replacement. The slot id SHALL be declared in `packages/shared/src/dashboard-plugin/slot-types.ts`, its props in `slot-props.ts`, and accepted by `manifest-validator.ts`; a claim SHALL carry an `ariaLabel`. Core SHALL contain no feature-specific (e.g. voice) logic. With no claim the composer renders exactly as before.

#### Scenario: No claim — composer unchanged
- **WHEN** no enabled plugin claims `composer-toolbar-action`
- **THEN** the input row renders the textarea, inline terminal and action button exactly as before

#### Scenario: Claim renders before the action button
- **WHEN** a plugin claims `composer-toolbar-action`
- **THEN** its control renders in the input row directly before the inline-terminal control and the send/stop button, aligned to the textarea's bottom edge

#### Scenario: Insert at caret keeps typed text
- **WHEN** the draft is `refactor the auth|` with the caret at `|` and a claim calls `insertAtCursor("use the helper")`
- **THEN** the draft becomes `refactor the auth use the helper` with the caret after the insert

#### Scenario: Restore undoes a cancelled action
- **WHEN** a claim takes `snapshot()`, the draft changes, and the claim calls `restore(snapshot)`
- **THEN** the draft and caret equal the snapshot

#### Scenario: Submit honours the delivery control
- **WHEN** a claim calls `submit()` while the session is streaming and the delivery control is `Queue`
- **THEN** the draft is queued exactly as pressing the send button would queue it

#### Scenario: Claim without ariaLabel is rejected
- **WHEN** a manifest declares a `composer-toolbar-action` claim without `ariaLabel`
- **THEN** the manifest validator rejects the claim

### Requirement: Toolbar actions are never displaced
A `composer-toolbar-action` control SHALL stay visible and operable regardless of draft content, attachments, or session state: it SHALL NOT be hidden when the draft is non-empty, when attachments are present, or while the session is working, and the morphing send/stop button SHALL NOT replace it. When the composer container is narrow, toolbar actions SHALL stay in the input row (they do not fold into `⋯`). Each control SHALL have a target of at least 44×44 CSS px on the narrow layout and 24×24 otherwise.

#### Scenario: Visible while the agent works
- **WHEN** the session is streaming and the draft is empty
- **THEN** the toolbar action is visible next to the stop button

#### Scenario: Visible with text and attachments
- **WHEN** the draft has text and an image is attached
- **THEN** the toolbar action is visible

#### Scenario: Narrow pane keeps the action in the input row
- **WHEN** the composer folds to its narrow layout
- **THEN** the toolbar action remains in the input row and is not moved into `⋯`

### Requirement: Toolbar actions are isolated
Each claim SHALL render inside the plugin slot error boundary, and SHALL only receive the handle of the composer it is mounted in. The handle SHALL become inert when its composer unmounts or switches session.

#### Scenario: Crashing action does not break the composer
- **WHEN** a toolbar action throws during render
- **THEN** the boundary renders nothing for it and the composer keeps working

#### Scenario: Stale handle after session switch
- **WHEN** the composer switches to another session and a claim calls `insertAtCursor` on the old handle
- **THEN** the call is a no-op and returns `false`
