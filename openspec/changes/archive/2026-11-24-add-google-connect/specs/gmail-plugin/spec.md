## REMOVED Requirements

### Requirement: Guided OAuth client setup
**Reason**: OAuth client setup moves to Google Connect, where several organisation clients can exist and the setup covers every Google product.
**Migration**: google-connect "Own client setup wizard", "Named own OAuth clients", "Client selection when adding an account"; the existing client is imported as `gmail-legacy`.

### Requirement: Gmail setup wizard shows step progress and actionable errors
**Reason**: The wizard moves to Google Connect.
**Migration**: google-connect "Own client setup wizard" keeps step chips, `aria-current="step"` and actionable errors.

### Requirement: Multi-account sign-in
**Reason**: Account sign-in is owned by Google Connect for every product.
**Migration**: google-connect "Multiple Google accounts", "Connect dialog", "Sign-in keeps tokens on the dashboard".

### Requirement: Revoke account
**Reason**: Disconnect is owned by Google Connect and no longer revokes at Google by default (one revoke ends access for every dashboard using the same app).
**Migration**: google-connect "Disconnect account".

### Requirement: Settings section is readable and guarded
**Reason**: Account and client management leave the Gmail settings section.
**Migration**: google-connect "Google accounts section is readable and guarded" and "Google accounts section states the access model".

## ADDED Requirements

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
