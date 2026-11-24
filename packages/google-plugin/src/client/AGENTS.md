# DOX — packages/google-plugin/src/client

Settings → Google accounts. See change: add-google-connect.

| File | Purpose |
|------|---------|
| `__tests__/accounts-page.test.tsx` | Accounts page L1: summary + 8-product table, the one primary Connect button, status pill (text + `data-status`), account-email accessible names (unique), disabled controls with `aria-describedby` reasons, access-model statement, Drive levels (built-in vs own client), `scope_missing` retry, disconnect dialog (cancel / revoke option), theme-token guard scan of the client tree. |
| `__tests__/auto-setup.test.tsx` | Automatic setup (ported from gmail), rendered inside Advanced → Add organisation sign-in → guided setup: entry matrix (service × plugin × profile × local/remote), 1 s polling, takeover, hand-off into the manual wizard, unverified-app hint in the connect dialog, i18n parity. `vi.useFakeTimers` fakes only `setInterval`. |
| `__tests__/client-entry.test.tsx` | Barrel: eager catalog (zh-CN / hu parity, every literal `t()` key present), lazy `GoogleSettings`, ported consent / publishing English copy. |
| `__tests__/connect-dialog.test.tsx` | Connect dialog L1 over the real host `ui:dialog`: products, "Sign in with" only for organisations, disclosure + return-path wording, waiting + paste fallback, results / errors, product change / Sign in again reuse, Workspace blocks, dialog a11y. |
| `__tests__/harness.tsx` | Shared test harness: `acct`/`client`/`state` builders, scriptable `mockApi`, `flowRoutes`, `renderSettings` (real `ui:dialog`, fake `ui:oauth-flow` paste input, fake confirm dialog). |
| `__tests__/return-messages.test.tsx` | #B33 / task 11.32: `message` events with origin `https://pi-dashboard.dev` / `null` / `""` / `:444` change nothing and fetch nothing (no return-message channel exists, D12b). |
| `__tests__/wizard.test.tsx` | Client-JSON decision table, Add organisation sign-in form (PUT body, Web client accepted, errors), Web redirect URI display, guided wizard (enable command for every product API, inputs, links, step chips), error tables, console links, gcloud commands + shell quoting. |
| `AccountCard.tsx` | One account: collapsed summary + status pill; expanded product × access table (levels, `scope_missing` retry, Gmail filters), access-model statement, alias, Sign in again, Disconnect dialog (opt-in "Also remove access at Google"); `RevokeFailedNotice`. |
| `AutoSetup.tsx` | "Set up automatically" UI (ported from gmail; REST `/api/plugins/google/setup/run`), all secondary buttons. `AutoSetupSection` entry + start form + run panel + hand-off. |
| `ConnectDialog.tsx` | The one connect dialog: choose (products, Sign in with, disclosure) → waiting (fold-out paste fallback, report-an-error codes, path switch) → result / error / Workspace block / local-browser-required. Handles new connect, product change that needs consent and Sign in again. |
| `Disclosure.tsx` | Accessible fold-out (`aria-expanded` button, body absent while collapsed). |
| `GoogleSettings.tsx` | Settings section: state loading, accounts list, the one primary Connect button, Advanced section, dialog orchestration (`/products`, `/reauth`, disclosure / local-browser refusals). |
| `OrgSignIn.tsx` | "Advanced: organisation sign-in" (collapsed): built-in row, own-client rows (domains, accounts, Web redirect URI, Remove with reason), Add organisation sign-in form (name, domain, client file, guided setup folded in). |
| `SetupWizard.tsx` | Manual guided Google Cloud setup, steps 1–4 (project + product APIs, branding, audience, OAuth client): console links, copyable gcloud commands. |
| `auto-setup.ts` | Pure data for automatic setup: hand-off / checkpoint / link-error key maps, `showUnverifiedNotice`, `validateLinks` (ported from gmail). |
| `connect-errors.ts` | Request-level refusal codes → plain-language text (`errorText` falls back to the sign-in error table). |
| `index.tsx` | Client barrel: lazy `GoogleSettings` inside its own `Suspense`; eager `catalog`. |
| `products.ts` | Product display names, level labels (`levelChoices`, `lowestLevel`), `productNames`, `emailDomain` over the shared catalogue. |
| `types.ts` | Wire types of `GET /state` and the account / client routes. |
| `ui.ts` | `api<T>()` over `/api/plugins/google` (throws `{code, status, detail, body}`) and class recipes (`btn`, `primaryBtn`, `selectCls`, `chip`, `muted`, `errorText`). |
| `wizard.ts` | Console deep links (`consoleLinks`, `enableApis` one-click link), `gcloudCommands` (enable every product API), `errorStep`, `errorKey` + `ERROR_EN` for every sign-in code. |
| `picker.ts` | UI side of `gdrive_pick`: `answerPickerPrompt(meta, host, tokenApi)` — `POST /picker-token` → `host.show(token)` (the mounting component loads Google's picker) → one JSON answer for the session prompt; never throws (token failure → `picker_unavailable`). |
| `__tests__/picker.test.ts` | L1 picker hook (#C44–#C47 UI half) + `parsePickerAnswer` bounds. |
