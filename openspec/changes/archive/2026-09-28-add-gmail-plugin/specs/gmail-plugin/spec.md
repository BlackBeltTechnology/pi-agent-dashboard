## Purpose

Let pi agents work with multiple Gmail accounts safely: guided OAuth client setup, per-account sign-in and permission levels, server-held refresh tokens with short-lived leases, and account-scoped tools whose writes are human-confirmed.

## ADDED Requirements

### Requirement: Guided OAuth client setup
The plugin settings SHALL present a setup wizard that:
- provides copyable commands to create a Google Cloud project and enable the Gmail API;
- links directly to the branding, audience and client-creation pages for the user's project;
- accepts an uploaded OAuth client JSON file;
- runs a test sign-in.

The plugin SHALL NOT execute cloud CLI commands. An uploaded client SHALL be accepted only if it is a Desktop (installed) client with a client id and secret.

#### Scenario: Web client rejected
- **WHEN** the user uploads a client JSON containing a `web` block instead of `installed`
- **THEN** the upload is rejected with guidance to create a Desktop app client

#### Scenario: Test sign-in failure maps to a fix
- **WHEN** the test sign-in fails because the user is not an allowed test user
- **THEN** the wizard points the user to the audience step and the test-users setting

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
Revoking an account SHALL attempt token revocation at Google and SHALL delete the local record even if revocation fails. The UI SHALL state whether remote revocation succeeded.

#### Scenario: Offline revoke
- **WHEN** the user revokes an account while Google is unreachable
- **THEN** the local record is deleted and the UI reports that remote revocation must be done manually

### Requirement: Secrets never logged
Tokens, client secrets, authorization codes and pasted redirect URLs SHALL NOT appear in server or bridge logs or in tool results.

#### Scenario: Lease logging
- **WHEN** a lease is issued
- **THEN** the log records account email, operation and outcome only
