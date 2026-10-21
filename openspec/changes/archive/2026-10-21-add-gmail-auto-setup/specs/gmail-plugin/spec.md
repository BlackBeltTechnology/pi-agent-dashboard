## MODIFIED Requirements

### Requirement: Guided OAuth client setup
The plugin settings SHALL present a setup wizard that:
- lets the user choose between creating a new Google Cloud project and using an existing one;
- provides copyable commands to create a Google Cloud project (new-project path only), list the account's projects, and enable the Gmail API (both paths), plus, when an owner account is set, a copyable `gcloud auth login <email>` command with the note that it must be run once before the other commands;
- links directly to the branding, audience and client-creation pages for the user's project;
- explains the audience choice: Internal only when every account to be connected belongs to the project's Workspace organization, otherwise External with each account listed as a test user;
- explains publishing: a published app's tokens do not expire after 7 days, an unverified app shows Google's unverified-app warning and admits at most 100 users, and accounts added while the app was in Testing need one re-authentication after publishing;
- accepts an uploaded OAuth client JSON file;
- runs a test sign-in.

The plugin SHALL NOT execute cloud CLI commands. When the dedicated agent browser is available, the settings SHALL also offer "Set up automatically" (see gmail-auto-setup); the wizard SHALL accept a hand-off from it that opens a given step with the project id and owner account filled in. An uploaded client SHALL be accepted only if it is a Desktop (installed) client with a client id and secret.

The project id field SHALL be validated when the user leaves the field; no validation error SHALL be shown while typing, and an error shown after leaving SHALL clear as soon as the value becomes valid. A value that is not a valid Google Cloud project id SHALL show an inline error; a value containing an uppercase letter or a space SHALL instead show an error explaining that the console shows a project *name* while the wizard needs the project *id*, with a link to the console's project list. Project-scoped console links and commands SHALL be offered only for a valid project id; while the id is empty or invalid they SHALL be replaced by a statement that a valid project id is needed, and the commands SHALL NOT be shown with a placeholder.

The wizard SHALL offer an optional owner account (an email address). When set and valid, every console link (including the project-create and project-list links) SHALL carry an `authuser` query parameter set to that email (URL-encoded) and every `gcloud` command other than `gcloud auth login` SHALL carry `--account <email>`, so the console and CLI act as the account that owns the project. An invalid owner account SHALL show an inline error when the user leaves the field and SHALL NOT be applied to links or commands. Links and commands SHALL always reflect the current field values, valid or not, without waiting for the user to leave the field.

The project id and owner account SHALL be saved on the dashboard server when the user leaves the field with a valid value, independently of the client upload; leaving a field empty SHALL clear the saved value. A valid project id typed but not yet saved SHALL be saved before an uploaded client is compared with it. Both values SHALL be restored when the settings are reopened. One project-id rule SHALL apply everywhere: an uploaded client's `project_id` that the rule rejects counts as absent. After a client JSON is uploaded, when the JSON's `project_id` differs from the saved project id, the settings SHALL show the mismatch, naming both ids, and offer to replace the saved id with the JSON's id. When no project id is saved, the JSON's `project_id` SHALL be saved as the project id. When the JSON has no usable `project_id`, no comparison is made. The upload itself SHALL still be accepted, except that replacing the client while accounts are connected stays refused as before.

Because Google reports some sign-in errors on its own page without redirecting back, the settings SHALL, while a sign-in is waiting, offer a way to report the error code Google displayed. The selectable codes SHALL be a fixed list (at least `org_internal`, `access_denied`, `admin_policy_enforced`); selecting one SHALL cancel the waiting sign-in and show the plain-language fix for that code, opening the relevant wizard step when the fix is in the wizard. The reported code SHALL remain displayed after the cancelled sign-in settles. Every sign-in error SHALL be shown as a human-readable sentence; an unrecognised error SHALL get a generic sentence, never only a bare code.

While a sign-in is waiting, the Gmail settings SHALL tell the user that Google shows the Gmail permission in one of two ways — as a checkbox that must be ticked, or on a second screen ("wants additional access") that must be accepted — and that finishing after the first screen only signs in. A sign-in whose grant lacks the level's Gmail permission SHALL be explained as the Gmail permission not being granted, naming both consent shapes and telling the user to remove the app's existing access at `myaccount.google.com/connections` before adding the account again.

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
- **WHEN** the user completes Google consent without granting the Gmail permission
- **THEN** no account is stored
- **AND** the settings say the Gmail permission was not granted, describe both the checkbox and the second-screen consent shapes, and point to `myaccount.google.com/connections` to remove the partial grant before retrying

#### Scenario: Waiting sign-in tells the user to tick every permission
- **WHEN** a sign-in is waiting for the user
- **THEN** the Gmail settings show, next to the sign-in link, that the Gmail permission must be ticked or accepted on Google's second screen, and that the first screen alone only signs in

#### Scenario: Cancel settling does not erase the reported code
- **WHEN** the user reports `org_internal` and the cancelled sign-in then settles as cancelled
- **THEN** the `org_internal` guidance and the highlighted audience step remain shown

#### Scenario: Client without a project id
- **WHEN** setup is complete with a client whose JSON had no project id
- **THEN** the collapsed wizard summary shows the client id

#### Scenario: Audience guidance mentions multiple organizations
- **WHEN** the user views the audience step
- **THEN** it states that Internal only admits accounts of the project's own Workspace organization

#### Scenario: Display name typed instead of project id
- **WHEN** the user types `PiDashboard` into the project id field and leaves it
- **THEN** an inline error explains the difference between project name and project id and links to the console's project list
- **AND** no console link carries `project=PiDashboard` and no `gcloud` command is shown with that value or a placeholder

#### Scenario: Existing project path
- **WHEN** the user chooses "use an existing project"
- **THEN** the create-project link and command are hidden
- **AND** a copyable `gcloud projects list` command and a link to the console's project list are shown

#### Scenario: Owner account applied to links and commands
- **WHEN** the project id is `pidashboard-510015` and the owner account is `csakany.robert@gmail.com`
- **THEN** every console link carries `authuser` = `csakany.robert@gmail.com` and every project-scoped link carries `project` = `pidashboard-510015`
- **AND** every `gcloud` command ends with `--account csakany.robert@gmail.com`
- **AND** a copyable `gcloud auth login csakany.robert@gmail.com` is shown with the note to run it first

#### Scenario: Invalid owner account not applied
- **WHEN** the owner account field contains `robson@` and the user leaves it
- **THEN** an inline error is shown and no link or command carries that value

#### Scenario: Project id saved before upload
- **WHEN** the user enters a valid project id, leaves the field, and reopens the settings without uploading a client
- **THEN** the project id field shows the saved id

#### Scenario: Uploaded client from another project
- **WHEN** no account is connected, the saved project id is `pidashboard-510015`, and the user uploads a client JSON whose `project_id` is `other-project-123`
- **THEN** the client is accepted
- **AND** the settings show that the two ids differ, naming both, and offer to use `other-project-123`

#### Scenario: Uploaded client adopted when no id was saved
- **WHEN** no project id is saved and the user uploads a client JSON whose `project_id` is `pidashboard-510015`
- **THEN** `pidashboard-510015` is saved as the project id and no mismatch is shown

#### Scenario: Publishing guidance
- **WHEN** the user views the audience step
- **THEN** it states that publishing removes the 7-day token expiry, that an unverified app shows a warning and admits at most 100 users, and that accounts added during Testing need one re-authentication after publishing

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
The setup wizard SHALL number its steps with chips. The current step — the step the wizard highlights today, including the audience step it highlights after an `org_internal` report — SHALL carry `aria-current="step"`, and completed steps SHALL show a check. A failed sign-in SHALL render as a severity-error notice that names the cause and the wizard step that fixes it, keeping `gmail-flow-error` with its `data-step` and the error code. An invalid project id and a project-id mismatch after upload SHALL each render as an actionable notice in step 1 that says what to change, with test ids `gmail-project-error` and `gmail-project-mismatch` respectively. The section SHALL pass the contrast, size and focus probes in `{base,dark}`, `{base,light}` and `{nord,dark}` at 375, 768 and 1440 px in these states: loading, load error, not configured, invalid project id, project-id mismatch, configured with an `ok`, a `reauth_required` and a testing-mode account, client upload error, sign-in waiting, sign-in failed, alias error, and the automatic setup states: entry available, remote note, start form, run in progress, waiting for the user (sign-in and policy checkpoints), audience and links decisions, busy with takeover, and hand-off. Every existing `gmail-*` test id SHALL still render in its state.

#### Scenario: Current step is marked
- **WHEN** the client is not configured
- **THEN** step 1 has `aria-current="step"` and no step shows a check

#### Scenario: Probes pass in every state
- **WHEN** the capture spec probes each listed state in every listed theme and width
- **THEN** every contrast, size and focus failure list is empty

#### Scenario: Project id mismatch is actionable
- **WHEN** the uploaded client's project id differs from the saved one
- **THEN** step 1 shows a notice naming both ids with a control that replaces the saved id with the client's id

