# DOX — packages/gmail-plugin/src/client

Settings-section client: a pointer notice to Settings → Google accounts. See change: add-gmail-plugin, add-google-connect.

| File | Purpose |
|------|---------|
| `__tests__/client-entry.test.tsx` | Barrel: catalog parity + pointer-notice keys; lazy `GmailSettings` renders `gmail-settings`. |
| `__tests__/panel.test.tsx` | Pointer notice driven by `GET /api/plugins/gmail/state` (`{moved:true}` → link to Settings → Google accounts; `{moved:false, googleConnect:"unavailable"}` → "Turn on Google accounts to manage Gmail accounts"); no forms, no Connect button, none of the old wizard / account UI. |
| `GmailSettings.tsx` | `GmailSettings` (settings-section claim): info notice + SPA link to `/settings/plugins/google`, or the turn-on text; load error notice. Account / client / setup management moved to the google plugin. |
| `index.tsx` | Client barrel: eager `catalog`; `GmailSettings` = wrapper owning `Suspense` around `lazy(import("./GmailSettings.js"))`. |
