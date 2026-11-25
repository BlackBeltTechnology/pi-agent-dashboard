# Limited Use statement

## Homepage block (site/index.html, near footer, visible without scrolling interactions)

> **Google account connection.** pi-dashboard can connect to your Google account so your AI agent can work with the Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks and Contacts data you ask it to. Sign-in happens between your browser, Google and the pi-dashboard you run — pi-dashboard.dev never receives your tokens or data. pi-dashboard's use and transfer of information received from Google APIs to any other app will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. [Privacy policy](/privacy.html)

## Verification form — "How will the app use the data?"

pi-dashboard is self-hosted software. A user connects a Google account from the dashboard's Google settings and turns on individual products (Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks, Contacts) at a chosen permission level; OAuth runs as an installed (Desktop) client with a loopback redirect and PKCE, so authorization codes, tokens and Gmail data are only on the user's own dashboard instance. When the user asks their AI agent to work with one of these products (e.g. search mail, check the calendar, read a spreadsheet, draft a document), the dashboard calls the corresponding Google API on the user's behalf and passes the relevant content to the AI model provider the user configured, solely to produce the response the user requested. Write actions require explicit user confirmation in the UI. Data is not sold, not used for advertising, and not used to train generalized AI models. The developer operates no server that receives Google user data.

## Disclosure placement

1. Homepage (above) and privacy policy §3–4.
2. In-app, before first sign-in: `in-app-disclosure.md` (required — Google: "Cannot be placed only in a privacy policy or terms of service").
