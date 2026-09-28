# Gmail plugin

## Overview

`packages/gmail-plugin` connects multiple Gmail accounts to pi-dashboard.
Settings → General → Gmail guides Google Cloud setup.
Create project; enable Gmail API; configure Branding and Audience; upload Desktop `client_secret_*.json`; test sign-in.
Google offers no setup API; dashboard never runs `gcloud`.
Workspace users choose Internal; others choose External and add test users.
Testing status expires refresh tokens after 7 days; panel shows `testing: 7-day`.
Every tool call except `gmail_accounts` names `account` by alias or email; no default account.
Accounts remain user-global across dashboard pi sessions.

## Package layout

| Path | Job |
|---|---|
| `src/shared/` | Validate Desktop client JSON; define scopes, levels, lane protocol, Google endpoints. |
| `src/server/` | Mount routes; run OAuth; store accounts; gate token leases; revoke grants. |
| `src/bridge/` | Register tools; request leases; call Gmail REST; build MIME; confine attachments. |
| `src/client/` | Render setup wizard and accounts panel through settings-section claim. |

## Sign-in flow

```mermaid
sequenceDiagram
  participant C as client
  participant R as routes.ts
  participant O as google-oauth.ts
  participant G as Google
  participant S as AccountStore
  C->>R: POST /api/plugins/gmail/accounts (tier)
  R->>R: ctx.oauth.startFlow key add-<uuid> / reauth-<sub>
  R->>O: createGoogleLoginFlow
  O->>O: createLoopbackCallback path "/"; PKCE + nonce
  O->>C: auth_url (openid email + full tier scopes)
  C->>G: authorize (offline; consent select_account)
  par local callback
    G-->>O: loopback code + state
  and remote browser fallback
    C-->>O: manual_code pasted redirect URL
  end
  O->>O: race callback vs paste; check state
  O->>G: oauth4webapi code exchange (PKCE)
  G-->>O: tokens + id_token
  O->>O: validate iss/aud/exp/nonce + email_verified
  O-->>R: sub, email, scopes, tokens
  R->>S: persist via upsertFromSignIn
  S->>S: ctx.credentials.update("acct:<sub>")
```

Remote browser cannot reach dashboard-host `127.0.0.1`; paste full redirect URL.
Re-auth requires same `sub`; mismatch returns `account_mismatch`.
New account without refresh token fails without persistence.
Lower level applies immediately when scopes cover it; higher level starts full-scope re-consent.

## Token lease

```mermaid
sequenceDiagram
  participant T as bridge tool
  participant L as LeaseClient
  participant H as lease.ts
  participant S as AccountStore
  participant G as Google
  T->>L: lease(account, op)
  L->>H: requestPluginServer("gmail","gmail/lease",{account,op})
  H->>S: resolve alias then email from one snapshot
  H->>H: gate tier_denied → scope_missing → reauth_required
  opt expires − now ≤ 60 s
    H->>G: refresh token (single-flight per sub)
    G-->>H: access token or invalid_grant
    H->>S: update tokens if refresh grant unchanged
    Note over H,S: invalid_grant → status reauth_required
  end
  H-->>L: {accessToken,expiresAt,email,tier}
  L->>L: re-check tier; no token cache
  L-->>T: short-lived access token
```

Gate refusals happen before network calls.
`invalid_grant` marks `reauth_required`; later leases refuse without network calls.
Other refresh failures return `refresh_failed`.
Refresh token stays on server; reply contains exactly `{accessToken,expiresAt,email,tier}`.
Next tool call sees lowered level.

## Levels

| Level | Google scopes requested | Allowed tools |
|---|---|---|
| `readonly` | `gmail.readonly` | `gmail_search`, `gmail_get`, `gmail_labels`, `gmail_attachments` |
| `draft` | `gmail.readonly gmail.compose` | Read tools + `gmail_draft` |
| `send` | `gmail.modify` | Read and draft tools + `gmail_send`, `gmail_reply`, `gmail_modify`, `gmail_trash` |

Server gates level and granted scopes; bridge re-checks level.
Google grants bearer tokens for scopes, not plugin levels.
`gmail.compose` also permits sending; arbitrary in-process code could misuse draft-level token.
Levels constrain agent tools, not Google endpoints.

## Tools

`gmail_accounts` lists alias, email, level, status without `account`.
`gmail_search` returns metadata; `maxResults` ranges 1–50.
`gmail_get` reads message or thread; HTML sets `details.contentType: "text/html"`.
`gmail_labels` reads labels; `gmail_attachments` lists or saves in session cwd.
Mailbox reads carry `details.untrusted = true`; bridge declares reads untrusted to optional `untrusted-content-guard`.
`gmail_draft`, `gmail_send`, `gmail_reply`, `gmail_modify`, `gmail_trash` require `ctx.ui.confirm`; bridge declares writes selfConfirming to guard.
Confirmation shows account, recipients, subject, body preview; headless sessions block writes; dismissal or timeout denies.
`gmail_reply` threads via `In-Reply-To`, `References`, `threadId`; archive removes `INBOX`.

## Storage

`~/.pi/agent/plugin-credentials.json` stores plaintext mode 0600 under namespace `gmail`.
`client` stores Desktop OAuth `clientId`, `clientSecret`, optional `projectId`.
`acct:<sub>` stores email, alias, tier, scopes, refresh, access, expiry, status, testing hint, added time.
`AccountStore.upsertFromSignIn` merges re-auth records and keeps alias.
Revoke attempts Google endpoint, then deletes local record even when remote call fails.
Disable or uninstall leaves Google grants intact.

## REST routes

All routes use `operate` tier (`packages/shared/src/route-tiers.ts`), `networkGuard`, `@fastify/rate-limit`, MCP denylist.
Responses omit tokens and client secret.

| Method | Path | Action |
|---|---|---|
| `GET` | `/api/plugins/gmail/state` | Return client metadata and account summaries. |
| `PUT` | `/api/plugins/gmail/client` | Validate and save Desktop client JSON. |
| `POST` | `/api/plugins/gmail/accounts` | Start add flow; default `readonly`. |
| `POST` | `/api/plugins/gmail/accounts/:sub/level` | Apply covered level or start re-consent. |
| `POST` | `/api/plugins/gmail/accounts/:sub/reauth` | Re-consent current level. |
| `PATCH` | `/api/plugins/gmail/accounts/:sub` | Change alias. |
| `DELETE` | `/api/plugins/gmail/accounts/:sub` | Attempt remote revoke; delete local account. |

## Test override

`PI_E2E_GOOGLE_BASE_URL` redirects Google endpoints only for `http://127.0.0.1:*` or `http://localhost:*`.
Other values trigger warning and fall back to Google defaults.
`docker/test-up.sh` sets harness default `http://127.0.0.1:18090`.
`tests/e2e/helpers/fake-google.ts` runs in-container; `tests/e2e/gmail-plugin.spec.ts` exercises flow.

## Security notes

Request lane stays private but unauthenticated; any user session can lease connected accounts within level.
Mail content remains attacker-controlled; without `untrusted-content-guard`, only write confirmations protect agent.
Attachment save rejects traversal, symlink escape, overwrite; parent swap before create remains TOCTOU risk.
Logs contain email, operation, outcome; no tokens.
Local revoke failure needs manual Google removal at <https://myaccount.google.com/permissions>.

See change: add-gmail-plugin.
