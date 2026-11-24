# Scope justifications

One verification per GCP project. Section A → `pi-dashboard-workspace`, section B → `pi-dashboard-mail`.

# B. Project `pi-dashboard-mail` (restricted)

Paste per scope into Google Auth Platform → Data Access. Keep wording consistent with the demo video and privacy policy. Confirm each scope's tier in the console.

## `openid`, `.../auth/userinfo.email` (non-sensitive)
Identify the connected Google account (stable subject id) and show its verified email, so users can connect several accounts and the agent can address each by email or alias.

## `https://www.googleapis.com/auth/gmail.readonly`
Core feature: the user asks their AI agent to find and read mail ("summarize unread mail from my accountant this week", "find the invoice PDF from X and save it to my project"). Requires message search, message/thread bodies and attachments. Narrower scopes are insufficient: `gmail.metadata` excludes bodies and attachments, and does not support search queries (`q`), which the feature depends on. Selected as the account's "Read" level.

## `https://www.googleapis.com/auth/gmail.compose`
"Draft" level: the agent drafts replies for the user to review, and sends a draft only after the user confirms in a dialog that shows recipients, subject and body. `gmail.send` alone cannot create or update drafts.

## `https://www.googleapis.com/auth/gmail.modify`
"Send/organize" level: user-confirmed actions — apply/remove labels, archive, mark read, move to trash. No narrower scope permits label changes. Permanent deletion is not offered. Requested only when the user picks this level for that account (incremental authorization).

## `https://www.googleapis.com/auth/gmail.settings.basic`
Opt-in per account ("Manage filters"): list filters, and create/delete filters the user confirms (e.g. "archive newsletters from X"). Filter create requests are allow-listed to label actions; forwarding is not supported. Not requested unless the user enables filters.

## Why not a narrower approach overall
The user picks Read / Draft / Send per account; the app requests only that level's scopes and asks again (incremental) when the user raises it. Every write is confirmed in the UI.

## Data handling summary (for the "data use" field)
Tokens and data remain on the user's self-hosted dashboard; content is sent only to the user's configured AI model provider to fulfil the user's request; the developer receives nothing; no ads, sale or generalized model training. See https://pi-dashboard.dev/privacy.html.

## `https://www.googleapis.com/auth/drive.readonly` (mail project)
Drive level "Read": the user asks the agent to find and use their existing files ("find last quarter's budget sheet and summarize it", "export the contract as PDF into my project"). `drive.file` cannot see files the user did not create with or open in the app, and a file picker is not available in a self-hosted dashboard whose web origin is unknown to us. Requested only when the user picks this level.

## `https://www.googleapis.com/auth/drive` (mail project)
Drive level "Write": user-confirmed uploads from the workspace, folder creation, moving and trashing files. No permanent deletion and no sharing changes are offered. Requested only when the user picks this level.

# A. Project `pi-dashboard-workspace` (non-sensitive / sensitive)

Every product is off until the user turns it on per account; read and write are separate levels; every write is confirmed in a dialog that previews the change.

## `calendar.readonly` / `calendar.events`
Read: "what's on my calendar tomorrow", free/busy before proposing meeting times. Write: create/update/delete events and RSVP after confirmation; guests are not emailed unless the user asks. `calendar.events` is narrower than `calendar` (no calendar/ACL management).

## `drive.file`
Drive level "App files": the agent can read and update only files it created or uploaded for the user. Non-sensitive; offered as the least-privilege Drive option.

## `documents.readonly` / `documents`
Read a Google Doc the user references by link; create documents and append/replace text after confirmation, guarded against overwriting concurrent edits.

## `spreadsheets.readonly` / `spreadsheets`
Read ranges the user points to; write/append rows after confirmation. Values are written literally (no formula evaluation) unless the user requests it.

## `presentations.readonly` / `presentations`
Read slide text and speaker notes; create decks, add slides and replace text after confirmation.

## `tasks.readonly` / `tasks`
List tasks; create, update, complete and delete tasks after confirmation.

## `contacts.readonly` / `contacts`
Look up a contact's email/phone when the user asks to write or schedule with them; create/update contacts after confirmation. No deletion.
