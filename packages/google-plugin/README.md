# @blackbelt-technology/pi-dashboard-google-plugin

Google accounts ("Google Connect") for the pi dashboard: the one owner of Google OAuth clients, accounts,
product grants and server-side token leases. Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks and Contacts
agent tools all run on it. See `openspec/changes/archive/2026-11-24-add-google-connect/` and `openspec/specs/google-connect/spec.md`.

Manage everything in **Settings → Google accounts**.

## What it does

- Connects one or more Google accounts to the dashboard and lets you turn products on per account, each with its own
  level (read / write, Gmail readonly / draft / send, Drive files / read / write).
- Keeps refresh tokens in the dashboard server only. Agent tools get a short-lived access token per call (a
  "lease"); the server refuses a lease for a product or level the account has not been granted.
- Replaces the old Gmail-only setup wizard: existing Gmail clients and accounts are imported once, on first start.

## Clients

| Client | Type | Use |
|---|---|---|
| Built-in pi-dashboard.dev app | Desktop + Web | Zero setup. Ships empty until Google verification completes; never offers full Drive or restricted scopes on the remote return page. |
| Own OAuth client | Desktop (`installed`) or Web | Your own Google Cloud project; no verification needed for personal use. Linked to one or more email domains so the right client is picked per account. |

An account is bound to ONE client and ONE grant. Consent always asks for the union of granted + required scopes; a
reply narrower than what the account relies on changes nothing.

## Accounts and products

Products: Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks, Contacts. Raising a level re-consents; lowering it
applies at once (the next tool call is refused). Revoking an account asks for confirmation, calls Google's revoke
endpoint (best effort) and deletes the local record.

## Setup

1. Open **Settings → Google accounts → Connect a Google account**.
2. Pick the built-in app (if available) or add your own client — the guided Google Cloud setup walks through project,
   API enablement, branding, audience and client creation (the dashboard never runs `gcloud` itself). For an
   External app in *Testing* status Google expires refresh tokens after 7 days; add every address as a test user.
3. Choose products + levels and sign in. Return path is chosen per request and can be switched from the dialog
   ("Window didn't come back?"):
   - **Local** — browser on the dashboard host: loopback redirect.
   - **Paste** — remote browser, Desktop client: copy the failed redirect URL and paste it back.
   - **Own Web callback** — your Web client redirects to the dashboard's own callback.
   - **Return page** — built-in Web client via the static `pi-dashboard.dev/oauth/return` page (no restricted scopes).

## Operator switches

| Variable | Effect |
|---|---|
| `PI_GOOGLE_DEFAULT_CLIENTS=off` | No built-in app (new sign-ins AND refresh of built-in grants). **Set it on server deployments** so a shared host never signs in through the built-in app. |
| `PI_GOOGLE_REMOTE_RETURN=off` | No return-page sign-in (new sign-ins only). |

Values `off`, `0`, `false` (case-insensitive) disable.

## Agent tools

Every tool's first argument is `account` (alias or email; unknown or ambiguous names are refused). Writes are confirmed
by you in the UI — a headless session is blocked and a dismissed or timed-out prompt counts as "no". Large results are
paged; Google 403s are classified (`api_disabled`, `scope_insufficient`, else `<product>_error`), 429/5xx back off at
most 3 times.

| Product | Tools |
|---|---|
| Gmail (`gmail-plugin`) | `gmail_accounts`, `gmail_search`, `gmail_get`, `gmail_labels`, `gmail_attachments`, `gmail_draft`, `gmail_send`, `gmail_reply`, `gmail_modify`, `gmail_trash` |
| Calendar | `gcal_calendars`, `gcal_events`, `gcal_event_get`, `gcal_freebusy`, `gcal_event_create`, `gcal_event_update`, `gcal_event_delete`, `gcal_event_respond` |
| Drive | `gdrive_search`, `gdrive_get`, `gdrive_pick`, `gdrive_download`, `gdrive_export`, `gdrive_upload`, `gdrive_create_folder`, `gdrive_move`, `gdrive_trash` |
| Docs | `gdocs_get`, `gdocs_create`, `gdocs_append_text`, `gdocs_replace_text` |
| Sheets | `gsheets_get`, `gsheets_read`, `gsheets_create`, `gsheets_write`, `gsheets_append` |
| Slides | `gslides_get`, `gslides_create`, `gslides_add_slide`, `gslides_replace_text` |
| Tasks | `gtasks_lists`, `gtasks_list`, `gtasks_create`, `gtasks_update`, `gtasks_complete`, `gtasks_delete` |
| Contacts | `gcontacts_search`, `gcontacts_get`, `gcontacts_create`, `gcontacts_update` |

Files written to disk (Drive download/export, Gmail attachments) stay inside the session cwd and never overwrite.
Levels are enforced by the plugin, not by Google: a leased access token is valid for every scope the grant holds.

## Privacy and Limited Use

- Tokens are exchanged and stored only by your dashboard server (`~/.pi/agent/plugin-credentials.json`, namespace `google`, mode 0600,
  same posture as `auth.json`). The pi-dashboard.dev return page never sees or stores tokens; it only relays the
  authorization code to the dashboard address you confirm.
- Data from Google APIs is used only to provide the tools you invoke. It is not sold, used for advertising, or used to
  train models; pi-dashboard's use and transfer of information received from Google APIs adheres to the
  [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
  including the Limited Use requirements. See <https://pi-dashboard.dev/privacy> and <https://pi-dashboard.dev/terms>.
- Mail, documents and other content returned by tools is attacker-controlled: it is marked untrusted for the
  optional `untrusted-content-guard` extension.
- Disabling or uninstalling the plugin does not revoke grants; revoke at <https://myaccount.google.com/permissions>.

## Rolling back

Rolling back to the pre-Google-Connect build keeps Gmail working **for accounts whose legacy token is still valid**.
It does not cover: accounts first connected after the migration, accounts re-signed after `reauth_required`, accounts
whose access was removed at Google, or the case where Google invalidates older refresh tokens when issuing new ones.
Levels, aliases and filters changed after migration are not written back. Calendar, Drive and the other products have
no pre-migration equivalent.

## Testing

`PI_E2E_GOOGLE_BASE_URL` points every Google endpoint at a fake server; honoured only for `http://127.0.0.1:*` /
`http://localhost:*`.
