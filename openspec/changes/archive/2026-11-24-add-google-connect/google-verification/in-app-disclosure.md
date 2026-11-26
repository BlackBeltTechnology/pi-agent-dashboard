# In-app disclosure — Settings → Google (DISCLOSURE_VERSION = 1)

Shown in Settings → Google before the first built-in-client sign-in or consent. Bump `DISCLOSURE_VERSION` in `packages/google-plugin/src/shared/default-clients.ts` whenever this text changes meaning.

---

**Before you connect Google**

When you connect a Google account, pi-dashboard will:

- **Access** only the products you turn on, at the level you choose per account: {productList}
  (e.g. Gmail messages and drafts · Calendar events · Drive files · Docs, Sheets and Slides · Tasks · Contacts).
- **Store** the sign-in token only on this dashboard (`<host>`). Messages the agent reads may be saved in this dashboard's session history.
- **Send** the content the agent reads to your configured AI model provider (**{providerName}**) when you ask the agent to work with these products — only to answer that request.
- **Never send** your tokens or data to pi-dashboard.dev, sell them, use them for ads, or use them to train AI models.

Every change (sending mail, editing documents, creating events, uploading or trashing files) asks for your confirmation. You can disconnect at any time here or at myaccount.google.com/permissions.

[Privacy policy](https://pi-dashboard.dev/privacy.html)

[ I agree and connect ]   [ Use my own OAuth client instead ]

---

Implementation notes:
- `{providerName}`: the session's/default model provider name if known; else "the AI model provider you configured".
- The accept button records `{version, acceptedAt}` via `PUT /api/plugins/google/disclosure`, then starts sign-in.
- Must be readable without scrolling inside a collapsed section; accept button keyboard-reachable; no pre-ticked checkbox.
