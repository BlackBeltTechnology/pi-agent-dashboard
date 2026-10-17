## MODIFIED Requirements

### Requirement: Guided OAuth client setup
The plugin settings SHALL present a setup wizard that:
- provides copyable commands to create a Google Cloud project and enable the Gmail API;
- links directly to the branding, audience and client-creation pages for the user's project;
- explains the audience choice: Internal only when every account to be connected belongs to the project's Workspace organization, otherwise External with each account listed as a test user;
- accepts an uploaded OAuth client JSON file;
- runs a test sign-in.

The plugin SHALL NOT execute cloud CLI commands. When the dedicated agent browser is available, the settings SHALL also offer "Set up automatically" (see gmail-auto-setup); the wizard SHALL accept a hand-off from it that opens a given step with the project id and owner account filled in. An uploaded client SHALL be accepted only if it is a Desktop (installed) client with a client id and secret.

Because Google reports some sign-in errors on its own page without redirecting back, the settings SHALL, while a sign-in is waiting, offer a way to report the error code Google displayed. The selectable codes SHALL be a fixed list (at least `org_internal`, `access_denied`, `admin_policy_enforced`); selecting one SHALL cancel the waiting sign-in and show the plain-language fix for that code, opening the relevant wizard step when the fix is in the wizard. The reported code SHALL remain displayed after the cancelled sign-in settles. Every sign-in error SHALL be shown as a human-readable sentence; an unrecognised error SHALL get a generic sentence, never only a bare code.

While a sign-in is waiting, the Gmail settings SHALL tell the user to grant every requested permission on Google's consent screen, because Google may show the Gmail permission unticked. A sign-in whose grant lacks the level's Gmail permission SHALL be explained as the Gmail permission not being granted, with the instruction to retry and tick it.

When setup is complete and the wizard is collapsed, its summary SHALL identify the configured client (its project when known, otherwise its client id) so the user can find the audience setting again.

#### Scenario: Web client rejected
- **WHEN** the user uploads a client JSON containing a `web` block instead of `installed`
- **THEN** the upload is rejected with guidance to create a Desktop app client

#### Scenario: Test sign-in failure maps to a fix
- **WHEN** the test sign-in fails because the user is not an allowed test user
- **THEN** the wizard points the user to the audience step and the test-users setting

#### Scenario: Account from another Workspace org blocked by Internal audience
- **WHEN** a sign-in is waiting and the user reports that Google showed `org_internal`
- **THEN** the waiting sign-in is cancelled
- **AND** the wizard opens on the audience step with guidance to switch the audience to External and add the account as a test user

#### Scenario: Admin policy blocks the app
- **WHEN** a sign-in is waiting and the user reports that Google showed `admin_policy_enforced`
- **THEN** the waiting sign-in is cancelled
- **AND** the settings explain that the account's Workspace admin must trust the OAuth client, showing the configured client id

#### Scenario: Gmail permission left unticked
- **WHEN** the user completes Google consent without ticking the Gmail permission
- **THEN** no account is stored
- **AND** the settings say the Gmail permission was not granted and ask the user to add the account again with every permission ticked

#### Scenario: Waiting sign-in tells the user to tick every permission
- **WHEN** a sign-in is waiting for the user
- **THEN** the Gmail settings show, next to the sign-in link, that every permission on Google's consent screen must be granted

#### Scenario: Cancel settling does not erase the reported code
- **WHEN** the user reports `org_internal` and the cancelled sign-in then settles as cancelled
- **THEN** the `org_internal` guidance and the highlighted audience step remain shown

#### Scenario: Client without a project id
- **WHEN** setup is complete with a client whose JSON had no project id
- **THEN** the collapsed wizard summary shows the client id

#### Scenario: Audience guidance mentions multiple organizations
- **WHEN** the user views the audience step
- **THEN** it states that Internal only admits accounts of the project's own Workspace organization

#### Scenario: Hand-off opens the wizard at a step

- **WHEN** an automatic setup run ends with `handoff {step: "publish", wizardStep: 3}` for project `pi-dashboard-abc123`
- **THEN** the wizard SHALL be expanded with step 3 carrying `aria-current="step"` and the project id field showing `pi-dashboard-abc123`

### Requirement: Multi-account sign-in
The plugin SHALL let the user add any number of Google accounts through the host OAuth flow, using the loopback redirect with a pasted-redirect fallback. Each account SHALL be identified by the provider-verified subject and shown with its verified email. Adding an account MAY carry an email address; when it does, the authorization request SHALL pass it as `login_hint` so Google preselects that account. When the configured client's audience is External or unknown, the waiting-sign-in notice SHALL also say that Google may show "Google hasn't verified this app" and that the user continues through Advanced. Signing in again with an existing account SHALL update that account rather than create a duplicate.

#### Scenario: Two accounts coexist
- **WHEN** the user signs in with `a@x.com` and then with `b@y.com`
- **THEN** both accounts are listed with their own permission levels

#### Scenario: Parallel additions do not cancel each other
- **WHEN** the user starts adding two accounts in parallel
- **THEN** both sign-ins can complete

#### Scenario: Re-auth updates in place
- **WHEN** the user re-authenticates `a@x.com`
- **THEN** the account keeps its alias and no duplicate entry appears

#### Scenario: Remote dashboard sign-in
- **WHEN** the dashboard runs remotely and the user pastes the redirect URL from the browser's address bar
- **THEN** the account is added

#### Scenario: Unverified email refused
- **WHEN** the identity token reports an unverified email
- **THEN** the sign-in fails and no account is stored

#### Scenario: Add account with an email hint

- **WHEN** the user adds an account entering `robson@semmi.se`
- **THEN** the authorization URL SHALL carry `login_hint=robson@semmi.se`

#### Scenario: Invalid email hint

- **WHEN** `POST /api/plugins/gmail/accounts` carries `email` that is not an email address or longer than 254 characters
- **THEN** the response SHALL be 400 and no sign-in SHALL start

### Requirement: Secrets never logged
Tokens, client secrets, authorization codes and pasted redirect URLs SHALL NOT appear in server or bridge logs, in tool results, or in automatic-setup run views, hand-off reasons or browser audit entries. Any text the automatic setup logs SHALL have `GOCSPX-` secrets masked, and a client JSON it downloads SHALL be deleted after it is read. A failed sign-in SHALL be logged exactly once, as a warning carrying only a fixed, input-free error code; an error without such a code SHALL be logged with a generic code.

#### Scenario: Lease logging
- **WHEN** a lease is issued
- **THEN** the log records account email, operation and outcome only

#### Scenario: Failed sign-in logged
- **WHEN** a sign-in fails (Google error redirect, token exchange failure, scope missing, account mismatch, timeout, cancel, or the flow failing to start)
- **THEN** the server log records one warning with a fixed error code
- **AND** the log line contains no token, authorization code, client secret, URL or email

#### Scenario: Setup run masking

- **WHEN** an automatic setup run fails after the creation dialog showed a secret `GOCSPX-abc`
- **THEN** no log line SHALL contain `GOCSPX-abc` and any logged dialog text SHALL read `GOCSPX-***`

### Requirement: Gmail setup wizard shows step progress and actionable errors
The setup wizard SHALL number its steps with chips. The current step — the step the wizard highlights today, including the audience step it highlights after an `org_internal` report — SHALL carry `aria-current="step"`, and completed steps SHALL show a check. A failed sign-in SHALL render as a severity-error notice that names the cause and the wizard step that fixes it, keeping `gmail-flow-error` with its `data-step` and the error code. The section SHALL pass the contrast, size and focus probes in `{base,dark}`, `{base,light}` and `{nord,dark}` at 375, 768 and 1440 px in these states: loading, load error, not configured, configured with an `ok`, a `reauth_required` and a testing-mode account, client upload error, sign-in waiting, sign-in failed, alias error, and the automatic setup states: entry available, remote note, start form, run in progress, waiting for the user (sign-in and policy checkpoints), audience and links decisions, busy with takeover, and hand-off. Every existing `gmail-*` test id SHALL still render in its state.

#### Scenario: Current step is marked
- **WHEN** the client is not configured
- **THEN** step 1 has `aria-current="step"` and no step shows a check

#### Scenario: Probes pass in every state
- **WHEN** the capture spec probes each listed state in every listed theme and width
- **THEN** every contrast, size and focus failure list is empty
