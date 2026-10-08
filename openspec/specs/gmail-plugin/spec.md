# gmail-plugin Specification

## Purpose
Let pi agents work with multiple Gmail accounts safely: guided OAuth client setup, per-account sign-in and permission levels, server-held refresh tokens with short-lived leases, and account-scoped tools whose writes are human-confirmed.

## Requirements

### Requirement: Guided OAuth client setup
The plugin settings SHALL present a setup wizard that:
- provides copyable commands to create a Google Cloud project and enable the Gmail API;
- links directly to the branding, audience and client-creation pages for the user's project;
- explains the audience choice: Internal only when every account to be connected belongs to the project's Workspace organization, otherwise External with each account listed as a test user;
- accepts an uploaded OAuth client JSON file;
- runs a test sign-in.

The plugin SHALL NOT execute cloud CLI commands. An uploaded client SHALL be accepted only if it is a Desktop (installed) client with a client id and secret.

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

### Requirement: Multi-account sign-in
The plugin SHALL let the user add any number of Google accounts through the host OAuth flow, using the loopback redirect with a pasted-redirect fallback. Each account SHALL be identified by the provider-verified subject and shown with its verified email. Signing in again with an existing account SHALL update that account rather than create a duplicate.

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

### Requirement: Per-account permission levels
Each account SHALL have exactly one level:
- `readonly` allows read operations;
- `draft` additionally allows creating drafts;
- `send` additionally allows sending, replying, label changes, archive and trash.

Raising a level SHALL require a new consent requesting the full access of the new level. Lowering a level SHALL take effect immediately without re-consent. The plugin SHALL refuse to lease a token for, or execute, any tool operation above the account's level. Levels are enforced by the plugin's lease and tools; the access token itself carries the scopes Google granted. The settings panel SHALL state this limit.

#### Scenario: Send refused on readonly account
- **WHEN** a tool attempts to send from an account at `readonly`
- **THEN** the call fails with a level-denied error and nothing is sent

#### Scenario: Lowering takes effect immediately
- **WHEN** the user lowers an account from `send` to `readonly`
- **THEN** the next send attempt from that account is refused without any sign-in

### Requirement: Server-held refresh tokens and leases
Refresh tokens SHALL remain in the dashboard server process and its credential store. Tools SHALL obtain short-lived access tokens per account and operation from the server. The server SHALL refuse a lease above the account's level. When a grant is no longer valid, the server SHALL mark the account as needing re-authentication and refuse leases for it.

#### Scenario: Tool never receives a refresh token
- **WHEN** a tool obtains a lease
- **THEN** the reply contains an access token and expiry, and no refresh token

#### Scenario: Revoked grant surfaces re-auth
- **WHEN** Google rejects the refresh token
- **THEN** the account shows "re-auth needed" and tool calls for it fail with a re-auth error

#### Scenario: Any session sees the same accounts
- **WHEN** two pi sessions on the same dashboard lease the same account
- **THEN** both succeed within the account's level (accounts are user-global)

#### Scenario: Concurrent refresh is single-flight
- **WHEN** two tools need a refreshed token for the same account at the same time
- **THEN** exactly one refresh request is sent to Google

### Requirement: Account-scoped tools
The account-listing tool SHALL take no account and SHALL return aliases, emails, levels and statuses without marking them untrusted. Every other Gmail tool SHALL require an explicit account (alias or email), and there SHALL be no implicit default. An unknown or ambiguous account SHALL fail with an error listing the known accounts. Results containing mailbox content SHALL declare themselves untrusted.

#### Scenario: Accounts can be discovered without naming one
- **WHEN** `gmail_accounts` is called
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

### Requirement: Confirmed writes
Every write operation (draft, send, reply, modify, trash) SHALL ask the user to confirm, showing the account, recipients or targets, subject and a body preview. The operation SHALL be blocked when no interactive UI is available. A denial, dismissal or confirmation timeout SHALL leave the mailbox unchanged.

#### Scenario: Denied send
- **WHEN** the user denies the confirmation for `gmail_send`
- **THEN** no message is sent and the tool reports the denial

#### Scenario: Headless write blocked
- **WHEN** `gmail_trash` is called in a session without an interactive UI
- **THEN** the call is blocked

#### Scenario: Reply threads correctly
- **WHEN** a confirmed `gmail_reply` is sent to a message
- **THEN** the sent message is in the same Gmail thread as the original

### Requirement: Attachment saving stays in the workspace
Saving an attachment SHALL only write inside the session's working directory, after resolving symbolic links. Paths resolving outside it SHALL be refused, and an existing file SHALL NOT be overwritten.

#### Scenario: Traversal refused
- **WHEN** a tool is asked to save an attachment to `../../.ssh/x`
- **THEN** the call fails and nothing is written

#### Scenario: Symlink escape refused
- **WHEN** the target directory inside the working directory is a symbolic link to a location outside it
- **THEN** the call fails and nothing is written

### Requirement: Revoke account
Revoking an account SHALL require an explicit confirmation in the UI before any request is sent. Revoking SHALL attempt token revocation at Google and SHALL delete the local record even if revocation fails. The UI SHALL state whether remote revocation succeeded.

#### Scenario: Offline revoke
- **WHEN** the user confirms revoking an account while Google is unreachable
- **THEN** the local record is deleted and the UI reports that remote revocation must be done manually

#### Scenario: Revoke not confirmed
- **WHEN** the user clicks Revoke and does not confirm
- **THEN** no revoke request is sent and the account remains listed

### Requirement: Secrets never logged
Tokens, client secrets, authorization codes and pasted redirect URLs SHALL NOT appear in server or bridge logs or in tool results. A failed sign-in SHALL be logged exactly once, as a warning carrying only a fixed, input-free error code; an error without such a code SHALL be logged with a generic code.

#### Scenario: Lease logging
- **WHEN** a lease is issued
- **THEN** the log records account email, operation and outcome only

#### Scenario: Failed sign-in logged
- **WHEN** a sign-in fails (Google error redirect, token exchange failure, scope missing, account mismatch, timeout, cancel, or the flow failing to start)
- **THEN** the server log records one warning with a fixed error code
- **AND** the log line contains no token, authorization code, client secret, URL or email

### Requirement: Settings section is readable and guarded
The Gmail settings section SHALL take every color from declared dashboard theme tokens so borders, status badges and errors render correctly in every named theme in light and dark mode. Account status (ok / re-auth needed) SHALL be distinguishable by color and text. Every interactive control SHALL show a visible keyboard focus indicator. Saving an alias SHALL report success or failure. The level choices SHALL each describe what the level allows, and the section SHALL keep stating that levels are enforced by the plugin rather than by Google and that any dashboard session can use every account within its level. The add-account control SHALL state that accounts outside the project's Workspace organization need an External audience.

#### Scenario: Undeclared theme token rejected
- **WHEN** the section's source references a color custom property not declared by the dashboard theme
- **THEN** the repository's theme-token check fails

#### Scenario: Alias saved feedback
- **WHEN** the user edits an alias and leaves the field
- **THEN** the section reports that the alias was saved, or shows the reason it was not

#### Scenario: Scope limit still stated
- **WHEN** the user views the accounts list
- **THEN** the section states that levels are enforced by the plugin, not by Google, and that any dashboard session can use every account within its level

### Requirement: Actionable Gmail API errors
When the Gmail API answers HTTP 403, a Gmail tool SHALL classify the failure from Google's machine-readable error reason only and SHALL NOT echo Google's free-text message. A disabled Gmail API SHALL fail with code `api_disabled` and a message naming the Google Cloud project number and the command or console page that enables the Gmail API. A token lacking the required Gmail scope SHALL fail with code `scope_insufficient` and tell the user to re-authenticate the account with every permission granted. Any other 403, or a 403 whose body cannot be parsed, SHALL keep failing with the generic `gmail_error` code. The project number SHALL be included only when it consists of digits; otherwise the `api_disabled` message SHALL omit it.

#### Scenario: Gmail API disabled on the project
- **WHEN** a Gmail tool call returns 403 with reason `SERVICE_DISABLED` for consumer `projects/603220229616`
- **THEN** the tool fails with code `api_disabled`
- **AND** the message names project `603220229616` and how to enable the Gmail API

#### Scenario: Token lacks the Gmail scope
- **WHEN** a Gmail tool call returns 403 with reason `ACCESS_TOKEN_SCOPE_INSUFFICIENT`
- **THEN** the tool fails with code `scope_insufficient` and tells the user to re-authenticate with every permission granted

#### Scenario: API disabled with an unusable project reference
- **WHEN** a Gmail tool call returns 403 with reason `SERVICE_DISABLED` and a consumer that is not `projects/<digits>`
- **THEN** the tool fails with code `api_disabled` and the message contains no project reference from the response

#### Scenario: Unknown or malformed 403
- **WHEN** a Gmail tool call returns 403 with an unknown reason, a non-JSON body, or a body whose fields have unexpected types
- **THEN** the tool fails with code `gmail_error` and the message contains none of the response body text
