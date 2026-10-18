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

The plugin SHALL NOT execute cloud CLI commands. An uploaded client SHALL be accepted only if it is a Desktop (installed) client with a client id and secret.

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

### Requirement: Settings section is readable and guarded
The Gmail settings section SHALL take every color from declared dashboard theme tokens so borders, status badges and errors render correctly in every named theme in light and dark mode; information text (labels, help, hints) SHALL use `--text-primary` or `--text-secondary`, never `--text-muted`. Account status SHALL be distinguishable by color and text: a severity pill reading "Connected" for `ok` and "Re-auth needed" for `reauth_required`, keeping `data-testid="gmail-account-status"` and its `data-status` value. Every interactive control SHALL show a visible keyboard focus indicator, and each account row SHALL name its controls after the account ("Alias for <email>", "Level for <email>", "Filters for <email>", "Revoke <email>"). Saving an alias SHALL report success or failure. The level choices SHALL each describe what the level allows, and the section SHALL keep stating that levels are enforced by the plugin rather than by Google and that any dashboard session can use every account within its level. The labelled inputs (project id, owner account, client upload, new account level) SHALL use the shared settings field components (`settings-panel`), the project id and owner account fields SHALL each carry a hint (what the value is and where to find it), and their validation errors SHALL be linked to the input by `aria-describedby`. "Add account" SHALL be the section's one primary button; while it is disabled, a text reason SHALL be shown and linked by `aria-describedby`. The add-account control SHALL state that accounts outside the project's Workspace organization need an External audience.

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

#### Scenario: Field error is announced with its input
- **WHEN** the project id field shows a validation error
- **THEN** the input's `aria-describedby` references the visible error text

### Requirement: Gmail setup wizard shows step progress and actionable errors
The setup wizard SHALL number its steps with chips. The current step — the step the wizard highlights today, including the audience step it highlights after an `org_internal` report — SHALL carry `aria-current="step"`, and completed steps SHALL show a check. A failed sign-in SHALL render as a severity-error notice that names the cause and the wizard step that fixes it, keeping `gmail-flow-error` with its `data-step` and the error code. An invalid project id and a project-id mismatch after upload SHALL each render as an actionable notice in step 1 that says what to change, with test ids `gmail-project-error` and `gmail-project-mismatch` respectively. The section SHALL pass the contrast, size and focus probes in `{base,dark}`, `{base,light}` and `{nord,dark}` at 375, 768 and 1440 px in these states: loading, load error, not configured, invalid project id, project-id mismatch, configured with an `ok`, a `reauth_required` and a testing-mode account, client upload error, sign-in waiting, sign-in failed, and alias error. Every existing `gmail-*` test id SHALL still render in its state.

#### Scenario: Current step is marked
- **WHEN** the client is not configured
- **THEN** step 1 has `aria-current="step"` and no step shows a check

#### Scenario: Probes pass in every state
- **WHEN** the capture spec probes each listed state in every listed theme and width
- **THEN** every contrast, size and focus failure list is empty

#### Scenario: Project id mismatch is actionable
- **WHEN** the uploaded client's project id differs from the saved one
- **THEN** step 1 shows a notice naming both ids with a control that replaces the saved id with the client's id

### Requirement: Per-account permission levels
Each account SHALL have exactly one level:
- `readonly` allows read operations;
- `draft` additionally allows creating drafts;
- `send` additionally allows sending, replying, label changes, archive and trash.

Independently of its level, each account SHALL have a filters option (off by default) that gates filter management as defined in "Opt-in Gmail filter management"; filter writes additionally require level `send`.

Raising a level SHALL require a new consent requesting the full access of the new level, plus the filter permission when the account's filters option is on. Lowering a level SHALL take effect immediately without re-consent, whatever the account's status and filters option. The plugin SHALL refuse to lease a token for, or execute, any tool operation above the account's level, and any filter operation while the filters option is off. Levels are enforced by the plugin's lease and tools; the access token itself carries the scopes Google granted. The settings panel SHALL state this limit.

#### Scenario: Send refused on readonly account
- **WHEN** a tool attempts to send from an account at `readonly`
- **THEN** the call fails with a level-denied error and nothing is sent

#### Scenario: Lowering takes effect immediately
- **WHEN** the user lowers an account from `send` to `readonly`
- **THEN** the next send attempt from that account is refused without any sign-in

#### Scenario: Lowering a re-auth-needed account
- **WHEN** the user lowers an account in `reauth_required` from `send` to `readonly`
- **THEN** the level changes without any sign-in and the account stays `reauth_required`

#### Scenario: Raising keeps filters
- **WHEN** the user raises an account with filters on from `readonly` to `send` and its grant does not already cover `send`
- **THEN** the consent requests the `send` scopes plus `gmail.settings.basic`
- **AND** after a grant covering both, the account is at `send` with filters still on

### Requirement: Confirmed writes
Every write operation (draft, send, reply, modify, trash, filter create, filter delete) SHALL ask the user to confirm. A message write SHALL show the account, recipients or targets, subject and a body preview; a label change or trash SHALL show the account and its targets; a filter create or delete SHALL show the account, the filter's exact criteria and actions, and that the filter applies to all future matching mail. The operation SHALL be blocked when no interactive UI is available. A denial, dismissal or confirmation timeout SHALL leave the mailbox unchanged.

#### Scenario: Denied send
- **WHEN** the user denies the confirmation for `gmail_send`
- **THEN** no message is sent and the tool reports the denial

#### Scenario: Headless write blocked
- **WHEN** `gmail_trash` is called in a session without an interactive UI
- **THEN** the call is blocked

#### Scenario: Reply threads correctly
- **WHEN** a confirmed `gmail_reply` is sent to a message
- **THEN** the sent message is in the same Gmail thread as the original

#### Scenario: Denied filter create
- **WHEN** the user denies the confirmation for a filter create
- **THEN** no filter is created and the tool reports the denial

## ADDED Requirements

### Requirement: Opt-in Gmail filter management
Each account SHALL have a filters option, off by default and independent of its permission level. Turning it on SHALL require a new consent requesting the account level's scopes plus `gmail.settings.basic`, unless the account's grant already covers both; a grant that lacks either SHALL be treated as the Gmail permission not being granted and SHALL NOT change the stored account. Turning it off SHALL take effect immediately without re-consent. Re-authentication and level raises of an account with the filters option on SHALL request the filter permission again (lowering never re-consents); a grant without it SHALL be treated the same way and SHALL leave the stored account unchanged. The server SHALL refuse a filter lease for an account whose filters option is off, and the filter tools SHALL refuse such a call, and a filter write below level `send`, before asking for confirmation or contacting Google. Signing in again through "Add account" with an existing account SHALL NOT change its filters option.

Three tools SHALL manage filters, each requiring an explicit account:
- `gmail_filters_list` lists the account's filters (filters option on, any level) and marks its result untrusted;
- `gmail_filter_create` creates a filter (filters option on, level `send`);
- `gmail_filter_delete` deletes a filter by id (filters option on, level `send`).

A create request SHALL carry at least one criterion whose value is non-empty after trimming and is not `*`, and at least one action. Criteria SHALL be limited to sender, recipient, subject, query, negated query and has-attachment; actions SHALL be limited to adding or removing label ids, including archiving by removing `INBOX`. Adding the `TRASH` or `SPAM` label SHALL be refused. A request carrying any other field or value — including any forwarding action — SHALL be refused before any confirmation or request to Google. Create and delete are confirmed writes: the delete confirmation SHALL show the criteria and actions of the filter being deleted.

#### Scenario: Filters off by default
- **WHEN** an account is added
- **THEN** its filters option is off and a filter tool call for it fails with a filters-disabled error without asking for confirmation

#### Scenario: Enabling filters asks for consent
- **WHEN** the user turns on filters for an account at `send` whose grant lacks `gmail.settings.basic`
- **THEN** a sign-in starts requesting the `send` scopes plus `gmail.settings.basic`
- **AND** the option is stored as on only after a grant that covers both

#### Scenario: Settings scope not granted
- **WHEN** the consent for enabling filters returns without `gmail.settings.basic`
- **THEN** the account keeps its previous filters option and level and the settings show the permission-not-granted guidance

#### Scenario: Disabling filters is immediate
- **WHEN** the user turns filters off for an account
- **THEN** the next filter tool call for that account is refused without any sign-in

#### Scenario: Archive rule becomes a filter after confirmation
- **WHEN** the agent asks to create a filter from `newsletter@example.com` that removes `INBOX` on an account at `send` with filters on, and the user confirms
- **THEN** the filter is created in that account and the tool returns its id

#### Scenario: Forwarding filter refused
- **WHEN** the agent asks to create a filter with a forwarding action
- **THEN** the call fails without contacting Google and without asking for confirmation

#### Scenario: Unsafe or malformed filter refused
- **WHEN** the agent asks to create a filter with an unsupported criteria key, no criteria, only blank or `*` criteria, no action, or an action adding `TRASH` or `SPAM`
- **THEN** the call fails without contacting Google and without asking for confirmation

#### Scenario: Delete confirmation shows the rule
- **WHEN** the agent asks to delete a filter by id on an account at `send` with filters on
- **THEN** the confirmation shows that filter's criteria and actions before anything is deleted

#### Scenario: Re-auth without filter permission
- **WHEN** an account with filters on is re-authenticated and the grant lacks `gmail.settings.basic`
- **THEN** the stored account keeps its previous scopes, level, filters option and status, and the settings show the permission-not-granted guidance

#### Scenario: Filter list is untrusted
- **WHEN** filters are listed for an account with filters on
- **THEN** the result declares itself untrusted

#### Scenario: Create below send refused
- **WHEN** the agent asks to create a filter on an account at `draft` with filters on
- **THEN** the call fails with a level-denied error, no confirmation is asked and no filter is created

#### Scenario: Headless filter write blocked
- **WHEN** a filter create is called in a session without an interactive UI
- **THEN** the call is blocked
