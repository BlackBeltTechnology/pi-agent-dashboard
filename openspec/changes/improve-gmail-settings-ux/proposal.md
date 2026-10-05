## Why

Adding a second Google account from a different Workspace org (`robert.csakany@blackbelt.hu` next to `robson@semmi.se`) fails with Google's own `Error 403: org_internal` page. The OAuth client's Audience is **Internal**, which the setup wizard explicitly recommends ("Workspace org: choose Internal"). Google never redirects back on that error, so the dashboard waits silently until the 5-minute loopback timeout, the server logs nothing, and the existing error → wizard-step mapping never fires. On top of that the Gmail settings section renders with undefined theme tokens (black borders, colourless status badges, non-red errors) and a cramped, unguarded account row.

## What Changes

- **Audience guidance (wizard step 3):** recommend Internal only when every account to connect belongs to the project's Workspace org; otherwise External (+ test users). Explain `org_internal`, `access_denied`, `admin_policy_enforced` and what fixes each.
- **Google-page errors are recoverable from the dashboard:** while a sign-in is waiting, show a "Google showed an error?" troubleshooting disclosure. The user picks the code Google displayed; the flow is cancelled and the plain-language fix is shown (wizard step opened when the fix is there; `admin_policy_enforced` names the client id an admin must trust). Every sign-in error code gets a human sentence.
- **Consent-screen hint:** while a sign-in is waiting, the Gmail panel says to tick every permission on Google's consent screen (Google may show the Gmail box unticked); `scope_missing` is explained as "Gmail permission not granted — add the account again with every permission ticked". Hit twice while connecting the blackbelt.hu and gmail.com accounts.
- **API-disabled message:** a Gmail 403 is classified from Google's machine-readable reason only: `SERVICE_DISABLED` → `api_disabled` (names the project number + the enable command), `ACCESS_TOKEN_SCOPE_INSUFFICIENT` → `scope_insufficient` (re-authenticate). Google's free text is never echoed. Observed: the Gmail API was never enabled on `pidashboard-510015`, and every tool call failed with a bare `gmail_error: Gmail returned HTTP 403` while the panel showed `ok`.
- **Cross-org hint at Add account:** the add-account area states that accounts outside the project's Workspace org need an External audience.
- **Failed sign-ins are logged** server-side as one warning with a fixed, input-free code (`[gmail] sign-in failed: <code>`), never tokens, codes, URLs or email.
- **Theme tokens:** replace undefined CSS variables (`--border`, `--bg-subtle`, `--success-bg`, `--warning-bg`, `--warning`, `--error`) with declared host tokens, and add the plugin's client dir to the existing `scripts/theme-token-guard.mjs` scan so it cannot regress. Correct in all 9 named themes, light and dark.
- **Account row UX:** status badge readable at a glance; visible focus rings; Revoke requires confirmation via the host `ui:confirm-dialog`; alias save shows saved/failed feedback; level options carry their own short description (scope-limit and cross-session statements kept); Add-account level picker gets a visible label and a cross-org hint.
- **Collapsed wizard summary:** shows the configured project (or client id when the JSON had no project id) so the user knows where to change the audience.
- Non-goal: multiple OAuth clients per dashboard (one client per Workspace org). Tracked separately if wanted.

## Discipline Skills

- `security-hardening` — new failure log line and user-selected error code must stay input-free (fixed-code allow-list, no URL/code echo).
- `observability-instrumentation` — adds the sign-in failure log line.
- `security-hardening` also covers the 403 body parse: Google's response is untrusted input; only an allow-listed `reason` and a digits-only project number may reach the tool message.
- `review-code` — before commit.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `gmail-plugin`: "Guided OAuth client setup" gains audience guidance and Google-page error recovery; "Secrets never logged" gains the sign-in failure log contract; "Revoke account" gains an explicit confirm step; ADDED "Settings section is readable and guarded"; ADDED "Actionable Gmail API errors".

## Impact

- `packages/gmail-plugin/src/client/GmailSettings.tsx`, `wizard.ts`, `src/i18n.ts` (en call-site fallback + `zh-CN` + `hu` catalogs, key parity enforced by `scripts/i18n-parity`).
- `scripts/theme-token-guard.mjs` (`SCAN_ROOTS` += `packages/gmail-plugin/src/client`).
- `packages/gmail-plugin/src/server/routes.ts` (wrap login flow / persist to log failure codes).
- `packages/gmail-plugin/src/bridge/gmail-api.ts` (403 classification); tool error codes gain `api_disabled`, `scope_insufficient` (additive; existing codes unchanged).
- Tests: `src/client/__tests__/panel.test.tsx`, `wizard.test.tsx`, `src/server/__tests__/routes.test.ts`, `src/bridge/__tests__/tools.test.ts`.
- No API, storage or protocol change. No migration. Rollback = revert the commit.
- Docs: `packages/gmail-plugin/README.md` audience section + error table; `docs/gmail-plugin.md` (via DocScribe); DOX rows in `packages/gmail-plugin/src/client/AGENTS.md`, `src/server/AGENTS.md`, and `scripts/theme-token-guard.mjs.AGENTS.md`.
