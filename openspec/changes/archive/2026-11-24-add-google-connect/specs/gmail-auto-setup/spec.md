## MODIFIED Requirements

### Requirement: Entry point and availability

"Add organisation sign-in" in Settings → Google accounts SHALL offer "Set up automatically" only when all of these hold:
- the browser plugin's in-process dedicated-browser service exists and reports the browser plugin loaded and enabled and the dedicated profile available;
- (no condition on existing clients: a run adds a new organisation client, or updates the one with the same client id);
- the settings are opened from the dashboard host itself, because the checkpoints need the dedicated Chrome window on that host. A request counts as local only when its peer is a loopback address and it carries no proxy forwarding header (`X-Forwarded-*`, `Forwarded`, `Via`), so a same-host tunnel counts as remote.

The manual wizard SHALL remain available in every case. Run routes are served under `/api/plugins/google/setup/` (the same paths that were under `/api/plugins/gmail/setup/`); the Gmail paths SHALL answer as Gmail's other management routes do (410 `moved` while Google Connect is usable, 503 `google_connect_unavailable` otherwise). "Set up automatically" SHALL NOT be a primary button; "Connect a Google account" stays the section's one primary button, and the run's inputs SHALL use the settings field components with visible labels.

#### Scenario: Browser plugin disabled

- **WHEN** the browser plugin is disabled, unloaded, or the dedicated profile reports `available: false`
- **THEN** the organisation setup SHALL NOT show "Set up automatically" and SHALL show the manual wizard

#### Scenario: Accounts exist

- **WHEN** own client "BlackBelt" exists with accounts
- **THEN** "Set up automatically" SHALL still be offered for a new organisation client

#### Scenario: Remote dashboard

- **WHEN** the settings are opened through a tunnel or LAN address
- **THEN** "Set up automatically" SHALL be replaced by a note that it runs only on the dashboard host, and `POST /api/plugins/google/setup/run` from a non-local request SHALL return 403 `remote_dashboard`

#### Scenario: Same-host tunnel

- **WHEN** a start request arrives from `127.0.0.1` with an `X-Forwarded-For` header
- **THEN** the response SHALL be 403 `remote_dashboard`

### Requirement: Secret capture without exposure

The run's browser instance SHALL be private and ephemeral: its tabs SHALL NOT appear in the browser relay status or be viewable in a dashboard pane, and it SHALL use a throwaway browser context, so the owner's Google session, the console pages, download history and cache are discarded when the run ends, fails or is cancelled, and never reach the dedicated profile's normal context. The run SHALL read the new client's id and secret from the creation dialog inside the server process; when that fails it SHALL download the client JSON into the dedicated profile's downloads directory, read it, and delete it, also on failure. The captured client SHALL be stored through the same validation as an uploaded organisation client (Desktop or Web), as a new organisation client labelled with the project id, together with the project id and owner account. Any text the run logs or returns SHALL have `GOCSPX-` secrets masked. When the dialog was shown but neither read succeeds, the run SHALL close the dialog and end with `handoff {step: "capture", wizardStep: 4, reason: "secret_capture_failed"}`, and the manual wizard SHALL explain adding a new secret to the client named in `created`.

#### Scenario: Secret never logged

- **WHEN** a run completes
- **THEN** no server log line, run view, audit entry or HTTP response produced during the run SHALL contain the client secret

#### Scenario: No viewer sees the dialog

- **WHEN** a run is at the `client` step
- **THEN** `browser_relay_status` SHALL list no tab of the run's instance and a viewer subscribe to it SHALL be refused

#### Scenario: Downloaded file removed

- **WHEN** the dialog read fails and the JSON fallback is used
- **THEN** after the run no `client_secret_*.json` from this run SHALL remain in the downloads directory

#### Scenario: Done

- **WHEN** the client is stored
- **THEN** the run state SHALL be `done`, `GET /api/plugins/google/state` SHALL list a new organisation client labelled with the run's project id, and the settings SHALL offer "Connect a Google account" with that client selected

### Requirement: Verified, resumable steps

The run SHALL perform, in order: `project` (create or select the project), `api` (enable the Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks and People APIs), `branding` (branding and audience), `publish` (External apps only), `client` (create a Desktop OAuth client named `pi-dashboard`, or `pi-dashboard-<n>` when that name exists), `capture` (capture the client and add it as a new organisation client labelled with the project id, or update the organisation client with the same client id). For each step it SHALL first check whether the step is already done and mark it `skipped` if so, otherwise act and then verify the result. Console URLs SHALL select the owner account and the project. The run SHALL keep its browser connection active in every non-terminal state.

When a step cannot be verified, the page is not one the step expects, the page language is not English, a navigation is refused by the dedicated browser, storing the client is refused, or a step exceeds 60 s, the run SHALL stop in state `handoff` with `{step, wizardStep, reason}`. `wizardStep` maps the run step to the manual wizard: `project` and `api` → 1, `branding` → 2, `publish` → 3, `client` and `capture` → 4.

#### Scenario: Re-run skips finished steps

- **WHEN** a previous run created the project and enabled all product APIs, then stopped, and the user starts a new run for that project
- **THEN** steps `project` and `api` SHALL be `skipped` and the run SHALL continue at `branding`

#### Scenario: Unknown page

- **WHEN** the console shows a page the current step does not recognise
- **THEN** the run SHALL stop with `handoff {step: <current step>, wizardStep, reason: "unexpected_page"}`

#### Scenario: Navigation refused

- **WHEN** the browser plugin's allowed domains exclude `console.cloud.google.com`
- **THEN** the run SHALL stop with `handoff {step: "project", wizardStep: 1, reason: "domain_blocked"}` and the settings SHALL name the domains to allow

#### Scenario: Account added during the run

- **WHEN** an account is connected to an existing own client while the run is creating a new client
- **THEN** the run SHALL add the new client alongside the existing one and finish without hand-off

#### Scenario: One product API missing

- **WHEN** a previous run enabled only the Gmail API and the user starts a new run for that project
- **THEN** step `api` SHALL enable the missing APIs and SHALL NOT be `skipped`

