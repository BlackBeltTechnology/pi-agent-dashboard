# Privacy Policy — pi-dashboard

> DRAFT — requires legal review before publishing. Replace every `[[…]]` placeholder.

Effective date: [[YYYY-MM-DD]]
Operator: [[legal entity name, address, country]] ("we", "us").
Contact: privacy@pi-dashboard.dev

## 1. What pi-dashboard is

pi-dashboard is open-source software that you install and run yourself (desktop app, npm package or Docker image). It lets you monitor and control AI coding-agent sessions and, if you choose, connect your Google account so the agent can work with the Google products you turn on (Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks, Contacts).

**We do not operate a server that receives your Google data.** When your dashboard runs on another computer, Google returns your browser once to a static page on pi-dashboard.dev (`https://pi-dashboard.dev/oauth/return.html`) that only hands a one-time sign-in code back to your dashboard in the same window, after you confirm the dashboard address; that code cannot be used without a secret held by your dashboard, and the page stores nothing. The static host may log the address of that page, including the one-time code in it. When you connect a Google account, the sign-in happens between your browser, Google and the pi-dashboard instance you run. Tokens and data stay on the machine(s) you control.

## 2. Google user data we access

Only when you connect a Google account, and only the permissions you grant:

| Permission (scope) | What it allows | Used for |
|---|---|---|
| `openid`, `email` | Your Google account id and verified email | Identifying which account is connected |
| `gmail.readonly` | Read messages, threads, labels, attachments | Agent search/read tools you invoke |
| `gmail.compose` | Create and send drafts | Drafts and sending you confirm |
| `gmail.modify` | Change labels, archive, trash | Organizing mail you confirm |
| `gmail.settings.basic` | Read and manage filters (opt-in) | Filter tools, only if you enable filters |
| `calendar.readonly` / `calendar.events` | Read / change events | Calendar questions; events you confirm |
| `drive.file` / `drive.readonly` / `drive` | App-created files / read all / change all | Finding, exporting and uploading files you ask for |
| `documents`, `spreadsheets`, `presentations` (and `.readonly`) | Read / edit Docs, Sheets, Slides | Reading and editing documents you point to |
| `tasks` (and `.readonly`) | Read / change tasks | Task tools |
| `contacts` (and `.readonly`) | Read / change contacts | Looking up and saving contacts |

Each product is off until you turn it on for an account, at a permission level you choose. Write actions require your confirmation in the dashboard.

## 3. How the data is used, stored and shared

- **Stored**: OAuth refresh/access tokens in the pi-dashboard credential store on your machine. Content the agent reads may appear in your local session history files on that machine.
- **Shared with your AI model provider**: when you ask the agent to work with a Google product, the content it reads is sent to the AI model provider *you configured* (for example [[Anthropic, OpenAI, Google, a local model]]) to produce the answer. This happens only as part of the feature you invoked. That provider's own terms and privacy policy apply.
- **Not shared with us**: pi-dashboard.dev and its operators never receive your tokens, messages, files or account data.
- **Never**: sold; used for advertising; used to train or improve generalized AI/ML models; transferred to data brokers.

## 4. Limited Use

The use of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## 5. Retention and deletion

- Disconnect an account in Settings → Google → Revoke: the token is revoked at Google and deleted locally.
- You can also revoke access at https://myaccount.google.com/permissions.
- Local session history is kept until you delete it; deleting the session files removes any message content stored in them.

## 6. Security

Tokens are held server-side in your dashboard and never sent to the browser UI or logged. Sign-in uses OAuth 2.0 with PKCE. The software undergoes an independent security assessment as required by Google for restricted scopes.

## 7. Website

pi-dashboard.dev is a static website. [[State whether any analytics/cookies are used; if none: "It sets no cookies and uses no analytics."]] Hosting provider: [[GitHub Pages]].

## 8. Children

Not directed to children under 13 [[or 16 in the EEA]].

## 9. Your rights

[[GDPR/CCPA section as applicable: access, deletion, objection; note that we hold no Google user data, so requests concerning it are fulfilled by revoking access and deleting local files.]]

## 10. Changes

We will post changes here and update the effective date. If changes affect how Google user data is used, the dashboard will ask you to accept the updated disclosure before connecting again.
