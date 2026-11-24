## Why

Google access in the dashboard is Gmail-only, and connecting an account requires every user to create their own Google Cloud project and Desktop OAuth client. Most users run pi-dashboard on their own computer and want to connect their own Google accounts, often several, the way other desktop apps do, with no setup. Organisations that deploy the dashboard on a server need their own OAuth clients (several side by side, e.g. `blackbelt.hu` and `semmi.se`). The agent needs Calendar, Drive, Docs, Sheets, Slides, Tasks and Contacts, not only Gmail. The project owns `pi-dashboard.dev`, so it can register a Google-verified desktop app under that brand.

## What Changes

- **New plugin `google`** (`packages/google-plugin`): "Google accounts" (Google Connect), the one owner of Google OAuth clients, accounts, grants and token leases for every Google product, plus typed agent tools for Calendar, Drive, Docs, Sheets, Slides, Tasks and Contacts.
- **Built-in pi-dashboard.dev app** (shipped empty until Google verification), two Google Cloud projects with the same branding, one consent window per connect:
  - **local** — a Desktop client for dashboards on the user's own computer (loopback; data stays on the device), every product scope;
  - **remote** — a Web client used only through the static return page `https://pi-dashboard.dev/oauth/return.html`, whose consent screen declares no restricted scopes (no Gmail, no full Drive). The return page shows the target dashboard address and needs a confirm click; this path is an accepted risk (see design Risks), with an operator switch.
- **Organisation sign-in (gcloud way)**: any number of named own OAuth clients (Desktop or Web), each linked to email domains for automatic selection. Web clients redirect straight back to the dashboard's own public address (secure remote sign-in for server deployments). Managed under a collapsed "Advanced" section.
- **Accounts and products**: one account per Google identity, bound to one client, one grant. Products are turned on per account with a level; turning one on asks Google for the union of granted and new scopes. Drive in the built-in app is limited to `drive.file` with Google's file picker; full Drive needs an own client.
- **Settings → Google accounts**: account cards with product tables, one "Connect a Google account" button opening a one-screen dialog (products, three data-use lines, "Continue with Google"), Google's own account chooser picks the account. The setup wizard and automatic setup move here as "Add organisation sign-in" and enable every product API.
- **Typed tools, confirmed writes** per product: `gcal_*`, `gdrive_*` (incl. `gdrive_pick`), `gdocs_*`, `gsheets_*`, `gslides_*`, `gtasks_*`, `gcontacts_*`.
- **Gmail plugin** keeps its tools (`gmail_*` unchanged). When Google Connect is available its lease lane delegates to the `google` plugin's lease lane (no in-process token sharing); otherwise it keeps leasing from its own data (soft: no hard plugin dependency). Its stored client and accounts are imported without re-consent, each account at most once.
- **BREAKING (UI + REST)**: Gmail account and client management moves to Settings → Google accounts; after migration `/api/plugins/gmail/accounts|client` and `/api/plugins/gmail/setup/*` answer `410 moved`. Disconnect no longer revokes at Google by default.
- Tokens are exchanged and stored only by the dashboard server; no pi-dashboard.dev broker.
- Operator switches: `PI_GOOGLE_DEFAULT_CLIENTS=off` (no built-in app), `PI_GOOGLE_REMOTE_RETURN=off` (no return page).
- Google verification kit in `google-verification/`; privacy/terms/return pages on `site/`.
- Mockup: `mockups/2026-11-23-google-connect-settings` (in this change); static gallery `mockup-screens/README.md`.
- NON-GOALS: Drive sharing changes, Photos, Keep, Admin SDK, hosted token broker, Electron loopback catcher, Google device-code flow.

## Capabilities

### New Capabilities
- `google-connect`: built-in app and organisation clients, client selection, accounts and grants, products and incremental consent, return paths (local loopback, pi-dashboard.dev return page, own Web client), disclosure, Google accounts settings, legacy Gmail import, leases.
- `google-calendar-tools`: calendars, events and free/busy with confirmed writes.
- `google-drive-tools`: Drive levels, file picker, search, export/download into the workspace, upload, move and trash with confirmed writes.
- `google-docs-tools`: read, create and edit Google Docs with confirmed, revision-guarded writes.
- `google-sheets-tools`: read, create and write ranges with confirmed writes, literal values by default.
- `google-slides-tools`: read, create and edit slide text with confirmed, revision-guarded writes.
- `google-tasks-tools`: task lists and tasks with confirmed writes.
- `google-contacts-tools`: search, read, create and update contacts with confirmed, conflict-guarded writes.

### Modified Capabilities
- `gmail-plugin`: setup, sign-in, revoke and settings requirements move to google-connect (REMOVED); Gmail uses Google Connect softly, maps its refusals, points its settings to Google accounts, migrates once.
- `marketing-site`: the static site also ships `privacy.html`, `terms.html` and `oauth/return.html`; `/oauth/` is excluded from crawling.
- `gmail-auto-setup`: entry point moves to "Add organisation sign-in", always adds a new client, routes under `/api/plugins/google/setup/`, enables every product API.

## Impact

- **New package** `packages/google-plugin` (server, bridge, client, shared). Registration per the add-new-plugin-package checklist (workspace, release set, `BUNDLED_WORKSPACE_PKGS`, contract tests, generated plugin CSS sources).
- **`packages/gmail-plugin`**: `gmail/lease` replies `delegate: google` when Google Connect is usable (provider check via `consumeAll`), the bridge then leases from `google/lease`; legacy fallback kept; settings section becomes a pointer; wizard + auto-setup code moves to `google-plugin`; one-time import.
- **APIs**: `/api/plugins/google/*` (state, clients, accounts, products, disclosure, flows, oauth callback, setup); bridge lanes `google/lease`, `google/accounts`; Gmail REST routes `410 moved` after migration.
- **Data**: credential namespace `google` (`client:<id>`, `acct:<sub>`, `disclosure`, `imported:gmail`); `gmail` namespace kept with marker `migrated` (rollback source).
- **Site**: `site/privacy.html`, `site/terms.html`, homepage Limited Use block, `site/oauth/return.html`.
- **External**: Cloud Identity org on `pi-dashboard.dev`; GCP project "pi-dashboard" (desktop app, every scope; CASA expected to be unnecessary for the desktop data flow, Google decides) and "pi-dashboard remote" (sensitive scopes only); Picker API key restricted to localhost referrers. See `google-verification/README.md`.
- **Rollback**: previous build (Gmail from the untouched namespace), disabling the google plugin (Gmail falls back), or the operator switches.

## Discipline Skills

- `security-hardening` — OAuth clients, refresh tokens, the public return page (accepted risk), untrusted redirect input, Drive file paths into the workspace, disclosure of user data to the LLM provider.
- `doubt-driven-review` — public built-in client ids in releases, the return-page risk and the one-way-looking migration must stand before build.
- `observability-instrumentation` — sign-in, consent, refresh and lease logs carry client ref, return path, product and code (never secrets).
- `performance-optimization` — shared per-project Google API quotas; single-flight refresh, backoff on 429.
- `review-code` — large multi-package change before commit.
