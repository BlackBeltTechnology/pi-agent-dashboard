# gmail-auto-setup Specification

## Purpose
Create the Gmail plugin's Google OAuth client automatically by driving the Google Cloud console in the dashboard's dedicated agent browser, leaving the user only sign-in, policy acceptance, publishing confirmation and review decisions, and never exposing the client secret.

## Requirements

### Requirement: Entry point and availability

The Gmail settings SHALL offer "Set up automatically" only when all of these hold:
- the browser plugin's in-process dedicated-browser service exists and reports the browser plugin loaded and enabled and the dedicated profile available;
- either no OAuth client is configured, or a client is configured with no accounts (the entry SHALL then state that the new client replaces it);
- the settings are opened from the dashboard host itself, because the checkpoints need the dedicated Chrome window on that host. A request counts as local only when its peer is a loopback address and it carries no proxy forwarding header (`X-Forwarded-*`, `Forwarded`, `Via`), so a same-host tunnel counts as remote.

The manual wizard SHALL remain available in every case. "Set up automatically" SHALL NOT be a primary button; "Add account" stays the section's one primary button, and the run's inputs SHALL use the settings field components with visible labels.

#### Scenario: Browser plugin disabled

- **WHEN** the browser plugin is disabled, unloaded, or the dedicated profile reports `available: false`
- **THEN** the Gmail settings SHALL NOT show "Set up automatically" and SHALL show the manual wizard

#### Scenario: Accounts exist

- **WHEN** a client is configured and at least one account is connected
- **THEN** "Set up automatically" SHALL NOT be shown

#### Scenario: Remote dashboard

- **WHEN** the settings are opened through a tunnel or LAN address
- **THEN** "Set up automatically" SHALL be replaced by a note that it runs only on the dashboard host, and `POST /api/plugins/gmail/setup/run` from a non-local request SHALL return 403 `remote_dashboard`

#### Scenario: Same-host tunnel

- **WHEN** a start request arrives from `127.0.0.1` with an `X-Forwarded-For` header
- **THEN** the response SHALL be 403 `remote_dashboard`

### Requirement: Setup run lifecycle

`POST /api/plugins/gmail/setup/run {mode, projectId?, ownerEmail}` SHALL start a run and return `{runId}`; `mode` is `new` or `existing` (existing requires `projectId`), and `projectId` and `ownerEmail` SHALL pass the Gmail plugin's project-id and email validation. Only one run SHALL be live per dashboard; a second start SHALL return 409 `run_active`. `GET /api/plugins/gmail/setup/run/:runId` SHALL return a run view `{runId, state, step, steps, checkpoint?, decision?, busy?, handoff?, projectId?, created, clientId?}` where:
- `state` is one of `running`, `waiting_user`, `waiting_decision`, `busy`, `done`, `handoff`, `cancelled`;
- `step` and each `steps[].id` is one of `project`, `api`, `branding`, `publish`, `client`, `capture`;
- `created` lists the Google resources the run created (project id, OAuth client names).

`DELETE` on the run SHALL cancel it and disconnect its browser client. The run view, the run's log lines and its errors SHALL NOT contain the client secret. The routes SHALL use the same network guard as the other Gmail routes. The run SHALL record one log line per step with the step id, outcome and duration. The project id and owner email SHALL be saved in the Gmail plugin's existing configuration for them, so a later start is prefilled.

#### Scenario: Second run refused

- **WHEN** a run is live and another start arrives
- **THEN** the response SHALL be 409 `run_active`

#### Scenario: Invalid project id

- **WHEN** a run is started with `mode: "existing"` and `projectId: "PiDashboard"`
- **THEN** the response SHALL be 400 naming the project-id rule and no run SHALL start

#### Scenario: Cancel

- **WHEN** the user cancels a live run
- **THEN** the run state SHALL become `cancelled` and its dedicated-browser client SHALL be disconnected

#### Scenario: Browser closed under the run

- **WHEN** the run's browser connection closes without the run ending it (idle disconnect, kill switch, dashboard restart, the user closes the window)
- **THEN** the run SHALL end with `handoff {reason: "browser_closed"}`

### Requirement: Verified, resumable steps

The run SHALL perform, in order: `project` (create or select the project), `api` (enable the Gmail API), `branding` (branding and audience), `publish` (External apps only), `client` (create a Desktop OAuth client named `pi-dashboard`, or `pi-dashboard-<n>` when that name exists), `capture` (capture and store the client). For each step it SHALL first check whether the step is already done and mark it `skipped` if so, otherwise act and then verify the result. Console URLs SHALL select the owner account and the project. The run SHALL keep its browser connection active in every non-terminal state.

When a step cannot be verified, the page is not one the step expects, the page language is not English, a navigation is refused by the dedicated browser, storing the client is refused, or a step exceeds 60 s, the run SHALL stop in state `handoff` with `{step, wizardStep, reason}`. `wizardStep` maps the run step to the manual wizard: `project` and `api` → 1, `branding` → 2, `publish` → 3, `client` and `capture` → 4.

#### Scenario: Re-run skips finished steps

- **WHEN** a previous run created the project and enabled the Gmail API, then stopped, and the user starts a new run for that project
- **THEN** steps `project` and `api` SHALL be `skipped` and the run SHALL continue at `branding`

#### Scenario: Unknown page

- **WHEN** the console shows a page the current step does not recognise
- **THEN** the run SHALL stop with `handoff {step: <current step>, wizardStep, reason: "unexpected_page"}`

#### Scenario: Navigation refused

- **WHEN** the browser plugin's allowed domains exclude `console.cloud.google.com`
- **THEN** the run SHALL stop with `handoff {step: "project", wizardStep: 1, reason: "domain_blocked"}` and the settings SHALL name the domains to allow

#### Scenario: Account added during the run

- **WHEN** an account is connected while the run is creating the client and the store then refuses the new client with `client_in_use`
- **THEN** the run SHALL stop with `handoff {step: "capture", wizardStep: 4, reason: "client_in_use"}` and `created` SHALL name the client it made

### Requirement: Human and decision checkpoints

The run SHALL NOT type a password and SHALL NOT click a sign-in, consent, terms, User Data Policy or publish confirmation. It SHALL pause in state `waiting_user` with a `checkpoint` naming what the user must do:
- `sign_in`: the run SHALL stop any top-level navigation of its own tab to `https://accounts.google.com` before that page renders and enter this checkpoint; it SHALL navigate its own tab to `about:blank`, open the Google sign-in page for the owner account in a tab hidden from the run inside the run's throwaway context and bring that tab to the front, keep its own tab on `about:blank` until the hidden tab's origin is no longer `https://accounts.google.com` (or the user confirms they signed in), then load the console; when the console still shows a sign-in page, return its own tab to `about:blank` at once and wait again;
- `console_terms`: wait until the console's terms dialog is gone;
- `policy`: bring its tab to the front and wait until the User Data Policy box is checked;
- `publish`: wait until the app shows "In production"; a cancelled publish dialog SHALL end the run with `handoff {step: "publish", wizardStep: 3, reason: "publish_cancelled"}`.

A checkpoint not completed within 15 minutes SHALL end the run with `handoff {reason: "timeout"}`.

The run SHALL read whether the project's parent is an organization while checking the `project` step, in both modes. When the `branding` step is not yet done, the run SHALL pause before it in `waiting_decision {kind: "audience", detected, org?}`: `detected` is `internal` when the parent is an organization, otherwise `external`; the user confirms or chooses External, and Internal SHALL NOT be offered without an organization. When `branding` is already done, the run SHALL report the existing audience without asking. Before publishing an External app the run SHALL pause in `waiting_decision {kind: "links"}` with the home page, privacy-policy link and authorized domain prefilled from the dashboard's public repository; the user SHALL explicitly confirm them, the copy SHALL say the links are shown to every account on Google's consent screen, and each link SHALL be an `https:` URL whose host is under the authorized domain.

#### Scenario: Owner session does not outlive the run

- **WHEN** a run ends in `done`, `handoff` or `cancelled` after the owner signed in
- **THEN** an agent session connecting to the dedicated profile afterwards SHALL NOT be signed in to Google as the owner

#### Scenario: Password never typed where the run can read

- **WHEN** the console redirects the run's own tab to `accounts.google.com` during any step, or the run is at checkpoint `sign_in`
- **THEN** no tab the run's CDP session is attached to SHALL render a page on `accounts.google.com`; the sign-in page SHALL appear only in the hidden tab

#### Scenario: Policy box left to the user

- **WHEN** the run reaches the branding form's User Data Policy checkbox
- **THEN** the run state SHALL be `waiting_user` with checkpoint `policy`, the checkbox SHALL stay unchecked until the user checks it, and the run SHALL continue within 2 s after it is checked

#### Scenario: Personal account

- **WHEN** the project has no organization
- **THEN** the audience decision SHALL be `detected: "external"` and SHALL NOT offer Internal

#### Scenario: Existing project already branded

- **WHEN** an existing project's audience page already shows user type External
- **THEN** the run SHALL skip `branding` without an audience decision and report `External`

#### Scenario: Decision wait keeps the browser

- **WHEN** the run waits 20 minutes in `waiting_decision` with the browser plugin's idle disconnect set to 5 minutes
- **THEN** the run's browser connection SHALL still be open when the user answers

#### Scenario: Invalid link

- **WHEN** the user submits a privacy-policy link `http://example.com/p` with authorized domain `github.com`
- **THEN** the continue request SHALL be refused with 400 and the run SHALL stay in `waiting_decision`

### Requirement: Secret capture without exposure

The run's browser instance SHALL be private and ephemeral: its tabs SHALL NOT appear in the browser relay status or be viewable in a dashboard pane, and it SHALL use a throwaway browser context, so the owner's Google session, the console pages, download history and cache are discarded when the run ends, fails or is cancelled, and never reach the dedicated profile's normal context. The run SHALL read the new client's id and secret from the creation dialog inside the server process; when that fails it SHALL download the client JSON into the dedicated profile's downloads directory, read it, and delete it, also on failure. The captured client SHALL be stored through the same validation and `client_in_use` rule as `PUT /api/plugins/gmail/client`, together with the project id. Any text the run logs or returns SHALL have `GOCSPX-` secrets masked. When the dialog was shown but neither read succeeds, the run SHALL close the dialog and end with `handoff {step: "capture", wizardStep: 4, reason: "secret_capture_failed"}`, and the manual wizard SHALL explain adding a new secret to the client named in `created`.

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
- **THEN** the run state SHALL be `done`, `GET /api/plugins/gmail/state` SHALL report the client configured with the run's project id, and the settings SHALL offer "Add account" prefilled with the owner email

### Requirement: Busy dedicated profile

When the dedicated profile is held by another client, the run SHALL enter state `busy` with the holder. `POST /api/plugins/gmail/setup/run/:runId/takeover` SHALL take the dedicated profile over in one step, so no other client can connect between the holder's disconnect and the run's connect; the settings SHALL require the user to confirm before calling it. Any other dedicated-browser failure (disabled, unloaded, not available, owned by another server, profile in use, launch failed) SHALL end the run with `handoff {step: "project", wizardStep: 1, reason}`.

#### Scenario: Agent session holds the profile

- **WHEN** an agent session holds the dedicated profile and a run starts
- **THEN** the run SHALL be `busy` naming that session, and after a confirmed takeover the agent's instance SHALL be closed and the run SHALL continue

### Requirement: Hand-off to the manual wizard

When a run ends in `handoff`, the settings SHALL open the manual setup wizard at `wizardStep`, with the project id and owner account filled in, and SHALL show the hand-off reason as a sentence and the resources listed in `created`.

#### Scenario: Hand-off at the client step

- **WHEN** a run ends with `handoff {step: "capture", wizardStep: 4, reason: "secret_capture_failed"}`
- **THEN** the wizard SHALL open with step 4 marked current, the project id filled in, and the created client's name shown
