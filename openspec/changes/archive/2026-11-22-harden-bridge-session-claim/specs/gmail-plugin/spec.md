## MODIFIED Requirements

### Requirement: Server-held refresh tokens and leases
Refresh tokens SHALL remain in the dashboard server process and its credential store. Tools SHALL obtain short-lived access tokens per account and operation from the server. The server SHALL refuse a lease above the account's level. When a grant is no longer valid, the server SHALL mark the account as needing re-authentication and refuse leases for it. Lease and account-listing requests SHALL be served only to hub-local sessions; a remote-origin session SHALL be refused with `origin_denied`.

#### Scenario: Tool never receives a refresh token
- **WHEN** a tool obtains a lease
- **THEN** the reply contains an access token and expiry, and no refresh token

#### Scenario: Revoked grant surfaces re-auth
- **WHEN** Google rejects the refresh token
- **THEN** the account shows "Re-auth needed" (the settings status pill, `data-status="reauth_required"`) and tool calls for it fail with a re-auth error

#### Scenario: Any session sees the same accounts
- **WHEN** two hub-local pi sessions on the same dashboard lease the same account
- **THEN** both succeed within the account's level (accounts are user-global)

#### Scenario: Concurrent refresh is single-flight
- **WHEN** two tools need a refreshed token for the same account at the same time
- **THEN** exactly one refresh request is sent to Google

#### Scenario: Remote-origin session cannot lease
- **WHEN** a session whose bridge was admitted as a paired device requests `gmail/lease` or `gmail/accounts`
- **THEN** the reply SHALL be an `origin_denied` failure and no token or account SHALL be returned

### Requirement: Account-scoped tools
The account-listing tool SHALL take no account and SHALL return aliases, emails, levels and statuses without marking them untrusted, for hub-local sessions only (remote: `origin_denied`). Every other Gmail tool SHALL require an explicit account (alias or email), and there SHALL be no implicit default. An unknown or ambiguous account SHALL fail with an error listing the known accounts. Results containing mailbox content SHALL declare themselves untrusted.

#### Scenario: Accounts can be discovered without naming one
- **WHEN** `gmail_accounts` is called from a hub-local session
- **THEN** it lists every connected account and its level, and the result is not marked untrusted

#### Scenario: Ambiguous email requires an alias
- **WHEN** two connected accounts report the same email and a tool names that email
- **THEN** the call fails and asks for an alias

#### Scenario: Missing account rejected
- **WHEN** a Gmail tool is called without an account
- **THEN** it fails and lists the connected accounts

#### Scenario: Reads marked untrusted
- **WHEN** `gmail_get` returns a message
- **THEN** the result declares itself untrusted

#### Scenario: A remote-origin session cannot list accounts
- **WHEN** `gmail_accounts` is called from a session whose bridge was admitted as a paired device
- **THEN** the call fails with `origin_denied` and no account, email or level is returned

### Requirement: Settings section is readable and guarded
The Gmail settings section SHALL take every color from declared dashboard theme tokens so borders, status badges and errors render correctly in every named theme in light and dark mode; information text (labels, help, hints) SHALL use `--text-primary` or `--text-secondary`, never `--text-muted`. Account status SHALL be distinguishable by color and text: a severity pill reading "Connected" for `ok` and "Re-auth needed" for `reauth_required`, keeping `data-testid="gmail-account-status"` and its `data-status` value. Every interactive control SHALL show a visible keyboard focus indicator, and each account row SHALL name its controls after the account ("Alias for <email>", "Level for <email>", "Filters for <email>", "Revoke <email>"). Saving an alias SHALL report success or failure. The level choices SHALL each describe what the level allows, and the section SHALL keep stating that levels are enforced by the plugin rather than by Google and that any hub-local dashboard session can use every account within its level while remote-origin sessions cannot lease. The labelled inputs (project id, owner account, client upload, new account level) SHALL use the shared settings field components (`settings-panel`), the project id and owner account fields SHALL each carry a hint (what the value is and where to find it), and their validation errors SHALL be linked to the input by `aria-describedby`. "Add account" SHALL be the section's one primary button; while it is disabled, a text reason SHALL be shown and linked by `aria-describedby`. The add-account control SHALL state that accounts outside the project's Workspace organization need an External audience.

#### Scenario: Undeclared theme token rejected
- **WHEN** the section's source references a color custom property not declared by the dashboard theme
- **THEN** the repository's theme-token check fails

#### Scenario: Alias saved feedback
- **WHEN** the user edits an alias and leaves the field
- **THEN** the section reports that the alias was saved, or shows the reason it was not

#### Scenario: Scope limit still stated
- **WHEN** the user views the accounts list
- **THEN** the section states that levels are enforced by the plugin, not by Google, and that any hub-local dashboard session can use every account within its level, and that remote-origin sessions cannot lease

#### Scenario: Status is text, not colour alone
- **WHEN** one account is `ok` and one is `reauth_required`
- **THEN** their status pills read "Connected" and "Re-auth needed", with `data-status` `ok` and `reauth_required`

#### Scenario: Disabled Add account explains itself
- **WHEN** no OAuth client is configured
- **THEN** "Add account" is disabled and its `aria-describedby` points at visible text saying when it becomes available

#### Scenario: Field error is announced with its input
- **WHEN** the project id field shows a validation error
- **THEN** the input's `aria-describedby` references the visible error text
