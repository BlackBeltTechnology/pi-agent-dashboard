# gmail-plugin Specification

## Purpose
Let pi agents work with multiple Gmail accounts safely: guided OAuth client setup, per-account sign-in and permission levels, server-held refresh tokens with short-lived leases, and account-scoped tools whose writes are human-confirmed.

## Requirements

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

### Requirement: Attachment saving stays in the workspace
Saving an attachment SHALL only write inside the session's working directory, after resolving symbolic links. Paths resolving outside it SHALL be refused, and an existing file SHALL NOT be overwritten.

#### Scenario: Traversal refused
- **WHEN** a tool is asked to save an attachment to `../../.ssh/x`
- **THEN** the call fails and nothing is written

#### Scenario: Symlink escape refused
- **WHEN** the target directory inside the working directory is a symbolic link to a location outside it
- **THEN** the call fails and nothing is written

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

### Requirement: Opt-in Gmail filter management
Each account SHALL have a filters option, off by default and independent of its permission level. Turning it on SHALL require a new consent for the level's scopes plus `gmail.settings.basic`, unless the grant already covers both; a grant lacking either SHALL count as the Gmail permission not granted and SHALL NOT change the stored account. Turning it off SHALL take effect immediately. "Add account" for an existing account SHALL NOT change its filters option.

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

### Requirement: Filter permission survives re-authentication and level raises
Re-authentication and level raises of an account with the filters option on SHALL request the filter permission again; lowering a level never re-consents. A grant without the filter permission SHALL be treated as the Gmail permission not being granted and SHALL leave the stored account unchanged.

#### Scenario: Re-auth without filter permission
- **WHEN** an account with filters on is re-authenticated and the grant lacks `gmail.settings.basic`
- **THEN** the stored account keeps its previous scopes, level, filters option and status, and the settings show the permission-not-granted guidance

### Requirement: Filter operations are gated before confirmation
The server SHALL refuse a filter lease for an account whose filters option is off. The filter tools SHALL refuse a call for such an account, and a filter write below level `send`, before asking for confirmation or contacting Google.

#### Scenario: Create below send refused
- **WHEN** the agent asks to create a filter on an account at `draft` with filters on
- **THEN** the call fails with a level-denied error, no confirmation is asked and no filter is created

### Requirement: Gmail filter tools
Three tools SHALL manage filters, each requiring an explicit account:
- `gmail_filters_list` lists the account's filters (filters option on, any level) and marks its result untrusted;
- `gmail_filter_create` creates a filter (filters option on, level `send`);
- `gmail_filter_delete` deletes a filter by id (filters option on, level `send`).

Create and delete are confirmed writes; the delete confirmation SHALL show the criteria and actions of the filter being deleted.

#### Scenario: Archive rule becomes a filter after confirmation
- **WHEN** the agent asks to create a filter from `newsletter@example.com` that removes `INBOX` on an account at `send` with filters on, and the user confirms
- **THEN** the filter is created in that account and the tool returns its id

#### Scenario: Filter list is untrusted
- **WHEN** filters are listed for an account with filters on
- **THEN** the result declares itself untrusted

#### Scenario: Delete confirmation shows the rule
- **WHEN** the agent asks to delete a filter by id on an account at `send` with filters on
- **THEN** the confirmation shows that filter's criteria and actions before anything is deleted

#### Scenario: Headless filter write blocked
- **WHEN** a filter create is called in a session without an interactive UI
- **THEN** the call is blocked

### Requirement: Filter create requests are allow-listed
A create request SHALL carry at least one criterion whose value is non-empty after trimming and is not `*`, and at least one action. Criteria SHALL be limited to sender, recipient, subject, query, negated query and has-attachment; actions SHALL be limited to adding or removing label ids, including archiving by removing `INBOX`. Adding `TRASH` or `SPAM` and any other field or value, including any forwarding action, SHALL be refused before any confirmation or request to Google.

#### Scenario: Forwarding filter refused
- **WHEN** the agent asks to create a filter with a forwarding action
- **THEN** the call fails without contacting Google and without asking for confirmation

#### Scenario: Unsafe or malformed filter refused
- **WHEN** the agent asks to create a filter with an unsupported criteria key, no criteria, only blank or `*` criteria, no action, or an action adding `TRASH` or `SPAM`
- **THEN** the call fails without contacting Google and without asking for confirmation

### Requirement: Gmail accounts come from Google Connect
When Google Connect is usable, Gmail accounts, OAuth clients, refresh tokens and sign-in SHALL be owned by it. A Gmail account SHALL be a Google Connect account with Gmail on, its Gmail permission level and filter option being the product's level and option. Gmail tools SHALL obtain tokens for such accounts through the `google` plugin's lease lane after the Gmail lease lane answers with a delegation. Gmail tool names, level and filter enforcement SHALL stay unchanged.

#### Scenario: Gmail tools after the move
- **WHEN** `a@x.com` has Gmail at level draft in Google accounts
- **THEN** `gmail_accounts` lists it and `gmail_send` is refused as above its level

### Requirement: Google Connect refusals reach Gmail tools as Gmail errors
For product Gmail, Google Connect lease refusals SHALL use Gmail's existing codes and messages (level, filters, re-authentication, origin), plus: Gmail off → "Gmail is off for <email> in Settings → Google accounts"; built-in app or client unavailable → the existing `no_client` message.

#### Scenario: Gmail turned off
- **WHEN** Gmail is off for `a@x.com` and `gmail_search` runs for it
- **THEN** the tool fails with "Gmail is off for a@x.com in Settings → Google accounts"

### Requirement: Gmail works without Google Connect
Gmail SHALL NOT require Google Connect to load. It SHALL use Google Connect only when an entry `google.connect` provided by the plugin `google` exists; otherwise it SHALL lease from its own stored data as before. Turning the `google` plugin on or off SHALL take effect after a server restart.

#### Scenario: Google plugin disabled
- **WHEN** the `google` plugin is disabled after migration
- **THEN** Gmail tools keep working from the Gmail plugin's own stored data

#### Scenario: Spoofed service ignored
- **WHEN** another plugin provides `google.connect`
- **THEN** Gmail ignores it

### Requirement: Gmail settings point to Google accounts
While Google Connect is usable, the Gmail settings section SHALL show a notice linking to Settings → Google accounts and Gmail's own account, client and setup REST routes SHALL answer `410` with error `moved`. While it is not usable, the section SHALL say to turn on Google accounts to manage Gmail accounts and those routes SHALL answer `503` with error `google_connect_unavailable`; Gmail tools keep working.

#### Scenario: Old route after migration
- **WHEN** a client calls `PUT /api/plugins/gmail/client` after migration
- **THEN** the response is 410 `moved` and nothing is stored

#### Scenario: Google accounts turned off
- **WHEN** the `google` plugin is disabled and the user opens the Gmail settings
- **THEN** the section says to turn on Google accounts, and `POST /api/plugins/gmail/accounts` answers 503 `google_connect_unavailable`

### Requirement: Legacy Gmail data migrates
On its first request after start while Google Connect is usable, the Gmail plugin SHALL hand its stored client and accounts to Google Connect, record that migration happened, and SHALL NOT delete its stored data. A failed hand-off SHALL be retried on the next start and SHALL leave Gmail tools working from the legacy data until it succeeds.

#### Scenario: Migration retried
- **WHEN** Google Connect refuses the import because its store is locked
- **THEN** Gmail keeps leasing from its own data and retries the import on next start
