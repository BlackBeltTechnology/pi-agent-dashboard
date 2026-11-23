# UI plan — add-google-connect

Surface: plugin settings section **Settings → Google** (plugin `google`, slot `settings-section`, tab `general`) + the reduced **Settings → Gmail** section.
Composition: runtime kit only (`SettingsGroup`, `SettingsItem`, `SettingsTable`, `SettingsStatusPill`, `SettingsNotice`, `TextField`, `SelectField`) + host `ui:oauth-flow`. Tokens per `ui-contract.md`; no raw colours.

Mock: `mockups/2026-11-23-google-connect-settings/mock.tsx` (live). Current = real `GmailSettings` over `/api/plugins/gmail/state` fixture.

| Surface | Parts | Tokens | States |
|---|---|---|---|
| Advanced: organisation sign-in (collapsed, bottom) — was "OAuth clients group" | built-in row, own-client rows (label, project, client id, domain chips, account count), Add own client | `--bg-secondary`, `--border-secondary`, `--text-secondary`; pills `SettingsStatusPill` success/neutral | built-in available / not yet available / disabled by operator; own client in use (Remove disabled + reason) |
| Accounts | one `SettingsItem` per account: email, alias, "via <client>", status pill; body = product table (Product · Access select · Status) | severity pills; select `CONTROL_BASE` | ok · reauth (per grant) · consent pending · scope_missing |
| Access model | one sentence above accounts (kept from Gmail) | `--text-secondary` | static |
| Connect button | one primary "Connect Google account" under the accounts list | primary `--accent-solid` | — |
| Connect dialog | panel classes of client-utils `Dialog`; ONE screen: product checkboxes (read-only start), 3 data-use lines + privacy link, "Continue with Google"; then waiting (paste fallback folded) and result; "Sign in with" select only when an organisation client exists | `--bg-secondary`, `--border-secondary`, severity success/warning | built-in · organisation choice · waiting · scope_missing + Try again · company block |
| Disclosure | `SettingsNotice` info, bullet list, privacy link, "I agree and connect" + "Use my own OAuth client instead" | severity-info | shown until current version accepted |
| Consent waiting | consent hint + `ui:oauth-flow` (paste fallback) + "Google showed an error?" codes | as Gmail today | waiting · reported code |
| Workspace block | `SettingsNotice` error with client id copy + "Add own OAuth client for <domain>" | severity-error | `admin_policy_enforced`, `org_internal` |
| Gmail section | info notice + link to Settings → Google | severity-info | after migration |

Rules cited:
- Recognition over recall (Nielsen #6): product × access as a visible table, not hidden behind per-product pages.
- Visibility of system status (Nielsen #1): which client signed an account in ("via Semmi") and per-grant status.
- Error prevention (Nielsen #5): Remove disabled with reason while a client is in use; domain conflicts inline.
- Hick's law + progressive disclosure (NN/g): the casual path has no email/client choice; organisation clients sit under Advanced.
- Wizard pattern (NN/g "Wizards: definition and design recommendations"): a short, ordered, self-contained task in a modal with visible step progress.
- Consistency with external standards (Nielsen #4): same shape as other apps' "Connect Google Drive" flows — Google's own account chooser picks the account.
- Match to the real world (Nielsen #2): Google product names and Google's own permission words (Read/Write).

Presentation: `../mockup-screens/README.md` tells one story — A what most users see, B organisations only, C compared with today.
