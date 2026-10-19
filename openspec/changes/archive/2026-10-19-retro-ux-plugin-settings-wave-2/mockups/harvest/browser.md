# Harvest — browser (`BrowserSettings.tsx` 360 + `AuditList.tsx` 104 + `ThisComputerBlock.tsx` 180)

## Purpose
Browser relay (logged-in Chrome → pi session via Playwright extension): global kill switch, per-Chrome-profile pairing token / zero-dialog / allowed domains / connect-disconnect / audit; Electron-only "This computer" local tokens + consents.

## Structure
Claim `settings-section` (no tab). Root `<div className="space-y-3">` `BrowserSettings.tsx:97`. No self-header — OK.
1. Intro `:98-100` "Relay your logged-in Chrome to a pi session through the Playwright extension."
2. Enabled checkbox `:102-119` "Enabled" (duplicates concept of host enable toggle — distinct: relay kill switch, but same word).
3. Cannot-open-Chrome note (if `!canOpenChrome`) `:121-125`.
4. Profiles warning (if `profiles.warning`) `:127-131` "Could not read Chrome profiles ({path}); showing a default profile."
5. Empty "No Chrome profiles found." `:133-136` OR one `ProfileRow` per profile `:138-140`:
   - bordered card `:199-202`; header: `<h4>` label 13px + email 11px; right column 3 status lines 10px `:214-226`.
   - token password input + [Save token] `:229-254`.
   - Zero-dialog checkbox + help `:256-274`.
   - Allowed domains input + help `:276-294`.
   - action row: store link / [Connect] / "Browser relay disabled" `:296-329`.
   - per-instance rows "N tabs" + [Disconnect] `:331-355`.
   - `AuditList` `:357` → "AUDIT" 10px uppercase caption `AuditList.tsx:80-82`, empty "No audit entries." or `<ul>` rows `time kind detail` `:88-100`.
6. `ThisComputerBlock` (Electron only, `getBrowserHost()`) `:143` → card `<section>` `ThisComputerBlock.tsx:67-71`: `<h4>` "This computer", help, host profile rows (label+email, installed 10px, token input + Save token, error), `<h5>` "Allowed connections", consents list w/ [Revoke] or "No stored “Always allow”."

## Fields
| label | control | key | hint | unit | validation |
|---|---|---|---|---|---|
| Enabled | native checkbox `:103` | server `PUT /api/browser/enabled` (`status.enabled`) | none | — | failure → whole page flips to error state `:113` |
| (none — placeholder "Paste pairing token") | native `<input type=password>` `:230` | `browsers[dir].token` via `PUT /api/browser/profile` | none | — | Save disabled when empty; write rejection unhandled (withBusy has no catch `:184-194`) |
| Zero-dialog (skip Chrome's Allow prompt) | native checkbox `:257` disabled `!hasToken \|\| busy` | `browsers[dir].zeroDialog` | "Requires a valid token. A mismatched token, Reject, or no answer all appear as a 60 s timeout." (nested span, not describedby) `:270-272` | — | none; no reason shown why disabled |
| Allowed domains | native text `<input>` `:278` (comma list) | `browsers[dir].allowedDomains` | "Guards Page.navigate and Target.createTarget only — not other network traffic." `:291-293` | — | split/trim on blur; no validation |
| host token (aria-label "Paste pairing token") | native password `ThisComputerBlock.tsx:159` | Electron main `bridge.setToken` | none | — | failure → "Could not save the token." `role=alert` `:173-177` |

## Status & read-only displays
- Profile status column `:214-226` all `text-[10px] text-[var(--text-tertiary)]`, plain words, no pills/colour: "Extension installed"/"Extension not installed", "Token set"/"No token", "Not connected"/"Connected · {n} tabs".
- Instance rows "{n} tabs" `:338` text-secondary.
- "Browser relay disabled" `:325-327` text-tertiary.
- Audit rows `AuditList.tsx:95-97` 11px: time tertiary, `entry.kind` raw token medium, `detail`.
- Host "Extension installed" 10px tertiary `ThisComputerBlock.tsx:154-156`.
- Consent row "{serverOrigin} · {profileDirectory}" `:105-107`.

## Actions
| label | kind | does | confirm |
|---|---|---|---|
| Save token | secondary (bordered) `:239-253` | write token, clear draft, refetch | no |
| Install the Playwright extension | link `underline text-[var(--accent-text)]` new tab `:298-306` | Chrome Web Store | — |
| Connect | secondary `:309-322`; disabled `!installed\|\|!enabled\|\|busy`; only if `canOpenChrome` | `connectBrowserProfile`, refetch | no |
| Disconnect | secondary `:340-353` | `disconnectBrowserInstance`, refetch | no (destructive-ish, no confirm) |
| Save token (host) | secondary `BTN` `ThisComputerBlock.tsx:169` | `bridge.setToken` | no |
| Revoke | secondary `BTN` `:108` (should be danger) | `bridge.revokeConsent`, reload list | no |

## Save model
Immediate per-control, plugin's own REST routes (not `plugin_config_write`, not `useSettingsDraftSource`): enabled on change `:107-116`; token on button `:243-249`; zeroDialog on change `:262-266`; allowedDomains on blur `:282-288`. No saved feedback anywhere.

## States
- loading: "Loading…" `:86-88` (`browser-settings-loading`); audit loading "Loading…" `AuditList.tsx:72`.
- load-error / any toggle failure: whole page replaced by "Browser relay settings are unavailable." `:78-80` (text-secondary, no retry).
- empty: "No Chrome profiles found."; audit empty "No audit entries."; host "No Chrome profiles found on this computer."; consents empty "No stored “Always allow”."
- warning: profiles warning text.
- relay disabled: Connect disabled + "Browser relay disabled".
- busy: per-row `busy` disables buttons/checkbox; no spinner.
- ThisComputerBlock unavailable → renders nothing `:55`.
- Profile write error (token/zeroDialog/domains/connect) → unhandled rejection, NO UI.

## Protected
data-testid (BrowserSettings): `browser-settings-error`, `browser-settings-loading`, `browser-settings`, `browser-enabled-toggle`, `browser-cannot-open-chrome`, `browser-profiles-warning`, `browser-profiles-empty`, `browser-profile-${dir}`, `browser-profile-label-${dir}`, `browser-profile-email-${dir}`, `browser-installed-${dir}`, `browser-has-token-${dir}`, `browser-connected-${dir}`, `browser-token-input-${dir}`, `browser-token-save-${dir}`, `browser-zero-dialog-${dir}`, `browser-allowed-domains-${dir}`, `browser-store-link-${dir}`, `browser-connect-${dir}`, `browser-disabled-reason-${dir}`, `browser-instance-${instanceId}`, `browser-disconnect-${instanceId}`.
AuditList: `browser-audit-loading-${dir}`, `browser-audit-${dir}`, `browser-audit-empty-${dir}`, `browser-audit-row-${dir}-${i}`.
ThisComputerBlock: `browser-this-computer`, `browser-host-profiles-empty`, `browser-host-consents-empty`, `browser-host-consent-${key}`, `browser-host-consent-revoke-${key}`, `browser-host-profile-${dir}`, `browser-host-installed-${dir}`, `browser-host-token-input-${dir}`, `browser-host-token-save-${dir}`, `browser-host-token-error-${dir}`.
aria: `aria-labelledby="browser-this-computer-title"`, host token `aria-label`, error `role="alert"`. Token inputs `type=password autoComplete=off` (TOKEN SAFETY — keep write-only, never render).
i18n `plugin.browser.*` (`src/i18n.ts`): settingsError, loading, settingsIntro, enabledLabel, cannotOpenChrome, profilesWarning, noProfiles, installed, notInstalled, tokenSet, tokenMissing, notConnected, connectedTabs, tokenPlaceholder, saveToken, zeroDialogLabel, zeroDialogHelp, allowedDomainsLabel, allowedDomainsHelp, installExtension, connect, relayDisabled, instanceTabs, disconnect, auditTitle, auditEmpty, thisComputerTitle, thisComputerHelp, thisComputerNoProfiles, consentsTitle, consentsEmpty, revoke, hostTokenError.

## Off-contract
- Font < 11px: status column `text-[10px]` `:214`; audit caption `text-[10px]` `AuditList.tsx:80`; host installed `text-[10px]` `ThisComputerBlock.tsx:154`.
- Native checkboxes not via kit: `:103`, `:257`. Native inputs not via kit: `:230`, `:278`, `ThisComputerBlock.tsx:159`.
- Dashboard token input has NO label, placeholder-only `:230-238` (host one has aria-label).
- Hints nested in label span, not `aria-describedby` `:270`, `:291`.
- `--text-tertiary` for readable status/hints/empties throughout (`:128,:134,:209,:214,:325`, Audit `:72,:84,:95`).
- Raw `entry.kind` token shown to users `AuditList.tsx:96`; raw `profiles.warning` path in message `:129`.
- Error state = page-wide `text-secondary` plain `<p>`, no severity tone, no retry `:78`; profile write errors swallowed entirely.
- Status words not pills/severity (installed/token/connected all same grey).
- "Enabled" checkbox label collides with host enable toggle wording `:118`.
- `<h4>`/`<h5>` heading levels w/o h3 parent; Revoke not danger-styled; Disconnect no confirm.
- Audit list unbounded (no cap/scroll) inside each profile card.

## Kit mapping
- Intro → `<p>` text-secondary.
- Enabled → `ToggleField` (label "Relay enabled", hint = kill-switch meaning).
- cannotOpenChrome → `SettingsNotice tone="info"`; profiles warning → `SettingsNotice tone="warning"`; load error → `SettingsNotice tone="error" role="alert"` + retry.
- ProfileRow → `SettingsGroup title={label} meta={status pills}` — status pills custom (needs recipe).
- Token input + Save token → custom (needs recipe): write-only secret field + inline button; `FieldShell` w/ custom control (`TextField type=password` lacks attached button/feedback).
- Zero-dialog → `ToggleField` + hint; disabled reason in hint.
- Allowed domains → `TextField mono` + hint (or chip list recipe).
- Connect/Disconnect/instances → custom (needs recipe): action row + instance list.
- AuditList → custom (needs recipe): compact log list w/ human kind labels.
- ThisComputerBlock → `SettingsGroup title="This computer"`; token rows same secret recipe; consents → custom list w/ danger Revoke.
