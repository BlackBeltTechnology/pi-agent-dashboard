## Context

See proposal.md — Why. Built entirely on the seams from `expose-plugin-credential-and-oauth-seams`:
- `ctx.credentials` (namespace `gmail`);
- `ctx.oauth.startFlow` + `createLoopbackCallback`;
- the `ui:oauth-flow` UI primitive;
- `registerPiRequestHandler` + the `Symbol.for("pi-dashboard.pluginRequest")` request lane.

Google facts that shape the design:
- There is no public API to create a consent screen or a Desktop OAuth client.
  - The IAP OAuth Admin API is being turned down (per the `gcloud iap oauth-brands` reference: new projects blocked from Jan 19 2026, full shutdown Mar 19 2026), and it was Internal/IAP-only anyway.
  - `gcloud iam oauth-clients` is Workforce Identity Federation and unusable for Gmail.
- Desktop clients accept `http://127.0.0.1:<any port>` loopback redirects. We use path `/`.
- Incremental authorization (`include_granted_scopes`) is **not supported for installed apps**, so every consent requests the full scope set.
- The device flow does not allow Gmail scopes, and OOB is removed. That leaves loopback plus pasted-redirect.
- A refresh token is returned reliably only with `access_type=offline&prompt=consent`.
- In the "Testing" publishing status, refresh tokens expire after 7 days.
- `gmail.readonly`, `gmail.compose` and `gmail.modify` are **restricted** scopes. Personal use works via test users or an Internal (Workspace) audience; public distribution would need Google verification (out of scope).
- `gmail.modify` covers read, compose and send; `gmail.compose` covers drafts **and** sending.

## Goals / Non-Goals

**Goals**
- Several accounts, each with an explicit permission level. Every tool call names its account.
- The refresh token never leaves the server process.
- Works for a remote dashboard (paste fallback).
- Setup a non-expert can finish with the wizard.

**Non-Goals**
- Automating Google Cloud console configuration, or executing `gcloud` from the server.
- Shipping a shared OAuth client.
- Gmail push/watch notifications, Calendar/Drive (later: connector layer Phase B).
- Encryption at rest beyond 0600 (see the seams change D2).

## Decisions

### D1 — Package layout
```
packages/gmail-plugin/
  src/server/  index.ts (activate) · google-oauth.ts (OAuthLoginFlow) · accounts.ts (store) · lease.ts · gmail-rest.ts (revoke, userinfo)
  src/bridge/  index.ts (tools) · lease-client.ts (request lane + cache) · gmail-api.ts (fetch wrappers) · mime.ts
  src/client/  GmailSettings.tsx (wizard + accounts panel)
```
Manifest: `id: "gmail"`, claims `settings-section` (tab `general`), and `server`, `bridge`, `client` entries.

### D2 — Store records (namespace `gmail`)
- `client` → `{ clientId, clientSecret, projectId? }`, taken from the `installed` block of `client_secret_*.json`. A `web` block is rejected.
- `acct:<sub>` → `{ sub, email, alias?, tier, scopes[], refresh, access, expires, status: "ok"|"reauth_required", testingHint?: boolean, addedAt }`.

Account resolution happens per call from **one** `ctx.credentials.snapshot()` read:
- Match by alias first (aliases are unique, enforced when set), then by email (case-insensitive).
- Two `sub`s with the same email is ambiguous: an error asks the user to use an alias.
- Re-auth that returns a changed email for a known `sub` updates `email`.
- No match returns an error listing the known accounts. There is never an implicit default.

### D3 — Sign-in flow
`google-oauth.ts` implements `OAuthLoginFlow.login(interaction)` using `oauth4webapi`:
0. The flow `key` is `add-<uuid>` for a new account and `reauth-<sub>` for re-auth / level change. Concurrent adds never supersede each other; a repeated re-auth of the same account does.
1. Create a loopback callback (`createLoopbackCallback({ path: "/", signal: interaction.signal })`, which owns `state`, so a cancelled flow closes the listener at once), plus a PKCE verifier and an OIDC `nonce`.
2. `notify({type:"auth_url", url})`. The URL carries `scope = openid email <full tier scopes>`, `access_type=offline`, `prompt=consent select_account`, `nonce`, `login_hint=<email>` when re-authenticating, and `redirect_uri = loopback`. There is no `include_granted_scopes`.
3. Race `callback.waitForCode()` against `prompt({type:"manual_code"})`. For the pasted redirect URL, parse `code` + `state` and compare with `callback.state` (length-checked, constant-time). Reject on a mismatch with a fixed message (`state_mismatch`, `invalid_redirect`) that never includes the submitted input: flow errors are returned by the status route. When the paste wins, close the callback and attach a no-op catch to the losing `waitForCode()` promise (no unhandled rejection). When the callback wins, the host aborts the pending prompt.
4. Exchange the code with the PKCE verifier via `oauth4webapi`, and validate the `id_token` claims: issuer, audience = clientId, expiry, `nonce`. The token is received directly from Google's token endpoint over TLS, so signature validation is not required (OIDC Core §3.1.3.7). Read `sub` + `email`; `email_verified` must be true.
5. Return the credential plus `{ sub, email, grantedScopes }` as extra fields. The seam passes the returned object to `persist` untouched.

`persist` (plugin code) upserts `acct:<sub>` via `ctx.credentials.update` (atomic read-modify-write):
- On re-auth, it merges and keeps the alias.
- On a missing refresh token for a new account, it errors ("revoke app access at myaccount.google.com/permissions and retry").

### D4 — Levels and scopes

| tier | requested scopes |
|---|---|
| readonly | `gmail.readonly` |
| draft | `gmail.readonly gmail.compose` |
| send | `gmail.modify` |

- Every tool has a required tier. `lease({account, op})` checks `tierRank(account.tier) ≥ tierRank(op)` **and** that the granted scopes cover the op, using the implication table: `gmail.modify ⇒ {gmail.readonly, gmail.compose}`. Otherwise it returns `tier_denied` / `scope_missing`.
- Raising a level starts a new flow with `login_hint` and the **full** scope set of the new level. Lowering a level only rewrites `tier`; the broader grant stays but is never leased for a higher op.
- **Honest limit:** the server decides *whether* a session may obtain a token for an account at a given level. The token itself is a bearer token valid for every scope Google granted, so *which* Gmail endpoints are called is enforced by the tool code. For example, `gmail.compose` also permits sending, so a `draft`-level token *could* send if misused by in-process code. Levels are an agent-facing control, not a Google-enforced one. This is documented in the panel's help text.
- **Account visibility:** accounts are user-global. Any session on this dashboard, and any code in those sessions, can lease any connected account within its level. The request lane is private (not observable or forgeable) but not authenticated (seams design D7). The lease therefore authorizes solely on the account's level. Per-workspace restriction is future work.

### D5 — Token lease (server) and cache (bridge)
- Request type `gmail/lease` with payload `{ account, op }`. Replies with `{ accessToken, expiresAt, email, tier }`. It is called on **every** tool invocation.
- The server refreshes when `expires − now < 60 s`. Refresh is single-flight per `sub` (a promise map) and writes through `ctx.credentials.update`, so a concurrent re-auth or level change is not clobbered.
- `invalid_grant` → set `status = reauth_required` and reply `reauth_required`.
- **No bridge-side token cache.** The server keeps the current access token in its record and reuses it until 60 s before expiry. A lease is a local WebSocket round-trip, so a level change takes effect on the very next call. The bridge never persists or caches tokens.
- Tools also check the returned `tier` against the operation's required level before calling Gmail (defence in depth).
- Logs contain account email, op and outcome only.

### D6 — Tools
- `gmail_accounts` takes no `account`. It lists alias, email, level and status (server metadata, **not** untrusted).
- Every other tool requires `account`. Every mailbox-derived result (`gmail_search`, `gmail_get`, `gmail_labels`, `gmail_attachments`) carries `details.untrusted = true`, and the same four are declared untrusted to the guard.
- At load, the bridge pushes declarations to the guard registry (`(globalThis[Symbol.for("pi.untrusted-content-guard")] ??= {declarations: []}).declarations.push(…)`). Reads are declared untrusted, writes self-confirming. This is order-independent and inert without the guard.
- `gmail_search` returns metadata only (id, thread, from, subject, date, snippet), with `maxResults ≤ 50`.
- `gmail_get` returns one message or thread with a text body. HTML goes through as `details.contentType: "text/html"` so the guard can scan it.
- `gmail_attachments` lists attachments, or saves one inside the session cwd:
  - containment is checked with `packages/shared/src/path-containment.ts` on the `realpath` of the parent directory;
  - the file is created with `wx` plus `O_NOFOLLOW` where available (no overwrite, no following a final symlink);
  - residual risk: a parent directory swapped for a symlink between the check and the create (TOCTOU) is documented, not prevented;
  - Windows device/UNC forms are rejected.
- Writes (`gmail_draft`, `gmail_send`, `gmail_reply`, `gmail_modify`, `gmail_trash`) call `ctx.ui.confirm` with account, recipients, subject and a body preview. They are blocked without UI, and a dismissed or timed-out confirmation (the dashboard PromptBus default is 5 min) counts as denial.
- `gmail_reply` threads correctly with `In-Reply-To`, `References` and `threadId`.
- MIME is built with a minimal RFC 2822 builder (UTF-8, base64url, attachments from cwd).

### D7 — Setup wizard (consent screen cannot be automated)
Steps, each with a ✓ state:
1. **Project.** Two paths. Without `gcloud`: console links to create a project and enable the Gmail API (`https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=<id>`). With `gcloud`, copyable commands:
   ```
   gcloud projects create <id>
   gcloud services enable gmail.googleapis.com --project <id>
   ```
   plus a console link. The server never executes them.
2. **Branding.** `https://console.cloud.google.com/auth/branding?project=<id>`
3. **Audience.** `…/auth/audience?project=<id>`:
   - Internal for a Workspace org;
   - otherwise External + add each Gmail address as a test user;
   - a notice about 7-day tokens in Testing, and the "Publish app" option (unverified-app warning) for longer-lived tokens.
4. **Client.** `…/auth/clients/create?project=<id>`, type **Desktop app**. Download the JSON.
5. **Upload.** Validate the `installed` block, `client_id` ending in `.apps.googleusercontent.com`, and a present secret.
6. **Test sign-in.** Error mapping:
   - `access_denied` / "app not verified for this user" → step 3 (test users);
   - `redirect_uri_mismatch` or a `web` client → step 4;
   - `invalid_client` → step 5;
   - `org_internal` → step 3 (audience).

Each deep link has a fallback description ("APIs & Services → OAuth consent screen / Credentials") in case Google moves the console pages. Docs mirror these steps with screenshots.

### D8 — Test-only Google endpoint override
- `PI_E2E_GOOGLE_BASE_URL` (following the repo's `PI_E2E_*` convention) redirects the authorization, token, revoke and Gmail REST base URLs to one fake-Google server.
- It is honoured **only** when the value is a loopback URL (`http://127.0.0.1:*` or `http://localhost:*`). Any other value is ignored with a warning. So a production install can never be pointed at a foreign token endpoint.
- The fake server (`tests/e2e/helpers/fake-google.ts`) issues codes and tokens, serves id_tokens (claims only, no signature needed per D3), and records Gmail calls for assertions.

### D9 — Revoke
`POST https://oauth2.googleapis.com/revoke` with the refresh token (best effort), then `ctx.credentials.remove`. The local delete happens even if the network call fails, and the UI says so.

## Risks / Trade-offs

- **[Testing-mode 7-day expiry surprises users]** → The panel shows "re-auth needed" plus the hint. The wizard explains publishing.
- **[Prompt injection via mail]** → Untrusted results go through the guard (soft dependency), and every write is confirmed. Without the guard, only confirmations protect; the README says so. The server cannot detect a session-level extension, so there is no panel badge.
- **[Double confirmation with the guard]** → The bridge declares its write tools self-confirming via the guard API (guard design D6).
- **[Scope coarseness]** → Honest limit in D4. Levels are an agent-facing control.
- **[Restricted-scope policy changes by Google]** → Isolated in the wizard docs and the scope table. No code assumptions beyond the scope strings.

## Migration Plan

New plugin, disabled until installed or enabled. Rollback: disable. Grants persist until revoked.

## Open Questions

None blocking.
