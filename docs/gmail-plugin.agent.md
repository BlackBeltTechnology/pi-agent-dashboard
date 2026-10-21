# gmail-plugin.md — index

Pull-only condensed map. Source: docs/gmail-plugin.md. Codes, routes, files, step ids verbatim.

## Overview
- `packages/gmail-plugin`: multi-account Gmail → pi-dashboard.
- Manual setup: Settings → General → Gmail. Google has no setup API; never `gcloud`.
- Audience Internal → own Workspace org only. Other org → `Error 403: org_internal`. Fix: External + test users.
- One OAuth client per dashboard. External/Testing refresh tokens expire 7 days (`testing: 7-day`).
- Tools (except `gmail_accounts`) require `account` (alias|email). No default.
- See change: improve-gmail-settings-ux.

## Package layout
- `src/shared/`: client JSON validation; scopes, levels, lane protocol, endpoints.
- `src/server/`: routes, OAuth, AccountStore, lease gate, revoke.
- `src/bridge/`: tools, leases, Gmail REST, MIME, attachment confinement.
- `src/client/`: wizard + accounts panel.

## Sign-in flow
- `POST /api/plugins/gmail/accounts` → `ctx.oauth.startFlow` key `add-<uuid>` | `reauth-<sub>` → `google-oauth.ts` `createGoogleLoginFlow`.
- Loopback `/`; PKCE + nonce; openid email + tier scopes; `select_account`.
- Race loopback `code` vs `manual_code` (remote browser cannot reach `127.0.0.1`).
- `oauth4webapi` exchange. Validate `iss`/`aud`/`exp`/nonce/`email_verified`.
- `AccountStore.upsertFromSignIn` → `ctx.credentials.update("acct:<sub>")`.
- Re-auth: same `sub` else `account_mismatch`. No refresh token → fail, no persist.
- Lower level immediate; higher → full re-consent.
- Google error page, no redirect → loopback `timeout` at 300 s.
- Report buttons `gmail-report-<code>`: `org_internal`, `access_denied`, `admin_policy_enforced`, `other`. Click latches `reportedRef`, `setFlow(null)`, `oauthFlowClient.cancel`. Latch resets on `addAccount`/`startFlow`.
- Unticked scope → `scope_missing`. Hint `gmail-consent-hint`.
- See change: improve-gmail-settings-ux.

## Sign-in errors
- `wizard.ts` `errorKey(code)`; unknown → `errGeneric`; `"Cancelled"` → `errCancelled`. `ERROR_EN` fallback via `t()`.
- `errorStep`: `org_internal`/`access_denied` → 3; `admin_policy_enforced` → null (`{clientId}`).
- `shared/flow-codes.ts` `KNOWN_FLOW_CODES`, `knownFlowCode(code)`; shared client + server.
- `routes.ts` `startSignIn` logs `[gmail] sign-in failed: <code>`; unknown → `sign_in_failed`; once per call.
- Pre-event throw → `PluginFlowStartError("login_failed")`. Never log email, message, URL, token.

## Automatic setup
- Entry `gmail-setup-run`. Local-only. Dedicated Chrome drives console → stores Desktop client. Manual wizard = fallback. No model, no CLI.
- States: `starting` → `running` | `busy` | `handoff`; `busy` → `running` | `cancelled`; `running` ⇄ `waiting_user`, `waiting_decision`; `running` → `done` | `handoff` | `cancelled`.

### Availability
- `GET state` → `autoSetup: {available, reason?, local, replacesClient?, runId?}`.
- `available` needs: `ctx.consume("browser.dedicated")`; `status().enabled && available`; loopback + no proxy header (`isGenuinelyLocal`, `setup/local.ts`); no client/zero accounts (`client_in_use`); no live run (`run_active`).
- `reason`: `service_missing`, `disabled`, `status_failed`, `remote_dashboard`, browser refusal.

### Run
- `POST /api/plugins/gmail/setup/run {mode, projectId?, ownerEmail}` → `{runId}`.
- `mode` `new` | `existing` (needs `projectId`). `new` default `pi-dashboard-<6 [a-z0-9]>` (`generateProjectId`).
- Errors: 403 `remote_dashboard`; 409 `run_active`; 400 `invalid_mode`, `invalid_owner_email`, `invalid_project_id`.
- Connect `browser.dedicated` `{client:"gmail-setup", private:true, ephemeral:true}`. Best-effort save `projectId`, `ownerAccount`.
- Step = check → act → verify. Fail / unknown page / >60 s (`stepLimitMs`) → handoff.

| id | Effect | wizardStep |
|---|---|---|
| `project` | Create or confirm; reads parent org. | 1 |
| `api` | Enable Gmail API (done at `Disable API`). | 1 |
| `branding` | App name, support = owner, audience, contact, policy. | 2 |
| `publish` | External only: links, Save, `Publish app`. | 3 |
| `client` | Create `pi-dashboard` (or `-<n>`). Never `done`. | 4 |
| `capture` | Read + store secret. | 4 |

- Nav `authuser=<ownerEmail>`, `project=<projectId>`, `hl=en`. Elements by role+name (`Accessibility.queryAXTree`).
- `lang` ≠ en → `locale`. Denied nav → `domain_blocked`. Keep-alive 30 s (`keepAliveMs`). Socket closed → `browser_closed`.

### Decisions
- `waiting_decision` → `POST …/setup/run/:runId/continue`.
- Audience `{audience:"internal"|"external"}` (if `branding` pending; detected `internal` if parent org). Bad → `invalid_audience`.
- Links `{links:{homePage,privacyPolicy,authorizedDomain}, confirmLinks:true}` before `publish`. Errors: `confirm_required`, `links_required`, `invalid_authorized_domain`, `invalid_<key>`.
- Defaults `DEFAULT_PUBLISH_LINKS`: `https://github.com/BlackBeltTechnology/pi-agent-dashboard`; domain `github.com`.

### Human checkpoints
- `waiting_user`; `checkpoint.kind`. Run never clicks sign-in, consent, terms, policy, publish.
- `sign_in`: `Fetch` guard `https://accounts.google.com/*` → `Fetch.failRequest` (`BlockedByClient`); run tab → `about:blank`; sign-in in hidden ephemeral tab (`login_hint`). Resume: origin leaves accounts.google.com or `POST …/continue`.
- `console_terms`: `Agree and continue` gone. `policy`: User Data Policy checkbox; `Page.bringToFront`.
- `publish`: `Push to production?` → `In production`. Dialog gone 5 polls (`publishGracePolls`) → `publish_cancelled`.
- Limit 15 min (`checkpointLimitMs`) → `timeout`.

### Busy and takeover
- 409 `busy` → `busy.holder` (session id | client label; never instance id).
- `POST …/takeover`: 409 `not_busy` if idle; reconnect `takeover: true` (atomic in browser plugin).

### Handoff
- `handoff: {step, wizardStep, reason, domains?}`; `created: {projectId?, clients[]}`.
- wizardStep: `project`,`api`→1; `branding`→2; `publish`→3; `client`,`capture`→4.
- Recipe reasons: `unexpected_page`, `locale`, `domain_blocked`, `publish_cancelled`, `timeout`, `secret_capture_failed`, `client_in_use`, `browser_closed`.
- Browser refusal (step `project`): `disabled`, `unloaded`, `no-chrome`, `no-display`, `owned-by-other-server`, `profile-in-use`, `launch-failed`.
- Log `[gmail] setup step <id> <done|skipped|handoff:<reason>> <ms>ms`.

### Secret capture (`capture`)
1. Read id + secret from `OAuth client created` DOM (in-memory).
2. Fallback: `Download JSON` → newest `client_secret_*.json` in `downloadsDir`.
3. Delete new downloads in `finally`. 4. Store via `PUT /client` path.
5. Both fail → `OK`; `secret_capture_failed`.
- Private + ephemeral context; discarded on end/cancel/Chrome exit.
- `maskSecrets`: `GOCSPX-[A-Za-z0-9_-]+` → `GOCSPX-***`.
- Selectors unverified until manual task 7.2. See change: add-gmail-auto-setup.

## Token lease
- Bridge → `LeaseClient.lease(account, op)` → `requestPluginServer("gmail","gmail/lease")` → `lease.ts`.
- Resolve alias then email (one snapshot). Gates: `tier_denied` → `scope_missing` → `reauth_required`. Pre-network.
- Refresh if `expires − now ≤ 60 s`; single-flight per `sub`. `invalid_grant` → `reauth_required`; other → `refresh_failed`.
- Reply `{accessToken,expiresAt,email,tier}` only. No client token cache. Refresh token server-only.

## Levels

| Level | Scopes | Tools |
|---|---|---|
| `readonly` | `gmail.readonly` | `gmail_search`, `gmail_get`, `gmail_labels`, `gmail_attachments` |
| `draft` | `+ gmail.compose` | Read + `gmail_draft` |
| `send` | `gmail.modify` | Read + draft + `gmail_send`, `gmail_reply`, `gmail_modify`, `gmail_trash` |

- Server gates level + scopes; bridge re-checks. Google scopes = bearer grants; `gmail.compose` also sends.
- Levels constrain agent tools, not Google endpoints.

## Tools
- `gmail_accounts`: alias, email, level, status; no `account` param.
- `gmail_search`: metadata, `maxResults` 1–50. `gmail_get`: HTML → `details.contentType: "text/html"`.
- `gmail_attachments`: list or save to session cwd.
- Reads: `details.untrusted = true` → `untrusted-content-guard`.
- Writes (`gmail_draft`,`gmail_send`,`gmail_reply`,`gmail_modify`,`gmail_trash`): `ctx.ui.confirm` (account, recipients, subject, preview). Headless → blocked. Dismiss/timeout → deny.
- `gmail_reply`: `In-Reply-To`, `References`, `threadId`. Archive removes `INBOX`.

## Gmail API errors
- `bridge/gmail-api.ts` `classify403`; reason from `error.details[]` (`@type` ends `google.rpc.ErrorInfo`) or `error.errors[].reason`.
- `SERVICE_DISABLED` / `accessNotConfigured` → `api_disabled`; `gcloud services enable gmail.googleapis.com --project=<n>` only if `metadata.consumer` ~ `^projects/(\d{1,20})$`.
- `ACCESS_TOKEN_SCOPE_INSUFFICIENT` / `insufficientPermissions` → `scope_insufficient`.
- Else → `gmail_error: Gmail returned HTTP 403`. Google text never echoed.

## Storage
- `~/.pi/agent/plugin-credentials.json`: plaintext 0600, namespace `gmail`.
- `client`: `clientId`, `clientSecret`, optional `projectId`.
- `acct:<sub>`: email, alias, tier, scopes, refresh, access, expiry, status, testing hint, added.
- `upsertFromSignIn` merges re-auth, keeps alias. Revoke: Google first, local delete even on remote fail. Disable/uninstall keeps grants.

## REST routes
- All `operate` (`shared/src/route-tiers.ts`), `networkGuard`, `@fastify/rate-limit`, MCP denylist. No tokens/secret.

| Method | Path | Action |
|---|---|---|
| `GET` | `/api/plugins/gmail/state` | Summaries (+ `autoSetup`). |
| `PUT` | `…/client` | Save Desktop JSON. |
| `POST` | `…/accounts` | Add flow; default `readonly`; `email` → `login_hint`. |
| `POST` | `…/accounts/:sub/level` | Covered level or re-consent. |
| `POST` | `…/accounts/:sub/reauth` | Re-consent current level. |
| `PATCH` | `…/accounts/:sub` | Change alias. |
| `DELETE` | `…/accounts/:sub` | Revoke attempt; delete local. |
| `POST` | `…/setup/run` | Start auto setup (loopback) → `{runId}`. |
| `GET` | `…/setup/run/:id` | Secret-free view. |
| `POST` | `…/setup/run/:id/continue` | Answer decision / ack `sign_in`. |
| `POST` | `…/setup/run/:id/takeover` | Confirmed busy takeover. |
| `DELETE` | `…/setup/run/:id` | Cancel. |

## Settings UI
- Revoke: host `ui:confirm-dialog`; DELETE after confirm only.
- Alias blur → `gmail-alias-feedback` ("Saved" | `alias_taken` | `invalid_alias`).
- `gmail-setup-entry` only when `autoSetup.available`; `gmail-setup-form`; `gmail-setup-run`; summary `gmail-setup-summary`.
- Theme: host tokens only (`--border-primary`, `--bg-tertiary`, `--severity-*`, `--accent`, `--accent-text`). `.focus-ring` on controls.
- `src/client` in `SCAN_ROOTS`, `scripts/theme-token-guard.mjs`.

## Test override
- `PI_E2E_GOOGLE_BASE_URL`: `127.0.0.1` / `localhost` only; else warn + defaults.
- `docker/test-up.sh` → `http://127.0.0.1:18090`. `tests/e2e/helpers/fake-google.ts`; `tests/e2e/gmail-plugin.spec.ts`.

## Security notes
- Request lane private, unauthenticated; any user session leases within level.
- Mail content attacker-controlled; without `untrusted-content-guard` only write confirms guard.
- Attachments: reject traversal + overwrite; symlinks refused. Parent-dir swap mid-save = residual TOCTOU.
- Logs: email, op, outcome. No tokens. Revoke fail → manual <https://myaccount.google.com/permissions>.
- Auto setup: loopback-only; secret absent from view/logs; downloads deleted `finally`; redirect guard on `accounts.google.com`. See change: add-gmail-plugin.
