# Gmail plugin

## Overview

`packages/gmail-plugin` gives agent Gmail tools (`gmail_*`) for multiple Gmail accounts.
Google accounts (clients, sign-in, consent, grants) owned by [`google-plugin.md`](google-plugin.md) since `add-google-connect`.
Manage accounts: Settings → Google accounts. No Gmail-specific setup or sign-in left in Gmail UI.
Settings → Gmail: pointer notice only (`GmailSettings.tsx`).
Every tool call except `gmail_accounts` names `account` by alias or email; no default account.
Accounts remain user-global across dashboard pi sessions.
Google Connect unavailable (plugin disabled) → Gmail tools keep working from Gmail's own data.

**BREAKING (REST):** Gmail account, client and setup management routes answer `410 moved` or `503 google_connect_unavailable`. See REST routes.

See change: add-google-connect (`openspec/changes/archive/2026-11-24-add-google-connect/`). Earlier: improve-gmail-settings-ux, add-gmail-auto-setup, add-gmail-plugin.

## Package layout

| Path | Job |
|---|---|
| `src/shared/` | Gmail levels, lane protocol (`LEASE_TYPE`, `GOOGLE_LEASE_TYPE`, `DelegateReply`), Google endpoints. |
| `src/server/` | Mount moved-route refusals; `google-link.ts` soft link to Google Connect; legacy lease + legacy account store (fallback). |
| `src/bridge/` | Register tools; lease client (delegates to `google/lease` when Google Connect owns accounts); Gmail REST calls; MIME; attachment confinement. |
| `src/client/` | `GmailSettings.tsx`: pointer notice + Google Connect status only. |

Legacy sign-in code (`src/server/google-oauth.ts`, `accounts.ts`, `store-client.ts`) remains in tree. No REST route reaches it.

## Google Connect link

`src/server/google-link.ts`. Gmail declares NO `dependsOn` on `google` (hard dependency would stop Gmail loading when `google` disabled).

- At FIRST request after start: `consumeAll("google.connect")`. Entry used only when `provider === "google"`.
- Hands legacy client + accounts to `importLegacyGmail` once (see Migration).
- Decides per process: `usable` (provider present) and `delegating` (usable AND migration complete).
- `usable` → management routes answer `410 moved`.
- `delegating` → `gmail/lease` and `gmail/accounts` reply `{ delegate: "google" }`. No fallback to legacy tokens for delegating process.
- Import failed or partial (`skipped > 0`) → not delegating; Gmail leases from own data; retried next start.
- Enable/disable `google` takes effect after restart.

Log: `[gmail] legacy import to Google accounts: <n> account(s)` / `... incomplete ...` / `... failed ...`.

## Token lease

`gmail/lease` = bridge → server private lane (hub-local only, `origin_denied` otherwise).

```mermaid
sequenceDiagram
  participant T as bridge tool
  participant L as lease-client.ts
  participant H as gmail server lease
  participant GL as google/lease lane
  participant S as legacy AccountStore
  T->>L: lease(account, op)
  L->>H: gmail/lease {account, op}
  alt delegating
    H-->>L: {delegate:"google"}
    L->>GL: google/lease {account, product:"gmail"}
    GL-->>L: {accessToken, expiresAt, email, level, options?}
  else legacy fallback
    H->>S: resolve alias then email
    H->>H: gate tier_denied → scope_missing → reauth_required
    opt expires − now ≤ 60 s
      H->>H: refresh token (single-flight per sub)
    end
    H-->>L: {accessToken,expiresAt,email,tier}
  end
  L->>L: re-check level; no token cache
  L-->>T: short-lived access token
```

Delegated refusals re-spelled as Gmail errors by the lease client (`bridge/lease-client.ts` `googleRefusal`): `product_disabled` → Gmail-off message naming Settings → Google accounts; `default_client_unavailable` / `no_client` → existing `no_client` code. Filter ops need `options.filters === true` in the reply, else `filters_disabled`.

Legacy gate refusals happen before network calls.
`invalid_grant` marks `reauth_required`; later leases refuse without network calls.
Other refresh failures return `refresh_failed`.
Refresh token stays on server; reply contains exactly `{accessToken,expiresAt,email,tier}` (legacy) or `{accessToken,expiresAt,email,level}` (delegated).
Next tool call sees lowered level.

## Levels

| Level | Google scopes requested | Allowed tools |
|---|---|---|
| `readonly` | `gmail.readonly` | `gmail_search`, `gmail_get`, `gmail_labels`, `gmail_attachments` |
| `draft` | `gmail.readonly gmail.compose` | Read tools + `gmail_draft` |
| `send` | `gmail.modify` | Read and draft tools + `gmail_send`, `gmail_reply`, `gmail_modify`, `gmail_trash` |

Levels set in Settings → Google accounts (product `gmail` of `google-plugin`). Option `filters` → `gmail.settings.basic`.
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

## Gmail API errors

Bridge 403 classification (`packages/gmail-plugin/src/bridge/gmail-api.ts` `classify403`).
Reads Google `reason` only from `error.details[]` entries whose `@type` ends `google.rpc.ErrorInfo` + legacy `error.errors[].reason`.
`SERVICE_DISABLED`/`accessNotConfigured` (and `metadata.service` absent or `gmail.googleapis.com`) → tool code `api_disabled`.
Message names project number only when `metadata.consumer` matches `^projects/(\d{1,20})$`; then `gcloud services enable gmail.googleapis.com --project=<n>`.
`ACCESS_TOKEN_SCOPE_INSUFFICIENT`/`insufficientPermissions` → `scope_insufficient` (re-authenticate with every permission ticked).
Anything else / parse failure → unchanged `gmail_error: Gmail returned HTTP 403`.
Google free text (`message`, `activationUrl`) never echoed.

See change: improve-gmail-settings-ux.

## Storage

Gmail namespace `gmail` in `~/.pi/agent/plugin-credentials.json` (mode 0600, encrypted at rest; see [`credential-vault.md` §12](credential-vault.md#12-encryption-at-rest)). Namespace kept after migration; not deleted.

| Key | Content | Status |
|---|---|---|
| `client` | Desktop OAuth `clientId`, `clientSecret`, optional `projectId`. | Rollback source. |
| `acct:<sub>` | email, alias, tier, scopes, refresh, access, expiry, status, testing hint, added time. | Rollback source. |
| `migrated` | `{ at, version, subs }` written after successful import. | Migration marker. |

Writes after migration are NOT written back. Levels/aliases/filters changed in Google Connect stay there.
Legacy revoke / re-auth paths unreachable via REST.
Disable or uninstall leaves Google grants intact.

Authoritative account data for Gmail while delegating: `google` plugin namespace `google` (`acct:<sub>`, `client:<id>`). See [`google-plugin.md`](google-plugin.md#storage).

## Migration and rollback

Migration (one-time, idempotent per `sub`): see `google-plugin.md` → Migration and rollback.
Gmail side: `importLegacyGmail({ client, accounts })` via `google.connect`; on success writes `migrated`.

Rollback to previous build: Gmail reads untouched `gmail` namespace. Keeps working for accounts whose legacy token still valid.
Not covered: accounts first connected after migration; accounts re-signed after `reauth_required`; accounts whose access removed at Google; Google invalidating older refresh tokens on issue of new ones (spike 0.1).

## REST routes

Gmail routes in encapsulated scope; `networkGuard` + `@fastify/rate-limit` (loopback allow-listed). Tier `operate` (`packages/shared/src/route-tiers.ts`).

Every management route below stores nothing and answers a fixed refusal:
- `410 { "error": "moved" }` while Google Connect is usable.
- `503 { "error": "google_connect_unavailable" }` while it is not (plugin disabled or no credential store).

| Method | Path | Answer |
|---|---|---|
| `GET` | `/api/plugins/gmail/state` | `{ moved: true }` when usable; else `{ moved: false, googleConnect: "unavailable" }`. |
| `PUT` | `/api/plugins/gmail/client` | 410 / 503. |
| `PUT` | `/api/plugins/gmail/setup` | 410 / 503. |
| `GET` | `/api/plugins/gmail/accounts` | 410 / 503. |
| `POST` | `/api/plugins/gmail/accounts` | 410 / 503. |
| `PATCH` | `/api/plugins/gmail/accounts/:sub` | 410 / 503. |
| `DELETE` | `/api/plugins/gmail/accounts/:sub` | 410 / 503. |
| `POST` | `/api/plugins/gmail/accounts/:sub/level` | 410 / 503. |
| `POST` | `/api/plugins/gmail/accounts/:sub/reauth` | 410 / 503. |
| `POST` | `/api/plugins/gmail/accounts/:sub/filters` | 410 / 503. |
| `POST` | `/api/plugins/gmail/setup/run` | 410 / 503. Setup now `/api/plugins/google/setup/run`. |
| `GET` | `/api/plugins/gmail/setup/run/:id` | 410 / 503. |
| `POST` | `/api/plugins/gmail/setup/run/:id/continue` | 410 / 503. |
| `POST` | `/api/plugins/gmail/setup/run/:id/takeover` | 410 / 503. |
| `DELETE` | `/api/plugins/gmail/setup/run/:id` | 410 / 503. |

Replacement: `/api/plugins/google/*` (see `google-plugin.md` → REST routes).
Migration of REST callers: BREAKING. Callers move to `google` routes.

## Settings UI

`GmailSettings.tsx` (Settings → Gmail) renders pointer only:
- Usable: notice "Gmail accounts are now managed under Settings → Google accounts. Nothing to reconnect." + link "Open Google accounts".
- Unavailable: "Turn on Google accounts to manage Gmail accounts".

Account cards, client wizard, automatic setup, revoke dialog, level selector: moved to `GoogleSettings.tsx` / `OrgSignIn.tsx` in `packages/google-plugin/src/client/`.
Theme uses only declared host tokens. `.focus-ring` on every control.

## Test override

`PI_E2E_GOOGLE_BASE_URL` redirects Google endpoints only for `http://127.0.0.1:*` or `http://localhost:*`.
Other values trigger warning and fall back to Google defaults.
`docker/test-up.sh` sets harness default `http://127.0.0.1:18090`.
`tests/e2e/helpers/fake-google.ts` runs in-container; `tests/e2e/gmail-plugin.spec.ts` exercises flow.

## Security notes

Request lane stays private but unauthenticated; any user session can lease connected accounts within level. Delegated lease on hub-local lanes only (`origin_denied` for remote origin).
Mail content remains attacker-controlled; without `untrusted-content-guard`, only write confirmations protect agent.
Attachment save rejects traversal and overwrite; symlinked targets/parents refused; parent-directory swap by another local process mid-save remains documented residual TOCTOU.
Logs contain email, operation, outcome; no tokens.
Credential file encrypted at rest. Same-user agent bash still reads the keychain on Linux, Windows and some macOS signatures. Threat model: [`credential-vault.md` §12.9](credential-vault.md#129-threat-model).
Local revoke failure needs manual Google removal at <https://myaccount.google.com/permissions>.
Setup-run security (loopback start, secret masking, ephemeral owner context, redirect guard): see [`google-plugin.md`](google-plugin.md#setup-add-organisation-sign-in).

See change: add-gmail-plugin.
