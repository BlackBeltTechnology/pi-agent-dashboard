# Demo video scripts (unlisted YouTube, English)

One video per verified GCP project. Video B (`pi-dashboard-mail`, Gmail + full Drive) below; video A (`pi-dashboard-workspace`) at the end.

## Video B — pi-dashboard-mail (~5–7 min)

Requirements to satisfy: show the OAuth consent screen with the app name, show the **client id in the browser address bar**, and show each requested scope being used in the app. Record at readable resolution; zoom the address bar when the client id appears. Use a dedicated demo Google account and demo mailbox (no real personal data).

| # | Shot | Narration (spoken or caption) |
|---|---|---|
| 1 | pi-dashboard.dev homepage, scroll to Google block + privacy link | "pi-dashboard is self-hosted. This is our homepage and privacy policy." |
| 2 | Dashboard → Settings → Google | "Users connect Google accounts and turn on products from Settings." |
| 3 | Click "Connect with pi-dashboard.dev", tick Gmail → in-app disclosure | "Before connecting, we disclose what is accessed, where it is stored, and that content goes only to the user's AI provider." Click **I agree and connect**. |
| 4 | Pick permission level "Read" | "Users choose a permission level per account." |
| 5 | Google consent screen; **zoom on address bar showing `client_id=…apps.googleusercontent.com`**; show app name pi-dashboard and scopes | "Consent screen for project pi-dashboard-mail, client id visible." |
| 6 | Redirect back; account listed | "Sign-in completes over a local loopback redirect; the token stays on this dashboard." |
| 7 | Agent chat: "Find the latest invoice email and summarize it" → tool call `gmail_search` / `gmail_get` | "gmail.readonly: searching and reading messages." |
| 8 | "Save its PDF attachment to the project" | "gmail.readonly: attachments." |
| 9 | Raise level to Draft → re-consent (address bar again) | "Incremental authorization for gmail.compose." |
| 10 | "Draft a reply" → confirmation dialog → draft created; then send with confirm | "gmail.compose: drafts and sending, always confirmed." |
| 11 | Raise level to Send/organize → re-consent; "archive and label it Paid" → confirm | "gmail.modify: labels, archive, trash, confirmed." |
| 12 | Enable "Manage filters" → re-consent; create a filter → confirm | "gmail.settings.basic: user-confirmed filter management." |
| 12b | Drive level "Read" → re-consent (address bar); `gdrive_search` + `gdrive_export` to workspace | "drive.readonly: finding and exporting the user's files." |
| 12c | Drive level "Write" → re-consent; `gdrive_upload` with confirm; `gdrive_trash` with confirm | "drive: confirmed upload and trash; no sharing, no permanent delete." |
| 13 | Revoke account in Settings | "Users can disconnect; the token is revoked and deleted." |

Checklist before upload:
- [ ] Every scope listed in Data Access appears in a shot.
- [ ] App name and logo on consent match Branding.
- [ ] No real personal data visible.
- [ ] Video set to **Unlisted**; link pasted into the verification form.

## Video A — pi-dashboard-workspace (~5 min)

| # | Shot | Narration |
|---|---|---|
| 1 | Homepage + privacy link | as video B |
| 2 | Settings → Google → "Connect with pi-dashboard.dev" → disclosure listing products → I agree | "Disclosure before connecting." |
| 3 | Turn on Calendar (read) → consent, **zoom address bar client_id** | "Workspace client, client id visible." |
| 4 | `gcal_events` "what's on tomorrow"; raise to write → re-consent; `gcal_event_create` confirm dialog (guests not emailed) | "calendar.readonly / calendar.events" |
| 5 | Drive "App files": `gdrive_upload` a workspace file (confirm), then `gdrive_search` finds only app files | "drive.file" |
| 6 | Docs read → `gdocs_get` by URL; write → `gdocs_append_text` confirm | "documents(.readonly)" |
| 7 | Sheets read → `gsheets_read`; write → `gsheets_append` confirm (literal values) | "spreadsheets(.readonly)" |
| 8 | Slides read → `gslides_get`; write → `gslides_add_slide` confirm | "presentations(.readonly)" |
| 9 | Tasks read/write → `gtasks_list`, `gtasks_create` confirm | "tasks(.readonly)" |
| 10 | Contacts read/write → `gcontacts_search`, `gcontacts_create` confirm | "contacts(.readonly)" |
| 11 | Revoke | "Disconnect revokes and deletes tokens." |
