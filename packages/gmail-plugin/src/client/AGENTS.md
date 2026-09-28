# DOX — packages/gmail-plugin/src/client

Settings-section client. See change: add-gmail-plugin.

| File | Purpose |
|------|---------|
| `__tests__/client-entry.test.tsx` | Barrel: catalog parity + lazy `GmailSettings` renders `gmail-settings`. |
| `__tests__/panel.test.tsx` | Accounts panel: rows + status/testing badges + honest level help, lower-level POST, revoke-offline message, start error → step 5. |
| `__tests__/wizard.test.tsx` | E1 client-JSON decision table + upload component (valid PUT; web rejected locally, step 4), E2 error→step, E3 deep links + gcloud commands (invalid id never interpolated). |
| `GmailSettings.tsx` | `GmailSettings` (settings-section claim): wizard in `<details>` (open until configured+account or on a mapped error) + accounts panel (level select, alias on blur, re-auth, revoke → `gmail-revoke-result`, add with level). Flows via `ui:oauth-flow` + `oauthFlowClient` 500 ms poll. `SetupWizard` exported (steps 1–6, project id, links, Copyable gcloud, upload with local `validateClientJson`). `useT` everywhere. |
| `index.tsx` | Client barrel: eager `catalog`; `GmailSettings` = wrapper owning `Suspense` around `lazy(import("./GmailSettings.js"))` — settings UI off the cold entry chunk (mdi-chunk-size cap). |
| `wizard.ts` | `consoleLinks(projectId)` (`?project=` encoded), `gcloudCommands` (only a valid id, else `<project-id>`), `errorStep(code)` access_denied/org_internal→3, redirect_uri_mismatch/web/bad id→4, invalid_client/secret/json/no_client/client_in_use→5. |
