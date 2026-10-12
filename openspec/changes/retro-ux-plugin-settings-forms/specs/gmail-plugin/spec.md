## MODIFIED Requirements

### Requirement: Settings section is readable and guarded
The Gmail settings section SHALL take every color from declared dashboard theme tokens so borders, status badges and errors render correctly in every named theme in light and dark mode; information text (labels, help, hints) SHALL use `--text-primary` or `--text-secondary`, never `--text-muted`. Account status SHALL be distinguishable by color and text: a severity pill reading "Connected" for `ok` and "Re-auth needed" for `reauth_required`, keeping `data-testid="gmail-account-status"` and its `data-status` value. Every interactive control SHALL show a visible keyboard focus indicator, and each account row SHALL name its controls after the account ("Alias for <email>", "Level for <email>", "Revoke <email>"). Saving an alias SHALL report success or failure. The level choices SHALL each describe what the level allows, and the section SHALL keep stating that levels are enforced by the plugin rather than by Google and that any dashboard session can use every account within its level. The labelled inputs (project id, client upload, new account level) SHALL use the shared settings field components (`settings-panel`). "Add account" SHALL be the section's one primary button; while it is disabled, a text reason SHALL be shown and linked by `aria-describedby`. The add-account control SHALL state that accounts outside the project's Workspace organization need an External audience.

#### Scenario: Undeclared theme token rejected
- **WHEN** the section's source references a color custom property not declared by the dashboard theme
- **THEN** the repository's theme-token check fails

#### Scenario: Alias saved feedback
- **WHEN** the user edits an alias and leaves the field
- **THEN** the section reports that the alias was saved, or shows the reason it was not

#### Scenario: Scope limit still stated
- **WHEN** the user views the accounts list
- **THEN** the section states that levels are enforced by the plugin, not by Google, and that any dashboard session can use every account within its level

#### Scenario: Status is text, not colour alone
- **WHEN** one account is `ok` and one is `reauth_required`
- **THEN** their status pills read "Connected" and "Re-auth needed", with `data-status` `ok` and `reauth_required`

#### Scenario: Disabled Add account explains itself
- **WHEN** no OAuth client is configured
- **THEN** "Add account" is disabled and its `aria-describedby` points at visible text saying when it becomes available


### Requirement: Server-held refresh tokens and leases
Refresh tokens SHALL remain in the dashboard server process and its credential store. Tools SHALL obtain short-lived access tokens per account and operation from the server. The server SHALL refuse a lease above the account's level. When a grant is no longer valid, the server SHALL mark the account as needing re-authentication and refuse leases for it.

#### Scenario: Tool never receives a refresh token
- **WHEN** a tool obtains a lease
- **THEN** the reply contains an access token and expiry, and no refresh token

#### Scenario: Revoked grant surfaces re-auth
- **WHEN** Google rejects the refresh token
- **THEN** the account shows "Re-auth needed" (the settings status pill, `data-status="reauth_required"`) and tool calls for it fail with a re-auth error

#### Scenario: Any session sees the same accounts
- **WHEN** two pi sessions on the same dashboard lease the same account
- **THEN** both succeed within the account's level (accounts are user-global)

#### Scenario: Concurrent refresh is single-flight
- **WHEN** two tools need a refreshed token for the same account at the same time
- **THEN** exactly one refresh request is sent to Google

## ADDED Requirements

### Requirement: Gmail setup wizard shows step progress and actionable errors
The setup wizard SHALL number its steps with chips. The current step — the step the wizard highlights today, including the audience step it highlights after an `org_internal` report — SHALL carry `aria-current="step"`, and completed steps SHALL show a check. A failed sign-in SHALL render as a severity-error notice that names the cause and the wizard step that fixes it, keeping `gmail-flow-error` with its `data-step` and the error code. The section SHALL pass the contrast, size and focus probes in `{base,dark}`, `{base,light}` and `{nord,dark}` at 375, 768 and 1440 px in these states: loading, load error, not configured, configured with an `ok`, a `reauth_required` and a testing-mode account, client upload error, sign-in waiting, sign-in failed, and alias error. Every existing `gmail-*` test id SHALL still render in its state.

#### Scenario: Current step is marked
- **WHEN** the client is not configured
- **THEN** step 1 has `aria-current="step"` and no step shows a check

#### Scenario: Probes pass in every state
- **WHEN** the capture spec probes each listed state in every listed theme and width
- **THEN** every contrast, size and focus failure list is empty
