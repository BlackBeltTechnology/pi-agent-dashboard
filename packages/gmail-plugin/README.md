# @blackbelt-technology/pi-dashboard-gmail-plugin

Multi-account Gmail for pi agents, managed from the pi-dashboard.

- Accounts and OAuth clients are managed in **Settings → Google accounts** (Google Connect), including the guided Google Cloud setup.
- Several Gmail accounts, each with its own **permission level**.
- Refresh tokens stay in the dashboard server; tools get a short-lived access token per call.
- Account-scoped tools; every write is confirmed by you.

## Setup (Settings → Google accounts)

Gmail accounts, OAuth clients and the guided Google Cloud setup are managed by the **Google accounts** plugin
(`@blackbelt-technology/pi-dashboard-google-plugin`): open **Settings → Google accounts**, connect an account and turn
on **Gmail** with a level. This plugin only provides the Gmail tools and the `gmail` product's permission levels; it
stores no accounts or clients of its own.

- Accounts and clients connected with the previous Gmail-only wizard are imported into Google accounts once, on the first
  start after upgrading (client → "Gmail client (migrated)"; each account keeps its level, aliases and filters).
- When the Google accounts plugin is disabled, the Gmail tools stop working and Gmail's settings say "Turn on Google
  accounts to manage Gmail accounts".
- Sign-in errors (`access_denied`, `org_internal`, `admin_policy_enforced`, `scope_missing`, `redirect_uri_mismatch`,
  `invalid_client`) are explained, with the fix, in the Google accounts connect dialog. Remote dashboards, return paths
  and the "Window didn't come back?" switch are described in the Google plugin README.
- REST: the former `/api/plugins/gmail/{client,setup,accounts,…}` management routes answer `410 { "error": "moved" }`
  (`503 { "error": "google_connect_unavailable" }` while Google accounts is off). Use the Google plugin's routes.


## Permission levels

| Level | Google scopes requested | Tools allowed |
|---|---|---|
| `readonly` | `gmail.readonly` | `gmail_search`, `gmail_get`, `gmail_labels`, `gmail_attachments` |
| `draft` | `gmail.readonly gmail.compose` | + `gmail_draft` |
| `send` | `gmail.modify` | + `gmail_send`, `gmail_reply`, `gmail_modify`, `gmail_trash` |

- Raising a level re-consents with the new level's full scope set.
- Lowering a level applies immediately — the very next tool call is refused.

**Honest limit.** Levels are enforced by this plugin (the server refuses to lease a token for an operation above the level, and the tools re-check). They are **not** enforced by Google: an access token is valid for every scope Google granted — e.g. `gmail.compose` also permits sending. Levels control what the agent's tools may do, not what arbitrary in-process code could do with a token.

**Visibility.** Accounts are user-global: any pi session on this dashboard may use any connected account within its level. Every tool call must name its account (`account: "<alias or email>"`); there is no default.

## Tools

| Tool | Level | Notes |
|---|---|---|
| `gmail_accounts` | — | Lists alias, email, level, status. |
| `gmail_search` | readonly | Gmail query syntax, metadata only, `maxResults` 1–50. |
| `gmail_get` | readonly | One message, or a thread (`thread: true`). |
| `gmail_labels` | readonly | Label ids + names. |
| `gmail_attachments` | readonly | List, or save one inside the session cwd (never overwrites; symlinked targets/parents refused — a parent directory swapped for a symlink mid-save by another local process is a documented residual race). |
| `gmail_draft` | draft | Confirmed. |
| `gmail_send` / `gmail_reply` | send | Confirmed; replies thread via `In-Reply-To` / `References` / `threadId`. |
| `gmail_modify` / `gmail_trash` | send | Confirmed. Archive = remove label `INBOX`. |

Writes need a UI to confirm: a headless session is blocked, and a dismissed or timed-out prompt counts as "no".

Gmail API `403` errors are classified from Google's machine-readable reason only (its free text is never echoed):

| Tool error code | Meaning / fix |
|---|---|
| `api_disabled` | The Gmail API is disabled in the OAuth client's Google Cloud project. The message names the project number and the command: `gcloud services enable gmail.googleapis.com --project=<n>` (or APIs & Services → Library → Gmail API → Enable), then retry in a minute. |
| `scope_insufficient` | The account's grant lacks the Gmail permission. Re-authenticate it in Settings → Google accounts with every permission ticked. |
| `gmail_error` | Any other 403. |

## Prompt injection

Mail content is attacker-controlled. Mailbox-derived results are marked `details.untrusted = true` and declared to the optional `untrusted-content-guard` extension (reads untrusted, writes self-confirming). **Without the guard only the write confirmations protect you** — install it if agents read mail from strangers.

## Storage and removal

- Accounts, clients and tokens live in the Google accounts plugin (`~/.pi/agent/plugin-credentials.json`, namespace `google`, plaintext, mode 0600 — same posture as `auth.json`). The legacy `gmail` namespace is only read once, to import it; it is never written back.
- **Revoke** in Settings → Google accounts calls Google's revoke endpoint (best effort) and deletes the local record. If Google cannot be reached, revoke manually at <https://myaccount.google.com/permissions>.
- Disabling or uninstalling the plugin does not revoke grants.

## Testing

`PI_E2E_GOOGLE_BASE_URL` points every Google endpoint at a fake server. It is honoured **only** for `http://127.0.0.1:*` / `http://localhost:*`; any other value is ignored with a warning.

## Rolling back

Rolling back to the pre-Google-Connect build keeps Gmail working only for accounts whose legacy token is still valid. It does not cover accounts first connected after the migration, accounts re-signed after `reauth_required`, accounts whose access was removed at Google, or Google invalidating older refresh tokens when it issues new ones. Levels, aliases and filters changed after migration are not written back.
