## Why

Users want pi agents to work with **several Gmail accounts** (work, personal, clients), with per-account control over what the agent may do. Existing pi Gmail extensions are single-account, keep their own ad-hoc token files, and have no dashboard UI. The dashboard now has the seams to do this properly: credential store, plugin OAuth flows, and the request lane (`expose-plugin-credential-and-oauth-seams`). This is the first plugin to use them, and the proving ground for a later refactor into the generic connector layer (`add-connector-layer`, Phase B).

## What Changes

- New dashboard plugin `packages/gmail-plugin` (manifest id `gmail`) with `server`, `bridge` and `client` entries.
- **Setup wizard** (settings-section). Google offers no public API to create an OAuth consent screen or a Desktop OAuth client, so the wizard guides the user:
  - copyable `gcloud` commands for project creation and enabling the Gmail API;
  - deep links to the Google Auth Platform pages (branding, audience + test users, Desktop client);
  - upload of `client_secret_*.json` with Desktop-client validation;
  - a test sign-in whose failures are mapped to the wizard step that fixes them.
- **Multi-account sign-in.** The OAuth flow (PKCE + state, loopback `127.0.0.1` redirect, pasted-redirect fallback for remote dashboards) runs through the host flow machinery. Each account is keyed by Google's verified `sub` and shown with its email. An optional alias is supported. There is no default account.
- **Permission levels per account:**

  | Level | Scopes | Allows |
  |---|---|---|
  | `readonly` | `gmail.readonly` | read |
  | `draft` | `+ gmail.compose` | + drafts |
  | `send` | `gmail.modify` | + send, reply, label, archive, trash |

  - Raising a level re-consents with the added scopes.
  - Lowering a level applies immediately.
  - Levels are enforced by the plugin: the server lease refuses tokens above the level, and the tools refuse operations above it. The token itself carries Google's granted scopes; the panel states this limit.
- **Token lease.** Tools request a short-lived access token per account and operation over the private request lane. The refresh token never leaves the server process. Refresh is single-flight per account. A dead grant marks the account "re-auth needed".
- **Tools** (bridge). `gmail_accounts` lists accounts; every other tool requires `account`:
  - `gmail_search`, `gmail_get` (message or thread), `gmail_labels`, `gmail_attachments`;
  - `gmail_draft`;
  - `gmail_send`, `gmail_reply`, `gmail_modify`, `gmail_trash`.

  Every write-class call is confirmed via `ctx.ui.confirm` and blocked when no UI is available. Mailbox-content results declare `details.untrusted = true`. The bridge declares its tools to `untrusted-content-guard` (reads untrusted, writes self-confirming).
- **Accounts panel.** List, add, re-authenticate, change level, alias, revoke (Google token revocation + local delete). Status badges: ok / re-auth needed / testing-mode 7-day expiry hint.
- **Account visibility:** accounts are user-global, and any session on the dashboard may use them within their level. Per-workspace restriction is future work.

## Capabilities

### New Capabilities
- `gmail-plugin`: guided Google OAuth client setup, multi-account Gmail sign-in with per-account permission levels, server-side token leasing, and account-scoped Gmail tools with confirmed writes.

### Modified Capabilities
<!-- none -->

## Impact

- **New package** `packages/gmail-plugin/` (server, bridge, client entries; `configSchema.json`; i18n catalog).
- **Depends on** `expose-plugin-credential-and-oauth-seams` (hard) and `add-untrusted-content-guard` (soft: the tools work without it; results are just not sanitised).
- **Dependency:** `oauth4webapi` (MIT, zero-dependency) for PKCE / code exchange / refresh / ID-token claims. Gmail REST is called with `fetch`, not `googleapis`.
- **External prerequisite:** the user's own Google Cloud project + Desktop OAuth client.
- **Storage:** `plugin-credentials.json` namespace `gmail` holds the client credentials and one record per account.
- **Rollback:** disable or uninstall the plugin. Stored grants remain until revoked from the panel or at `myaccount.google.com/permissions`.

## Discipline Skills

- `security-hardening`: refresh tokens, the redirect/paste input, the level-enforcement boundary, and untrusted mail content.
- `observability-instrumentation`: a new external call path (Google token + Gmail API). Log per-account refresh and lease outcomes without tokens.
- `doubt-driven-review`: the token-lease boundary and level enforcement before they stand.
- `review-code`: before commit.
