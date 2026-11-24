# Google OAuth verification kit — pi-dashboard.dev

Goal: Google-verified OAuth apps "pi-dashboard" under `pi-dashboard.dev`, whose Desktop clients ship as the built-in defaults of Google Connect (`packages/google-plugin`: Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks, Contacts). Named own clients (e.g. blackbelt.hu, semmi.se) stay available.

Files in this kit:

| File | Use |
|---|---|
| `privacy-policy.md` | Source for `site/privacy.html`. Needs legal review. |
| `terms-of-service.md` | Source for `site/terms.html`. Needs legal review. |
| `limited-use.md` | Homepage statement + text for the verification form. |
| `in-app-disclosure.md` | Text shown in Settings → Google before built-in-client sign-in (versioned). |
| `scope-justifications.md` | Paste into the Data Access → scope justification fields. |
| `demo-video-script.md` | Shot list for the unlisted YouTube demo video. |

Facts quoted from Google (Restricted scope verification page, Workspace API User Data Policy):
- "If you store or transmit restricted scope data on servers, then you need to complete a security assessment."
- Reverification + security assessment "at least every 12 months after the assessor's Letter of Assessment (LOA) approval date".
- Limited Use disclosure "Cannot be placed only in a privacy policy or terms of service" — it must also be in the app.
- Transfers allowed only "to provide or improve your appropriate use case or user-facing features that are visible and prominent in the requesting application's user interface and only with the user's consent".
- Unverified / Testing apps: warning screen, user cap (100), Testing refresh tokens expire after 7 days.

Always confirm each scope's classification (non-sensitive / sensitive / restricted) in the Cloud Console's Data Access page; it is shown when you add the scope.

## Phase 0 — Identity (day 1)

- [ ] Create **Cloud Identity Free** (or Workspace) on `pi-dashboard.dev`. Verify the domain with the DNS TXT record it gives you.
- [ ] Create a GCP **organization** from it. Add ≥2 human Owners (bus factor; Google sends recertification mail to Owners/Editors).
- [ ] Create `support@pi-dashboard.dev` (user or Google Group) — the consent-screen support email must be one you control.
- [ ] Optional but recommended: `security@pi-dashboard.dev`, `privacy@pi-dashboard.dev` (referenced by the privacy policy).
- [ ] **Search Console**: add domain property `pi-dashboard.dev` (DNS verification) with an account that is Owner/Editor on the GCP projects. Brand verification checks this.

## Phase 1 — Projects (day 1)

Two projects, same branding, split by **where the dashboard runs** (design D2):

| GCP project | Display name | Client | Scopes | Verification |
|---|---|---|---|---|
| `pi-dashboard` → `BUILT_IN.local` | pi-dashboard | Desktop app | `openid`, `email`, Gmail (`gmail.readonly`, `gmail.compose`, `gmail.modify`, `gmail.settings.basic`), `calendar.readonly`, `calendar.events`, `drive.file`, Docs/Sheets/Slides/Tasks/Contacts (read + write) | brand + sensitive + restricted (Gmail). Submission: **desktop app, no backend, tokens and data only on the user's device** → CASA expected to be unnecessary (Google decides; disclose the user-chosen AI provider) |
| `pi-dashboard-remote` → `BUILT_IN.remote` | pi-dashboard | Web application, redirect `https://pi-dashboard.dev/oauth/return.html`, no JS origins | `openid`, `email`, Calendar, `drive.file`, Docs/Sheets/Slides/Tasks/Contacts — **no restricted scope** | brand + sensitive (no CASA) |

Plus a **Picker API key** in `pi-dashboard` (Google Picker API), restricted to HTTP referrers `http://localhost:*` and `http://127.0.0.1:*`.

Use the same app name, logo, domain, policy URLs in every project. Each project = its own client id; each connector ships its own default constant.

Per project:
- [ ] Enable the APIs: workspace project → Calendar, Drive, Docs, Sheets, Slides, Tasks, People; mail project → Gmail, Drive.
- [ ] Google Auth Platform → **Branding**: app name `pi-dashboard` (must not contain "Google"/"Gmail" or imply Google ownership), logo 120×120 PNG (`site/public/app-icon.png` resized; you must own it), support email, homepage `https://pi-dashboard.dev/`, privacy `https://pi-dashboard.dev/privacy.html`, terms `https://pi-dashboard.dev/terms.html`, authorized domain `pi-dashboard.dev`, developer contact = Owners.
- [ ] **Audience**: External. Keep in **Testing** with a test-user list until verification is approved.
- [ ] **Data Access**: add exactly the scopes in the table. Nothing more — every extra scope must be justified and slows review.
- [ ] **Clients**: `pi-dashboard` → one **Desktop app** client (`BUILT_IN.local`); `pi-dashboard-remote` → one **Web application** client with authorized redirect URI `https://pi-dashboard.dev/oauth/return.html` and no JavaScript origins (`BUILT_IN.remote`).
- [ ] Quotas: check every API's per-project quota; request increases before public launch (all users share them).

## Phase 2 — Public site (week 1)

- [ ] Publish `privacy.html`, `terms.html`, the homepage Limited Use block + links, and `oauth/return.html` (tasks 7.1, 7.2).
- [ ] Homepage must clearly describe what the app does and why it needs Gmail access, and be reachable without login.
- [ ] Privacy policy URL host must equal the verified domain.

## Phase 3 — Brand verification (days)

- [ ] Submit for verification with only non-sensitive scopes first if you want the brand approved quickly; or submit once with all scopes.
- [ ] Answer reviewer email from the developer-contact inbox promptly — review stalls otherwise.

## Phase 4 — Restricted scope verification (weeks)

- [ ] Ship the build with the disclosure gate (tasks 1–4) so the demo shows real in-app disclosure.
- [ ] Record the demo video (`demo-video-script.md`), upload **unlisted** to YouTube.
- [ ] Fill scope justifications (`scope-justifications.md`).
- [ ] Submit. Expect reviewer questions on: why each restricted scope (not a narrower one), where data goes (the LLM provider!), how the user consents.

## Phase 5 — Security assessment (CASA) — only if Google requires it

The `pi-dashboard` project is submitted as a desktop app: no backend, tokens and Gmail data stay on the user's device; Google's guidance exempts such client-side apps. Risk: content the agent reads goes to the user's chosen AI model provider (a third-party server) — describe it as a user-initiated feature with explicit consent. Never send Google data (subjects, recipients, file names) to pi-dashboard.dev, crash reports, analytics or logs. If Google still requests CASA:

- [ ] When Google requests it, register with the App Defense Alliance CASA portal and pick an authorized assessor (Google states the tier).
- [ ] Prepare: dependency scan (`pnpm audit`, CodeQL baseline already exists), SAST, threat model of credential store / lease / bridge (the `refresh-security-map-audit` skill output is a good input), secret-handling evidence ("Secrets never logged" tests).
- [ ] Remediate findings; obtain the **Letter of Assessment (LOA)**.
- [ ] Calendar: reassessment + reverification every 12 months from the LOA date.

## Phase 6 — Launch

- [ ] Move Audience to **In production** after approval.
- [ ] Follow-up change per project: set `BUILT_IN.local` / `BUILT_IN.remote` in `packages/google-plugin/src/shared/default-clients.ts`, CHANGELOG, release.
- [ ] Monitor in GCP: OAuth consent metrics, API errors/quota, abuse reports (public client id can be reused by others).

## Ongoing obligations

- Any new scope → re-verification before it works for public users.
- Changing app name/logo/domains → brand re-verification.
- Privacy-policy or data-flow changes → bump `DISCLOSURE_VERSION` + update `privacy.html`.
- Breach involving Google user data → notify per policy; keep an incident contact current.
- Do not use Gmail data for ads, sale, or training generalized AI models (Workspace User Data Policy, "Limited Use").

## Decision log

- Desktop client + loopback, no web broker: pi-dashboard.dev never receives codes/tokens/mail.
- One verified project per scope tier: restricted review never blocks other connectors.
- Own-client path kept: Workspace orgs that block third-party apps, power users, air-gapped installs.
