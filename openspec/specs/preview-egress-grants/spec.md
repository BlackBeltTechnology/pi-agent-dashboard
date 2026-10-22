# preview-egress-grants Specification

## Purpose
Controls which external origins a served preview may use and whether its scripts run. Agent-opened previews start restricted, show the operator what was blocked, and widen only through an explicit allow-once, a "Run scripts" click, or a reviewable per-project grant.

## Requirements

### Requirement: Egress policy is fixed by provenance

A live-server preview opened by an operator action SHALL load external subresources without restriction. Operator actions are: a click in the file tree, the in-page preview overlay opened by a click, Expand on a preview card that itself has operator provenance, a linkified loopback URL, the canvas file chip, the canvas tool card, or a route-backed overlay URL (`/pi-view`, `/folder/<cwd>/view`) carrying a navigation intent that verifies for its route and target. Every other open SHALL be restricted, including canvas auto-open, the confirm-chip tap for an agent-declared server or URL, agent preview cards, a route-backed overlay URL without a verifying navigation intent, and any surface declaring no provenance. The policy SHALL be bound to the capability so no URL edit can widen it.

#### Scenario: Manual open loads a CDN

- **GIVEN** a local `.html` that loads `https://cdn.tailwindcss.com`
- **WHEN** the user clicks it in the file tree
- **THEN** the CDN script loads and the page renders styled

#### Scenario: Auto-open blocks an ungranted CDN

- **GIVEN** the same file and no grant for `https://cdn.tailwindcss.com`
- **WHEN** the canvas auto-opens it
- **THEN** the CDN request is blocked by the preview's content security policy

#### Scenario: Agent-declared dev server is restricted

- **GIVEN** the agent declares `http://localhost:54321/` whose page loads `https://unpkg.com/x.js`
- **WHEN** the user taps its confirm chip
- **THEN** the unpkg request is blocked and listed in the banner

#### Scenario: Chip tap is an operator open

- **GIVEN** the mobile canvas chip for an agent-written `.html`
- **WHEN** the user taps it
- **THEN** the preview opens with the open policy

#### Scenario: Editing the URL cannot widen egress

- **GIVEN** an auto-opened restricted preview
- **WHEN** the frame URL's path or query is changed
- **THEN** the same restricted policy still applies

#### Scenario: Crafted overlay link stays restricted

- **GIVEN** a `/folder/<cwd>/view?path=page.html` link with no navigation intent, opened from outside the dashboard
- **WHEN** the overlay renders the page, which loads `https://unpkg.com/x.js`
- **THEN** the unpkg request is blocked

#### Scenario: Reloaded operator overlay keeps the open policy

- **GIVEN** the operator opened `page.html` in the route-backed overlay through the UI, so the URL carries a verifying intent
- **WHEN** the page is reloaded within the intent lifetime
- **THEN** the preview opens with the open policy

### Requirement: A preview capability without a valid policy is restricted

A preview capability minted without a valid egress policy SHALL be restricted, and one minted without a scripts flag SHALL be scripts-off for a static target.

#### Scenario: Policy-less mint is restricted

- **WHEN** a capability for a static target is minted with no egress or scripts parameter
- **THEN** its responses carry the restricted policy and the scripts-off sandbox

### Requirement: Restricted previews stay inside their own prefix

A restricted preview SHALL load and fetch only from its own capability prefix, including its live-reload socket, and from origins granted for it. It SHALL NOT load any other dashboard resource, submit forms, rebase URLs, nest frames or open popups.

#### Scenario: Own data loads

- **GIVEN** an auto-opened restricted page whose script fetches `./data.json`
- **WHEN** it runs
- **THEN** the fetch succeeds

#### Scenario: Dashboard API not loadable

- **GIVEN** an auto-opened restricted page containing `<script src="/api/sessions">` and `<img src="/assets/logo.svg">`
- **WHEN** it renders
- **THEN** neither request is made

#### Scenario: Form to an external host blocked

- **GIVEN** an auto-opened restricted page whose form posts to `https://example.org/collect`
- **WHEN** the form is submitted
- **THEN** the submission is blocked

### Requirement: The dashboard determines whether it is exposed

The dashboard SHALL treat itself as exposed when it is bound to a non-loopback or unparseable address, has any tunnel, public base URL or TLS endpoint, has received a request carrying forwarding headers since start, or is configured as exposed. Otherwise it is local-only.

#### Scenario: Forwarded request makes it exposed

- **GIVEN** a loopback-bound dashboard with no tunnel
- **WHEN** a request carrying `X-Forwarded-For` arrives
- **THEN** the dashboard reports itself exposed until restart

### Requirement: Scripts on restricted previews depend on exposure

When exposed, the server SHALL refuse scripts for a restricted preview unless the operator clicked "Run scripts", and the viewer SHALL render it without scripts and offer that action. Scripted restricted previews minted while local-only SHALL stop loading when the dashboard becomes exposed, and the server SHALL notify connected browsers so open viewers re-open them without scripts.

#### Scenario: Local-only auto-open runs scripts

- **GIVEN** the dashboard bound to `127.0.0.1` with no tunnel, public URL or TLS endpoint
- **WHEN** the canvas auto-opens a page whose script renders its content
- **THEN** the content renders

#### Scenario: LAN bind counts as exposed

- **GIVEN** the dashboard bound to `0.0.0.0` with no tunnel
- **WHEN** the canvas auto-opens the same page
- **THEN** it renders without scripts and offers "Run scripts"

#### Scenario: Run scripts on an exposed dashboard

- **GIVEN** an active tunnel and an auto-opened page rendered without scripts
- **WHEN** the user clicks "Run scripts"
- **THEN** the script runs and external origins remain restricted

#### Scenario: Server refuses scripts without the operator action

- **GIVEN** an exposed dashboard
- **WHEN** a restricted capability is minted with scripts but without the run-scripts marker
- **THEN** the minted capability is scripts-off

#### Scenario: Tunnel start revokes scripted restricted previews

- **GIVEN** a local-only scripted auto-opened preview that is open
- **WHEN** a tunnel starts
- **THEN** that preview's capability stops admitting requests
- **AND** within 2 seconds the viewer, notified by the server over its browser connection, re-opens it without scripts

### Requirement: Blocked external origins are detected in markup

For a restricted preview, the dashboard SHALL report the external origins referenced by `src`, `href`, `srcset`, `poster` and `data` attributes and by inline-style or stylesheet `url()` and `@import`, in canonical form and labelled as found in markup. A truncated or failed scan SHALL show that some resources may be blocked.

#### Scenario: Markup reference detected

- **GIVEN** an auto-opened page with `<link rel="stylesheet" href="https://unpkg.com/x.css">`
- **WHEN** the preview opens
- **THEN** `https://unpkg.com` is listed as blocked, labelled as found in markup

### Requirement: Runtime-blocked origins are reported where the browser delivers reports

Where the browser delivers violation reports, the dashboard SHALL add the blocked origins, labelled as reported by the page. The per-preview set SHALL be bounded and SHALL never evict markup-detected or granted entries. Without a runtime channel the viewer SHALL show that some resources may be blocked.

#### Scenario: Script-inserted load detected at runtime

- **GIVEN** an auto-opened scripted page that inserts `<img src="https://images.example.com/a.png">` in a browser that delivers violation reports
- **WHEN** the browser blocks that load
- **THEN** `https://images.example.com` is added, labelled as reported by the page

#### Scenario: Oversized or flooding reports are refused

- **WHEN** a preview's report endpoint receives a body larger than 64 KiB
- **THEN** it answers 413 and the blocked list is unchanged

#### Scenario: Report flood is rate limited

- **WHEN** a preview's report endpoint receives more than 20 reports in a second or more than 600 in an hour
- **THEN** the excess is answered 429 and the blocked list is not grown by it

#### Scenario: Reports never log the capability

- **WHEN** a report whose document URL contains the capability is received
- **THEN** no log line contains the capability token

### Requirement: Egress state is visible only to the preview's owner

Reading a preview's blocked origins and adding an allow-once origin SHALL require the control tier and SHALL be accepted only from the principal that minted the preview's capability. An allow-once origin SHALL apply only to the viewer that allowed it.

#### Scenario: Another device cannot widen a preview

- **GIVEN** a preview minted by device A
- **WHEN** device B, with control tier, posts an allow-once for that preview
- **THEN** the request is refused

#### Scenario: Allow once stays in its viewer

- **GIVEN** the same file open in two tabs, and an origin allowed once in the first
- **WHEN** the second tab reloads
- **THEN** the origin is still blocked in the second tab

### Requirement: The viewer offers non-modal enablement for blocked origins

When a restricted preview has blocked origins, the viewer SHALL show a non-modal banner listing them, with "Allow once" per grantable origin and, for markup-detected origins when access prompting is enabled, "Allow for this project". When prompting is disabled the banner SHALL say that project grants need access prompts. Origins on well-known shared hosting domains SHALL carry a warning. The auto-open SHALL raise no dialog. After an allow, the frame SHALL reload with the origin permitted.

#### Scenario: Allow once

- **GIVEN** the banner lists `https://cdn.tailwindcss.com`
- **WHEN** the user clicks "Allow once"
- **THEN** the frame reloads and the CDN loads
- **AND** no grant is persisted and the Access page lists nothing new

#### Scenario: Allow once survives a re-mint

- **GIVEN** an origin allowed once in an open viewer
- **WHEN** the viewer re-mints its capability before expiry
- **THEN** the origin is still allowed in that viewer

#### Scenario: Auto-open never prompts

- **WHEN** the canvas auto-opens a page with blocked origins
- **THEN** only the in-viewer banner appears and no access-grant dialog is raised

#### Scenario: Page-reported origin cannot become a project grant

- **GIVEN** an origin known only from a runtime report
- **WHEN** the banner renders it
- **THEN** it offers "Allow once" and no project grant

#### Scenario: Prompting disabled

- **GIVEN** access prompting is disabled
- **WHEN** the banner renders
- **THEN** it offers "Allow once" only and states that project grants need access prompts

#### Scenario: Shared hosting flagged

- **GIVEN** a blocked origin `https://someone.github.io`
- **WHEN** the banner renders
- **THEN** that row carries the shared-hosting warning

### Requirement: Project egress grants use the preview-egress access plane

On the operator's click on "Allow for this project", the dashboard SHALL record a pending deferred request on a `preview-egress` plane for the canonical origin and raise the standard access-grant dialog with verdicts allow-always or deny, subject to the registry's capacity and rate limits. An allow SHALL apply to the session's project: its git common root, else its cwd.

#### Scenario: Project grant persists across previews

- **GIVEN** the user allowed `https://cdn.tailwindcss.com` for project `/p`
- **WHEN** any later auto-opened preview under `/p` loads that CDN
- **THEN** it loads without a banner entry for that origin

#### Scenario: Grant is scoped to its project

- **GIVEN** the same grant for `/p`
- **WHEN** a preview under project `/q` loads that CDN on auto-open
- **THEN** it is blocked and listed in the banner

### Requirement: Project egress grants are stored safely outside the repository

Preview-egress grants SHALL be persisted in a dashboard-owned store separate from the main configuration and never in repository files, and concurrent writes SHALL NOT lose a grant.

#### Scenario: Concurrent grants both persist

- **WHEN** grants for `/p` and `/q` are allowed at the same moment as an unrelated settings save
- **THEN** both grants are present afterwards

### Requirement: Only public https origins are grantable

The origins listed below SHALL be ungrantable. No allow control SHALL be offered for them, and any allow naming them SHALL be refused:

- non-https origins;
- `localhost` and `*.localhost`;
- IP literals in any form denoting loopback, unspecified, private, link-local, shared-address or unique-local space;
- single-label hosts;
- `.local`, `.internal`, `.lan` and `.home.arpa` hosts;
- hosts with a label embedding an IPv4 address.

#### Scenario: Private address not offered

- **GIVEN** an auto-opened page referencing `http://192.168.1.10/x.js`
- **WHEN** the banner renders
- **THEN** the origin is listed as blocked without allow controls

#### Scenario: Forged allow refused

- **WHEN** an allow-once or allow-always request names `https://localhost:8000`, `https://app.localhost`, `https://[::ffff:127.0.0.1]` or `https://127-0-0-1.example.io`
- **THEN** the server refuses it and the policy is unchanged

### Requirement: Grant-time checks refuse private resolutions and the dashboard's own origins

An allow SHALL also be refused when the host resolves at grant time to a loopback, private, link-local, shared-address or unique-local address, when resolution fails or exceeds 3 seconds, or when the origin is one the dashboard treats as its own.

#### Scenario: Name resolving to a private address refused

- **GIVEN** `https://intranet.example.com` resolves to `10.1.2.3`
- **WHEN** an allow-always is requested for it
- **THEN** the server refuses it

#### Scenario: Unverifiable name refused

- **GIVEN** DNS resolution of `https://cdn.example.org` fails or takes longer than 3 seconds
- **WHEN** an allow-always is requested for it
- **THEN** the server refuses it and the dialog shows "Could not verify this origin; try again"

#### Scenario: Dashboard tunnel origin refused

- **GIVEN** the dashboard is reachable at an active tunnel origin
- **WHEN** an allow-always is requested for that origin
- **THEN** the server refuses it

### Requirement: Egress subjects are canonical origins

A preview-egress subject SHALL be the origin of an `https` URL without user information, with any trailing host dot removed, the host in ASCII form, and a default port omitted, so detection, grant and policy name the same subject.

#### Scenario: Equivalent spellings are one subject

- **WHEN** `https://CDN.Example.com.:443/x` is granted
- **THEN** the stored subject is `https://cdn.example.com`
