# google-connect Specification

## Purpose
Google Connect is the dashboard's single owner of Google OAuth clients, connected Google accounts, their grants and short-lived access-token leases, shared by every Google product integration (Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks, Contacts).

## Requirements

### Requirement: Built-in pi-dashboard.dev app
The plugin SHALL ship an optional built-in Google app owned by pi-dashboard.dev as two Google Cloud projects with the same branding: a local project with a Desktop client and every product scope, and an optional remote project with a Web client whose only redirect is `https://pi-dashboard.dev/oauth/return.html` and whose consent screen declares no restricted scopes. With `PI_GOOGLE_DEFAULT_CLIENTS=off` the built-in app SHALL be unavailable for every browser.

#### Scenario: Built-in app not shipped
- **WHEN** the built-in app is absent
- **THEN** connecting requires an own OAuth client

#### Scenario: Operator disables the built-in app
- **WHEN** the server runs with `PI_GOOGLE_DEFAULT_CLIENTS=off`
- **THEN** no built-in sign-in is offered, and leases for built-in accounts fail with `default_client_unavailable`

### Requirement: Built-in app client per browser
For a browser on the dashboard host the built-in app SHALL use the local project; for any other browser it SHALL use the remote project and is available only when the remote project is shipped and `PI_GOOGLE_REMOTE_RETURN` is not `off`. When the built-in app is unavailable for the browser, the connect dialog SHALL NOT offer it. The switches SHALL gate new sign-ins only, except `PI_GOOGLE_DEFAULT_CLIENTS=off`.

#### Scenario: Remote return switched off
- **WHEN** the server runs with `PI_GOOGLE_REMOTE_RETURN=off` and the connect dialog is opened through a tunnel
- **THEN** the built-in app is not offered, and existing built-in accounts keep refreshing

### Requirement: Built-in app requests no full-Drive access
The built-in app SHALL offer Drive only at level "files" (files the user picked or the agent created); Drive "read" and "write" levels SHALL require an own OAuth client.

#### Scenario: Drive read with the built-in app
- **WHEN** a built-in account opens the Drive level choice
- **THEN** "Read all" and "Read and change all" are disabled with the reason "needs your organisation's own sign-in"

### Requirement: Named own OAuth clients
The user SHALL be able to add any number of own OAuth clients ("organisation sign-in"), each with a unique id, an editable label, a type (Desktop or Web) and an optional list of email domains. An upload with an existing client id SHALL update that client; any other upload SHALL add a new client and never replace another one.

#### Scenario: Two organisation clients side by side
- **WHEN** the user adds "BlackBelt" with domain `blackbelt.hu` and "Semmi" with domain `semmi.se`
- **THEN** both are listed with their labels, domains and account counts

#### Scenario: Web client accepted with its redirect shown
- **WHEN** the user adds a Web client
- **THEN** the settings show the exact redirect URI to register in Google Cloud, built from the dashboard's public address

### Requirement: Own client domains are unambiguous
An email domain SHALL be linked to at most one own client. Domains SHALL be compared case-insensitively and exactly, without suffix matching; a client MAY list several domains.

#### Scenario: Duplicate domain refused
- **WHEN** the user links `semmi.se` to a second client
- **THEN** the change is refused with `domain_taken` naming the client that owns it

### Requirement: Own client in use cannot be removed
Removing an own client, or replacing its client id, SHALL be refused with `client_in_use` while any account references it.

#### Scenario: Remove used client
- **WHEN** the user removes client "BlackBelt" while `a@blackbelt.hu` uses it
- **THEN** the removal is refused with `client_in_use`

### Requirement: Own client setup wizard
"Add organisation sign-in" SHALL offer the guided Google Cloud setup wizard and the automatic setup (see gmail-auto-setup) for the client being added. The wizard SHALL keep its project-id and owner-account fields, copyable commands, console deep links, audience and publishing guidance, numbered step chips and actionable errors as before, with the differences below.

#### Scenario: Enable command covers every product
- **WHEN** the wizard shows the enable command for project `acme-pi`
- **THEN** it enables `gmail calendar-json drive docs sheets slides tasks people` APIs for `acme-pi`

### Requirement: Own client setup covers every product and every client
The wizard's enable command and links SHALL cover the Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks and People APIs; its project id and owner account SHALL belong to the client being set up; an uploaded client JSON SHALL be accepted as Desktop (`installed`) or Web (`web`).

#### Scenario: Second organisation does not report a mismatch
- **WHEN** client "BlackBelt" exists for project `bb-pi` and the user sets up a new client for project `semmi-pi`
- **THEN** no project-id mismatch is reported

### Requirement: Client selection when adding an account
When adding an account, the client SHALL be chosen in this order: the client named in the request; the own client linked to the email's domain; the built-in app when available for this browser. Otherwise the request SHALL fail with `client_required` and the dialog SHALL list the clients to pick from.

#### Scenario: Work email picks the organisation client
- **WHEN** an own client "Semmi" links `semmi.se` and the user types `robson@semmi.se` in the connect dialog's work email field
- **THEN** the sign-in starts with Semmi's client and `login_hint=robson@semmi.se`

#### Scenario: Several own clients and no match
- **WHEN** the built-in app is unavailable, an own client exists, and the email's domain matches no own client
- **THEN** the request fails with `client_required`

### Requirement: Connect dialog
Adding an account SHALL happen in a modal dialog with one screen: product checkboxes (read level to start), three short data-use lines with a privacy-policy link, and "Continue with Google". While no own client exists and the built-in app is available, the dialog SHALL show no email or client field and Google's own account chooser SHALL pick the account.

#### Scenario: Casual user connects another Google account
- **WHEN** two accounts are connected, the built-in app is available, and the user clicks "Connect another Google account", ticks Gmail and Drive and picks `someone@gmail.com` on Google's page
- **THEN** a third account is listed with Gmail at read level and Drive at files level, without any email or client input in the dashboard

### Requirement: Connect dialog waits for Google
While Google's page is open, the connect dialog SHALL show a waiting state with the pasted-redirect fallback folded away, then the result.

#### Scenario: Paste fallback
- **WHEN** the user opens the fold-out and pastes the address from the browser after Google finishes
- **THEN** the dialog shows the connected account

### Requirement: Organisation sign-in is advanced
Own OAuth clients SHALL be managed only in a section "Advanced: organisation sign-in" that is collapsed by default. Accounts signed in with the built-in app SHALL show no client name. Otherwise the connect dialog SHALL show "Sign in with" (default: the built-in app when available) and an optional work email field.

#### Scenario: No organisation set up
- **WHEN** no own client exists
- **THEN** the page shows no client names and the connect dialog shows no client choice

#### Scenario: Organisation set up
- **WHEN** own client "BlackBelt" links `blackbelt.hu`
- **THEN** the connect dialog shows "Sign in with" and a work email field, and `team-pi@blackbelt.hu` shows "organisation sign-in: BlackBelt"

### Requirement: Accounts bound to one client
Each account SHALL be bound to the built-in app or to exactly one own client, SHALL be identified by Google's verified subject, and SHALL hold one grant that records the exact client id that issued it; refresh SHALL use that client id. A sign-in for an existing account SHALL return the same subject, otherwise it SHALL fail with `account_mismatch` and change nothing.

#### Scenario: Same person, two organisations
- **WHEN** `r@blackbelt.hu` is bound to "BlackBelt" and `r@semmi.se` to "Semmi"
- **THEN** each account's leases use its own client id

#### Scenario: Built-in account connected remotely later refreshed
- **WHEN** a built-in account was connected through the pi-dashboard.dev return page and is refreshed while the user browses locally
- **THEN** its refresh uses the remote project's Web client id

### Requirement: Accounts do not switch clients silently
A connect for an existing account through a different client, including between the built-in local and remote projects, SHALL fail with `client_mismatch` and change nothing. Consent for an existing account SHALL run on its own client; an account of the built-in local project SHALL need a browser on the dashboard host for consent.

#### Scenario: Organisation client added later
- **WHEN** `r@semmi.se` is connected with the built-in app and the user connects it again with organisation client "Semmi"
- **THEN** the connect fails with `client_mismatch` telling the user to disconnect it first

### Requirement: Products enabled per account
Each account SHALL have a per-product setting for gmail, calendar, drive, docs, sheets, slides, tasks and contacts: off, or on at a product level. Leases SHALL be refused with `product_disabled` for a product that is off and with `level_insufficient` for an operation above the level.

#### Scenario: Calendar off
- **WHEN** a tool requests a Calendar lease for an account with Calendar off
- **THEN** the lease fails with `product_disabled`

### Requirement: Incremental consent
Turning a product on or raising its level SHALL apply immediately when the account's grant already covers the required scopes; otherwise it SHALL start a consent on the account's client that requests the union of granted and required scopes. The new level SHALL apply only when Google's reply covers it, else it SHALL fail with `scope_missing` and keep the previous level. Lowering a level SHALL NOT require consent.

#### Scenario: Turn on Calendar for a Gmail account
- **WHEN** `a@x.com` has Gmail and the user turns on Calendar read
- **THEN** a consent starts with `login_hint=a@x.com`, and on success Gmail keeps working without a new sign-in

#### Scenario: Permission left unticked on an existing account
- **WHEN** the user completes consent without granting the Calendar permission
- **THEN** Calendar stays off and the account shows `scope_missing` for Calendar

### Requirement: A narrower reply changes nothing
A consent reply that does not cover every scope the account's current products and options rely on SHALL count as not granted and leave the stored account unchanged.

#### Scenario: Gmail unticked while turning on Calendar
- **WHEN** the user turns on Calendar and unticks Gmail on Google's page
- **THEN** the stored account is unchanged, Gmail keeps working, and Calendar stays off with the permission-not-granted guidance

### Requirement: Partial grants on a new connect
On a new connect, products Google did not grant SHALL stay off with `scope_missing`, and the account SHALL be stored when at least one requested product was granted; when none was granted the account SHALL NOT be stored.

#### Scenario: Drive granted, Gmail not
- **WHEN** a new connect asks for Gmail and Drive and Google grants only Drive
- **THEN** the account is stored with Drive on and Gmail off with `scope_missing`

### Requirement: Product changes reuse the connect dialog
Turning a product on or raising a level that needs new Google permissions SHALL open the connect dialog for that account, prefilled with its current products.

#### Scenario: Add Slides to a connected account
- **WHEN** the user sets Slides to Read on `robson@semmi.se`
- **THEN** the dialog opens for that account with Slides ticked

### Requirement: Server-held tokens and leases
Refresh tokens SHALL remain in the dashboard server's credential store. Tools SHALL receive only an access token, its expiry, the account email and the product level. Concurrent refreshes of the same account SHALL send one request to Google. A rejected refresh token SHALL mark the account as needing a new sign-in. Lease and account-listing requests SHALL be served only to hub-local sessions; others SHALL get `origin_denied`.

#### Scenario: Tool never receives a refresh token
- **WHEN** a tool obtains a lease
- **THEN** the reply contains no refresh token

#### Scenario: Remote-origin session cannot lease
- **WHEN** a paired-device session requests `google/lease`
- **THEN** the reply is `origin_denied`

### Requirement: Sign-in keeps tokens on the dashboard
Every sign-in SHALL use PKCE, state and nonce and require a verified email. Token exchange and token storage SHALL happen only on the dashboard server; tokens and Google data SHALL NOT be stored or exchanged on any pi-dashboard.dev server. A pasted-redirect fallback SHALL always be offered.

#### Scenario: Same-machine dashboard
- **WHEN** the request comes from a loopback peer without forwarding headers
- **THEN** Google returns to the dashboard's loopback address and the sign-in completes without paste

#### Scenario: Same-host tunnel counts as remote
- **WHEN** a connect request arrives from `127.0.0.1` with an `X-Forwarded-For` header
- **THEN** the loopback path is not chosen

### Requirement: Remote built-in sign-in through the return page
When the browser is not on the dashboard host and the built-in Web client is available and `PI_GOOGLE_REMOTE_RETURN` is not `off`, built-in sign-in SHALL always force Google's consent screen, return to the static page `https://pi-dashboard.dev/oauth/return.html`, which SHALL show the target dashboard address and, only after the user confirms that address, open the dashboard's remote callback in the same window with the code and state.

#### Scenario: Remote dashboard through a tunnel
- **WHEN** the dashboard runs on a server reached through a tunnel and the user allows access and confirms the dashboard address on the return page
- **THEN** the window closes and the dialog shows the account as connected, without paste

#### Scenario: Electron opens Google in the system browser
- **WHEN** the Electron app connects to a remote dashboard and Google opens in the system browser
- **THEN** after confirmation the system browser opens the dashboard's remote callback and the Electron dialog shows the account as connected

#### Scenario: Dashboard address unreachable from the browser
- **WHEN** the browser cannot open the dashboard's remote callback
- **THEN** the return page offers to copy the address and the dialog accepts it in the paste fallback

### Requirement: Dashboard accepts returned codes only for its own sign-ins
The dashboard's remote callback SHALL accept a code only with a state of a pending sign-in it started; any other request SHALL be refused with `invalid_state` and change nothing. The callback SHALL NOT require a dashboard session.

#### Scenario: Forged callback ignored
- **WHEN** a request reaches the remote callback with a state the dashboard did not issue
- **THEN** the response is 400 `invalid_state` and the waiting sign-in is unchanged

### Requirement: Return page carries no restricted access
Sign-ins through the return page SHALL NOT request restricted scopes, and the remote project SHALL declare none, so a request through its public client cannot obtain them silently: Gmail and Drive "read"/"write" SHALL be unavailable for them and SHALL say they need the dashboard opened on its own computer or an organisation sign-in.

#### Scenario: Gmail on a remote built-in sign-in
- **WHEN** the connect dialog is opened through a tunnel with the built-in app
- **THEN** Gmail is shown unavailable with that reason and is not requested from Google

### Requirement: Return page keeps the code out of sight
The return page SHALL be static, load no third-party script, send no referrer, and remove the code from the address bar before showing anything.

#### Scenario: Code removed from the address bar
- **WHEN** the return page has loaded
- **THEN** its address no longer contains the code

### Requirement: Remote sign-in with an own Web client
For an own Web client, the authorization redirect SHALL be the dashboard's own callback under its public base address (resolved like dashboard login), so Google returns straight to the dashboard without the return page or paste.

#### Scenario: Organisation server deployment
- **WHEN** the dashboard runs at `https://pi.blackbelt.hu` with an own Web client registered for `https://pi.blackbelt.hu/api/plugins/google/oauth/callback`
- **THEN** a remote user connects without paste and no request reaches pi-dashboard.dev

### Requirement: Data-use disclosure before built-in sign-in
Before a built-in sign-in, the connect dialog SHALL show three data-use lines and a privacy-policy link: where the sign-in goes, that content the agent reads goes to the configured AI model provider only to answer the user, and that every change asks first. "Continue with Google" SHALL record acceptance of the current disclosure version.

#### Scenario: Disclosure shown in the dialog
- **WHEN** the user opens the connect dialog with the built-in app
- **THEN** the three data-use lines and the privacy-policy link are shown above "Continue with Google"

### Requirement: Disclosure states the actual return path
For a local browser the first line SHALL say the sign-in stays on this computer and nothing is sent to pi-dashboard.dev; for the return page it SHALL say Google returns once through pi-dashboard.dev's return page, which stores nothing, and the sign-in is kept only on this dashboard.

#### Scenario: Remote disclosure
- **WHEN** the connect dialog is opened through a tunnel with the built-in app
- **THEN** the first line names the pi-dashboard.dev return page

### Requirement: Server enforces disclosure acceptance
The server SHALL refuse a built-in sign-in or consent with `disclosure_required` until the current disclosure version is accepted. A newer disclosure version SHALL require acceptance again. Own-client sign-in SHALL NOT be gated.

#### Scenario: Stale acceptance
- **WHEN** the accepted version is older than the shipped version
- **THEN** a built-in consent fails with `disclosure_required`

#### Scenario: Sign in again after a disclosure update
- **WHEN** an account needs "Sign in again" and the disclosure version changed
- **THEN** the connect dialog shows the updated disclosure and "Continue with Google" accepts it and starts the sign-in

### Requirement: Google accounts page
Settings SHALL contain a "Google accounts" section listing each connected account (email, alias, products summary, status) with an expandable table of products and levels, one primary "Connect a Google account" / "Connect another Google account" button, and the collapsed organisation section.

#### Scenario: Account row shows products
- **WHEN** `a@x.com` has Gmail at send and Drive at files
- **THEN** its summary reads "Gmail · Drive" and its table shows the other products off

### Requirement: Workspace blocks are actionable
When the user reports `admin_policy_enforced` or `org_internal` during a sign-in, the dialog SHALL show the client id that was used, explain that the organisation's admin blocks the app or that an Internal client admits only its organisation, and offer to set up organisation sign-in for that email domain.

#### Scenario: Built-in app blocked by admin
- **WHEN** `admin_policy_enforced` is reported for `x@blackbelt.hu` on the built-in app
- **THEN** the dialog shows the built-in client id and "Set up organisation sign-in"

### Requirement: Disconnect account
Disconnecting an account SHALL require confirmation and delete the account locally. Removing access at Google SHALL be a separate explicit option that states it ends access for every dashboard that uses the same app for this Google account; when the Google call fails the local data SHALL still be deleted and the user told to remove access at `myaccount.google.com/connections`.

#### Scenario: Local disconnect
- **WHEN** the user disconnects without "Also remove access at Google"
- **THEN** no revoke request is sent and the account disappears locally

#### Scenario: Revoke while Google is unreachable
- **WHEN** the user confirms "Also remove access at Google" while Google is unreachable
- **THEN** the account is deleted locally and the user is told to remove access manually

### Requirement: Legacy Gmail data import
Google Connect SHALL import a legacy Gmail client and accounts without re-consent: the client becomes own client `gmail-legacy` of type Desktop, each account is bound to it with its existing grant and client id, and Gmail is on at the account's previous level and filter option. Each account SHALL be imported at most once (a disconnected account is never imported again) and SHALL never overwrite an existing account; accounts added to Gmail's data later SHALL be imported on the next import.

#### Scenario: Upgrade keeps Gmail working
- **WHEN** a dashboard with two Gmail accounts upgrades
- **THEN** both accounts appear in Google accounts and Gmail tools work without sign-in

### Requirement: Secrets never logged
Client secrets, refresh and access tokens, authorization codes and PKCE verifiers SHALL NOT appear in logs, REST responses or settings payloads. Sign-in, refresh and lease log lines SHALL include the client reference, return path, product and result code.

#### Scenario: Refresh log
- **WHEN** a refresh fails
- **THEN** the log line names the client reference and result code and contains no token

### Requirement: Google API errors are actionable
When a Google API answers 403, tools SHALL classify it from the machine-readable reason only: a disabled API SHALL fail with `api_disabled` naming the API, the numeric project when available and how to enable it; a missing scope SHALL fail with `scope_insufficient` and point to the product level in Google accounts. 429 and 5xx SHALL be retried at most three times with backoff honouring `Retry-After`.

#### Scenario: Sheets API disabled in an own project
- **WHEN** a Sheets call returns 403 `SERVICE_DISABLED` for `sheets.googleapis.com`
- **THEN** the tool fails with `api_disabled` and names `sheets.googleapis.com` and how to enable it

### Requirement: Google accounts section is readable and guarded
The section SHALL take every colour from declared dashboard theme tokens, use `--text-primary` or `--text-secondary` for information text, show status as text pills ("Connected", "Sign in again") with `data-status`, give every control a visible focus indicator and an accessible name that includes the account, and explain every disabled action with visible text referenced by `aria-describedby`.

#### Scenario: Sign in again needed
- **WHEN** an account's grant is `reauth_required`
- **THEN** its pill reads "Sign in again" with `data-status="reauth_required"` and a "Sign in again" action

### Requirement: Google accounts section states the access model
The section SHALL state that product levels are enforced by the dashboard, not by Google, that every hub-local session can use every account within its levels, and that remote-origin sessions cannot.

#### Scenario: Access model visible
- **WHEN** the user expands an account
- **THEN** the access-model statement is shown with its product table

### Requirement: Multiple Google accounts
The user SHALL be able to connect any number of Google accounts. Connecting an account that is already connected SHALL update it in place (alias, products and product options kept). Parallel connects SHALL not cancel each other. A sign-in whose identity token reports an unverified email SHALL fail and store nothing. An email given with a connect request SHALL be passed as `login_hint`; an email that is not an email address or longer than 254 characters SHALL be refused with 400.

#### Scenario: Reconnect updates in place
- **WHEN** the user connects `a@x.com` again
- **THEN** the account keeps its alias and no duplicate entry appears

#### Scenario: Parallel connects
- **WHEN** the user starts two connects in parallel
- **THEN** both can complete

#### Scenario: Unverified email refused
- **WHEN** the identity token reports an unverified email
- **THEN** the sign-in fails and no account is stored

### Requirement: Full store is explained
When the credential store has no room for another account or client, the action SHALL fail with `too_many_keys` and tell the user to remove unused accounts or clients.

#### Scenario: Store full
- **WHEN** the store holds its maximum number of entries and the user connects another account
- **THEN** the connect fails with `too_many_keys` and the dialog names the fix

### Requirement: Consent for a local built-in account needs the local browser
Changing products or signing in again for an account of the built-in local project from a browser that is not on the dashboard host SHALL be refused with `local_browser_required` and SHALL tell the user to open the dashboard on its own computer.

#### Scenario: Remote product change on a local account
- **WHEN** `robson.csakany@gmail.com` was connected locally and the user turns on Sheets from a browser reached through a tunnel
- **THEN** the dialog says to open the dashboard on its own computer and no consent starts

### Requirement: Disconnected accounts stay disconnected
A disconnected account SHALL NOT be restored by any later import of legacy Gmail data.

#### Scenario: Disconnect a migrated account
- **WHEN** the user disconnects an account that was imported from Gmail and the server restarts
- **THEN** the account stays disconnected
