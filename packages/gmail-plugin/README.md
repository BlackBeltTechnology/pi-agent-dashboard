# @blackbelt-technology/pi-dashboard-gmail-plugin

Multi-account Gmail for pi agents, managed from the pi-dashboard.

- Guided Google Cloud setup (you bring your own OAuth client — Google offers no API to create one).
- Several Gmail accounts, each with its own **permission level**.
- Refresh tokens stay in the dashboard server; tools get a short-lived access token per call.
- Account-scoped tools; every write is confirmed by you.

## Setup (Settings → General → Gmail)

The wizard walks through these steps. Each console link carries `?project=<id>`.

1. **Project + Gmail API.** Create a Google Cloud project and enable the Gmail API — via the console links, or run the copyable commands yourself:
   ```sh
   gcloud projects create <project-id>
   gcloud services enable gmail.googleapis.com --project <project-id>
   ```
   The dashboard never runs `gcloud`.
2. **Branding.** Console → Google Auth Platform → Branding (older consoles: *APIs & Services → OAuth consent screen*). Fill in the app name and support email.
3. **Audience.**
   - Workspace organisation: **Internal**.
   - Otherwise **External**, and add every Gmail address you will connect as a **test user**.
   - For an **External** app in *Testing* status, Google expires refresh tokens after **7 days** (the panel shows a `testing: 7-day` badge). *Publish app* gives longer-lived tokens, with an "unverified app" warning at sign-in.
4. **Client.** Clients → Create client → application type **Desktop app**. Download the JSON.
5. **Upload** the `client_secret_*.json`. Only a Desktop (`installed`) client is accepted; a Web client is rejected.
6. **Test sign-in** = add your first account.

Sign-in errors point back to the step that fixes them:

| Error | Fix in step |
|---|---|
| `access_denied` ("app not verified for this user") | 3 — add the address as a test user |
| `org_internal` | 3 — audience |
| `redirect_uri_mismatch`, Web client | 4 — create a **Desktop** client |
| `invalid_client` | 5 — re-upload the client JSON |

Remote dashboards: the sign-in listens on a `127.0.0.1` loopback port of the **dashboard host**. When your browser runs elsewhere, the redirect page fails to load — copy its full URL from the address bar and paste it into the flow view.

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

## Prompt injection

Mail content is attacker-controlled. Mailbox-derived results are marked `details.untrusted = true` and declared to the optional `untrusted-content-guard` extension (reads untrusted, writes self-confirming). **Without the guard only the write confirmations protect you** — install it if agents read mail from strangers.

## Storage and removal

- `~/.pi/agent/plugin-credentials.json`, namespace `gmail` (plaintext, mode 0600 — same posture as `auth.json`): the OAuth client and one record per account.
- **Revoke** in the panel calls Google's revoke endpoint (best effort) and deletes the local record. If Google cannot be reached, revoke manually at <https://myaccount.google.com/permissions>.
- Disabling or uninstalling the plugin does not revoke grants.

## Testing

`PI_E2E_GOOGLE_BASE_URL` points every Google endpoint at a fake server. It is honoured **only** for `http://127.0.0.1:*` / `http://localhost:*`; any other value is ignored with a warning.
