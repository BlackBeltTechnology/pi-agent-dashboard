# openspec-frontend-actions

## Purpose

Defines the slash commands emitted by OpenSpec action buttons in the dashboard frontend (session card, folder section, mobile action menu, New Change dialog, Explore dialog). Pins every button to the canonical `/skill:openspec-<verb>-change` route so frontend wiring matches the underlying skill set, while preserving the legacy `/opsx:` prompt templates as user-typeable fallbacks.

## Requirements

### Requirement: Dashboard OpenSpec buttons SHALL emit skill slash commands

Every OpenSpec action button rendered by the dashboard frontend (session card, folder section, mobile action menu, dialogs) MUST emit a `/skill:openspec-<verb>-change` slash command, never a `/opsx:<verb>` slash command. The Explore action MUST emit `/skill:openspec-explore`.

The mapping is fixed:

| User-visible action | Emitted command |
|---|---|
| New | `/skill:openspec-new-change` |
| Continue | `/skill:openspec-continue-change` |
| Fast-Forward (FF) | `/skill:openspec-ff-change` |
| Apply | `/skill:openspec-apply-change` |
| Verify | `/skill:openspec-verify-change` |
| Archive | `/skill:openspec-archive-change` |
| Explore | `/skill:openspec-explore` |

Argument format follows the existing prompt-template format: `<command> <change-name>` for actions targeting an attached proposal, with optional `\n<user-text>` and image attachments for Explore-style dialogs.

#### Scenario: Apply button on a session card emits the skill command

- **WHEN** a user clicks the Apply button on a session card with attached change `add-user-auth`
- **THEN** the dashboard sends the prompt string `/skill:openspec-apply-change add-user-auth`
- **AND** the dashboard does not send `/opsx:apply add-user-auth`

#### Scenario: Verify button on a session card emits the skill command

- **WHEN** a user clicks the Verify button on a session card with attached change `add-user-auth`
- **THEN** the dashboard sends the prompt string `/skill:openspec-verify-change add-user-auth`

#### Scenario: Archive button on a session card emits the skill command

- **WHEN** a user clicks the Archive button on a session card with attached change `add-user-auth`
- **THEN** the dashboard sends the prompt string `/skill:openspec-archive-change add-user-auth`

#### Scenario: Continue button on a session card emits the skill command

- **WHEN** a user clicks the Continue button on a session card with attached change `add-user-auth`
- **THEN** the dashboard sends the prompt string `/skill:openspec-continue-change add-user-auth`

#### Scenario: FF button on a session card emits the skill command

- **WHEN** a user clicks the FF button on a session card with attached change `add-user-auth`
- **THEN** the dashboard sends the prompt string `/skill:openspec-ff-change add-user-auth`

#### Scenario: Mobile action menu rows emit skill commands

- **WHEN** a user taps Continue / Fast-Forward / Apply / Verify / Archive in the mobile action menu for an attached change
- **THEN** the dashboard sends the corresponding `/skill:openspec-<verb>-change <change-name>` string

#### Scenario: New Change dialog submits the skill command

- **WHEN** a user submits the New Change dialog with name `add-user-auth` and description `lets users sign in`
- **THEN** the dashboard sends the prompt string `/skill:openspec-new-change add-user-auth\nlets users sign in`

#### Scenario: New Change dialog with only a name

- **WHEN** a user submits the New Change dialog with name `add-user-auth` and no description
- **THEN** the dashboard sends the prompt string `/skill:openspec-new-change add-user-auth`

#### Scenario: New Change dialog with only a description

- **WHEN** a user submits the New Change dialog with no name and description `lets users sign in`
- **THEN** the dashboard sends the prompt string `/skill:openspec-new-change\nlets users sign in`

#### Scenario: New Change dialog with no input

- **WHEN** a user submits the New Change dialog with neither name nor description
- **THEN** the dashboard sends the prompt string `/skill:openspec-new-change`

### Requirement: Explore wiring SHALL remain on the existing skill route

The Explore button and Explore dialog MUST continue to emit `/skill:openspec-explore` (with optional attached change name and trailing user text), matching the implementation present before this change.

#### Scenario: Explore on a session card with attached change

- **WHEN** a user submits the Explore dialog on a session card with attached change `add-user-auth` and text `what does step 3 mean?`
- **THEN** the dashboard sends the prompt string `/skill:openspec-explore add-user-auth\nwhat does step 3 mean?`

#### Scenario: Explore on an unattached session

- **WHEN** a user submits the Explore dialog on a session card with no attached change and text `should we use OAuth?`
- **THEN** the dashboard sends the prompt string `/skill:openspec-explore\nshould we use OAuth?`

### Requirement: Prompt-template fallbacks SHALL remain typeable

The `.pi/prompts/opsx-*.md` prompt templates MUST remain in the repository so that a user can still type `/opsx:apply <change>` (or any other `/opsx:` verb) directly into the chat input and have it expand. This change is frontend-emission-only.

#### Scenario: User types /opsx:apply manually

- **WHEN** a user types `/opsx:apply add-user-auth` in the chat input and submits
- **THEN** the prompt template at `.pi/prompts/opsx-apply.md` is expanded as it was before this change
- **AND** no dashboard button emits that string on the user's behalf

### Requirement: OpenSpec actions are blocked for a change with a CLI error

When the change a session is attached to carries an `error` in `OpenSpecData`, every OpenSpec action surface SHALL treat that change as blocked. The surfaces are:
- `deriveOpenSpecActions`, which feeds the session card's OpenSpec controls and the composer action strip;
- the mobile action menu (`MobileActionMenu`).

A change with an `error` derives to `PLANNING`, because its `artifacts` are empty. Every `PLANNING` candidate that renders under the current workflow configuration SHALL be blocked: Continue and/or Fast-forward, whether as the primary action or as a `⋯` item.

Each surface SHALL use its existing blocked rendering:
- `aria-disabled` and focusable where the surface already renders blocked actions that way (the primary action, the composer strip);
- native `disabled` where the #745 contract keeps it (the card's `⋯` menu, the mobile rows).

Native-disabled items cannot take focus. The session card's OPENSPEC subcard, on desktop and mobile, SHALL therefore show a focusable error badge whose accessible label carries the capped error message.

`ActionSpec` SHALL gain a literal-reason field for the server-supplied message, since `blockedReasonKey` is i18n-only. When the error and the streaming rule both apply, the error message SHALL be the reason shown.

Explore and Detach are not blocked by this rule; the streaming rule still applies to them. This rule SHALL NOT render any action that would not otherwise render, so "No disabled Archive button SHALL render in any state" continues to hold.

#### Scenario: Attached change is broken

- **GIVEN** a session attached to `add-auth`, both `continue` and `ff` workflows enabled, and `add-auth` carries `error: { code: "change_error", message: "Invalid YAML in metadata file" }`
- **WHEN** the session card, the composer strip and the mobile action menu render
- **THEN** the primary Continue SHALL be blocked on every surface, and the Fast-forward item SHALL be blocked wherever it renders
- **AND** the OPENSPEC subcard SHALL show a focusable error badge whose accessible label contains the message
- **AND** Explore and Detach SHALL not be blocked by this rule
- **AND** no Archive button SHALL render

#### Scenario: Continue workflow disabled

- **GIVEN** the `continue` workflow is disabled, so Fast-forward is the `PLANNING` primary
- **WHEN** the attached change carries an `error`
- **THEN** the Fast-forward primary SHALL be blocked with the message as reason
- **AND** no Continue control SHALL render

#### Scenario: Error clears

- **WHEN** a later `openspec_update` delivers `add-auth` without `error`
- **THEN** the badge SHALL disappear and the actions SHALL return to their normal state-derived behaviour
