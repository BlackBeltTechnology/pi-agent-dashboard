## Why

Using the Gmail plugin starts with a one-time Google Cloud setup done by hand: create or pick a project, enable the Gmail API, configure branding and audience, publish, create a Desktop OAuth client, download its JSON and upload it. The per-account sign-in already uses the local browser and is not the problem. The six console steps are, and `improve-gmail-plugin-setup-ux` only makes them easier to follow.

Google offers no usable API for most of them (checked 2026-10-17):

| Step | API / `gcloud` | Console only |
|---|---|---|
| Create project | `gcloud projects create` | |
| Enable Gmail API | `gcloud services enable gmail.googleapis.com` | |
| Branding (consent screen) | `gcloud iap oauth-brands` is deprecated, internal-only; IAP OAuth Admin API shut down 2026-03-19 | yes |
| Audience + publish | none | yes |
| Desktop OAuth client | `iap oauth-clients` makes IAP web clients only; `iam oauth-clients` is Workforce Identity Federation only | yes |
| Client secret | none; since June 2025 shown and downloadable **only once, at creation** | yes |

A spike on 2026-10-17 drove all six steps through the local browser (agent-browser, Panerelay, clean `AgentAutomation` Chrome profile) on two throwaway projects, then signed in with a loopback + PKCE client and read the Gmail profile:

| | Personal (gmail.com) | Workspace (blackbelt.hu) |
|---|---|---|
| Project + Gmail API | worked, "No organization" | worked, under the org, no policy block |
| Audience | External only ("Internal" disabled) | Internal |
| Publish | blocked until Branding has a home page, privacy-policy link and authorized domain; `github.com` accepted without ownership proof | not needed for Internal |
| Client secret | readable from the creation dialog; "Download JSON" writes an `installed` JSON to `~/Downloads` | same |
| Sign-in with `login_hint` | no account chooser; "Google hasn't verified this app" warning, Advanced, continue, one Continue | no warning, one Continue |
| Result | `gmail.readonly` granted, refresh token issued, profile read | same |
| Time | about 4.5 min including exploration | about 3 min |

Facts the design must respect:
- Publishing an unverified External app works without declaring scopes under Data Access. It shows the unverified warning and is capped at 100 users, but it removes the 7-day Testing token expiry.
- Branding requires ticking "I agree to the Google API Services: User Data Policy". That is a policy acceptance and must be the user's own click.
- The accessibility snapshot names the "Copy to clipboard: GOCSPX-…" button with the full secret. An unfiltered snapshot leaked it into the spike transcript once.
- Console URLs accept `authuser=<email>`, so the right Google identity is selected without a chooser.

## What Changes

- **"Set up automatically" in Gmail settings.** A new entry point next to the manual wizard. It opens the dedicated agent profile (from `add-dedicated-agent-browser`) at the Cloud console with `authuser=<owner email>` and runs the six steps:
  1. create a project (or use an existing one the user picks);
  2. enable the Gmail API;
  3. fill branding: app name, support and contact email;
  4. choose the audience: Internal when the owner's account belongs to a Workspace organization, otherwise External. For External, fill in a home page, privacy-policy link and authorized domain (defaults point at the dashboard's public repository), then publish;
  5. create a Desktop OAuth client;
  6. capture the client ID and secret at creation and hand them to the plugin's existing `PUT /api/plugins/gmail/client`.
- **Human checkpoints stay human.** Signing in to the dedicated profile, ticking the User Data Policy box, and confirming publishing are the user's clicks. The run pauses on each with a clear prompt in settings and resumes when the page moves on.
- **Every step is idempotent and verified.** Each step checks the page state before and after acting: project exists, API enabled, branding saved, published or Internal, client exists. A re-run continues from the first unfinished step. When a step cannot be verified (console redesign, policy block, quota, phone verification), the run stops and opens the manual wizard **at that step**, with the project ID and owner account already filled in.
- **The secret never enters a transcript or log.** The capture reads the creation dialog (or the downloaded JSON) inside the server process and writes it straight to the credential store. Page snapshots and step logs mask `GOCSPX-…`. A downloaded JSON lands in the dedicated profile's server-chosen `status.dedicated.downloadsDir` (never `~/Downloads`) and is deleted after import. If capture fails after the client exists, the run hands off to the manual wizard, which names the created client and explains adding a new secret to it.
- **Sign-in uses `login_hint`.** "Add account" passes `login_hint=<email>` so Google skips the account chooser. Settings tells personal-account users beforehand that they will see the unverified-app warning and how to pass it.
- **Existing setups.** When a client is already configured and accounts exist, `PUT client` already refuses a different client (`409 client_in_use`). The automatic setup is offered only for a fresh setup, or after the user removes the existing client. It never replaces a working client silently.

Non-goals:
- Google app verification, a security assessment, or a shared public OAuth client built into the dashboard.
- Using browser session cookies for Gmail access. The plugin stays on OAuth.
- A Workspace organization-provided client (admin-made Internal client distributed to users). Worth its own change.
- Driving the console through the real-profile relay or Panerelay. The spike used Panerelay; the product uses the dedicated profile only.

## Capabilities

### New Capabilities

- `gmail-auto-setup`: browser-driven creation of the plugin's OAuth client: run lifecycle, step recipe, per-step verification and resume, human and decision checkpoints, busy takeover, fallback to the manual wizard at the failed step, secret capture without logging, and cleanup of downloaded secrets.
- `dedicated-agent-browser` (introduced by `add-dedicated-agent-browser`): an in-process `browser.dedicated` service for other plugins.

### Modified Capabilities

- `gmail-plugin`:
  - Guided OAuth client setup: offers "Set up automatically" when the dedicated agent profile is available; the manual wizard accepts a hand-off at a given step with project ID and owner account filled.
  - Multi-account sign-in: authorization requests carry `login_hint`; settings explains the unverified-app warning for External apps before sign-in.
  - Secrets never logged: extends to page snapshots and setup-run logs (`GOCSPX-` masking) and to downloaded client JSON files.

## Dependencies

1. `add-dedicated-agent-browser`: hard dependency. Supplies the dedicated profile and its `{cdpUrl, instanceId}` connect handle. Without it the feature stays hidden.
2. `improve-gmail-plugin-setup-ux`: lands first. It owns the existing-project path, project-ID validation, the owner-account field and `authuser` links that the hand-off reuses. Both changes modify "Guided OAuth client setup", so this change's delta is rewritten on top of its archived text before ship. Its non-goal "Running `gcloud` or cloud APIs on the user's behalf" stays true for the manual wizard; this change is a narrow, opt-in exception (console actions in the dedicated profile, started by the user, with human checkpoints).

Execution order (Browser Agent group): `fix-browser-relay-pane-input` → `fix-empty-status-subcard` → `add-dedicated-agent-browser` → `improve-gmail-plugin-setup-ux` → `add-gmail-auto-setup`.

## Decisions (2026-10-17)

- A deterministic server-side recipe in the gmail plugin drives the console; no agent or model is involved.
- The browser plugin offers the dedicated profile in-process (`ctx.provide("browser.dedicated", …)`); the gmail server consumes it.
- Internal vs External is detected from the project's parent organization and confirmed by the user before branding.
- Publishing links are prefilled with the dashboard's public GitHub repository and editable before publishing.
- When the dedicated profile is busy, the UI shows the holder and offers a confirmed "Take over".

## Impact

- `packages/gmail-plugin/src/server/`: a setup-run module (step recipe, state, verification, resume), a route to start, poll and cancel a run, secret capture into `AccountStore`'s `client` record via the existing client-write path.
- `packages/gmail-plugin/src/client/`: `GmailSettings.tsx` entry point, run progress with human-checkpoint prompts, hand-off into the wizard at a step; `wizard.ts` accepts an initial step and prefilled values.
- Sign-in URL builder: `login_hint`.
- `packages/browser-plugin/src/server/index.ts`: `ctx.provide("browser.dedicated", {status, connect, open, disconnect})`.
- `packages/gmail-plugin/package.json`: `ws` dependency. No `dependsOn` (it is a hard dependency and the browser plugin ships disabled); the service is looked up lazily.
- i18n catalogs (en, zh-CN, hu) for the new strings.
- Tests: recipe steps against recorded console page fixtures; secret masking in snapshots and logs; resume from each step; fallback hand-off; `409 client_in_use` respected.

## Discipline Skills

- `security-hardening`: the run handles an OAuth client secret in a browser page and on disk (the dedicated profile's `status.dedicated.downloadsDir`). Capture, masking, deletion of downloaded files, and refusal to replace an in-use client need a threat review.
- `observability-instrumentation`: a long multi-step external flow. Each step needs a recorded outcome and failure reason (without secrets) so a console redesign is diagnosable.
- `doubt-driven-review`: deviating from the "no cloud actions on the user's behalf" rule and accepting dependence on an undocumented console UI should be challenged before the design is fixed.
