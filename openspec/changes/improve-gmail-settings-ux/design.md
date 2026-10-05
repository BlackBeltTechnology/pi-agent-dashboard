## Context

See proposal.md — Why. Observed failure: OAuth client in project `pidashboard-510015` has Audience = Internal (semmi.se org); a `blackbelt.hu` account gets Google's `Error 403: org_internal` page. Google does not redirect on this class of error (observed by the user; not verifiable from the repo), so the loopback callback (`packages/dashboard-plugin-runtime/src/server/loopback-callback.ts`, 300 s timeout → code `timeout`) never fires and `errorStep()` (`packages/gmail-plugin/src/client/wizard.ts:41-43`, already maps `org_internal` → 3) is never reached.

Flow status plumbing: the client polls `oauthFlowClient.status` every 500 ms (`GmailSettings.tsx:41-65`); on a terminal state `onDone` does `setFlow(null); setFlowError(err)` (`GmailSettings.tsx:361-368`). A host cancel settles the flow as `error` with message `"Cancelled"` (capital C; `packages/server/src/auth/provider-auth-adapter.ts:522,537`). Any other terminal error is the thrown error's `message` — for `GmailFlowError` that is the fixed code (`google-oauth.ts:28-33`).

Plugin CSS uses variables the host theme does not define (`--border`, `--bg-subtle`, `--success-bg`, `--warning-bg`, `--warning`, `--error`; e.g. `GmailSettings.tsx:38,73,125,147`). The host declares tokens in `packages/client/src/index.css`, including `--border-primary`, `--bg-tertiary`, `--severity-{success,warning,error}-{bg,fg,border}`. `scripts/theme-token-guard.mjs` (run by `scripts/__tests__/theme-token-guard.test.mjs`) already fails on undeclared tokens, but its `SCAN_ROOTS` (`theme-token-guard.mjs:49-53`) omit `packages/gmail-plugin/src/client` — which is how these shipped. Themes: 9 named × light/dark (`packages/client/src/lib/theme/themes.ts:760-769`).

`client.projectId` is optional (`shared/client-json.ts`, `server/accounts.ts:22`).

## Goals / Non-Goals

**Goals:** recover from a Google-page sign-in error without waiting for the timeout; make the audience trade-off explicit; log failures; fix theme rendering via the existing guard; tighten the account row.

**Non-Goals:** multiple OAuth clients; detecting the audience via Google APIs; changing the host `ui:oauth-flow` primitive or the cancel message; moving the section to the General tab (`settings-section` `tab` is inert by design).

## Decisions

### D1 — User-reported Google error with a latched code
While `flow.phase === "waiting"`, render a `<details>` "Google showed an error instead of returning here?" with one button per code in a closed list: `org_internal`, `access_denied`, `admin_policy_enforced`, `other`.

Click handler order (load-bearing):
1. `reportedRef.current = code` (a `useRef`).
2. `setFlow(null)`; `setFlowError(code)`.
3. `void oauthFlowClient.cancel(flowId)`.

BOTH poll callbacks are latched: `onDone` AND the pending arm (`GmailSettings.tsx:363`, `setFlow({phase:"waiting"})`) return early when `reportedRef.current` is set. Otherwise a pending poll resolving after the click re-mounts the widget and, with `onDone` suppressed, polls forever. So the host's terminal `"Cancelled"` never overwrites the reported code and the widget never reappears. `reportedRef` is cleared when a new flow starts (`addAccount`, `startFlow`). `setFlow(null)` alone is insufficient: the interval cleanup is not synchronous with the click.
- Alternative: shorter loopback timeout. Rejected: no reason shown, and slow genuine consent would fail.
- Alternative: detect via Google. Impossible: nothing is returned.
Codes come from the closed list, never free text.

### D2 — Error table in `wizard.ts`
- `errorStep(code)`: unchanged mappings plus `access_denied` → 3 (already), `org_internal` → 3 (already). `admin_policy_enforced` → `null` (the fix is in the account's Workspace Admin console, not in a wizard step).
- `errorKey(code): string` returns an i18n message key for EVERY code a flow can terminate with: `org_internal`, `access_denied`, `admin_policy_enforced`, `redirect_uri_mismatch`, `invalid_client`, `scope_missing`, `account_mismatch`, `missing_refresh`, `email_unverified`, `invalid_redirect`, `state_mismatch`, `callback_failed`, `token_exchange_failed`, `id_token_invalid`, `authorization_failed`, `timeout`, `start_timeout`, `login_failed`, `Cancelled` (normalised case-insensitively to `cancelled`), `aborted`; anything else → `errGeneric`. Pure, unit-tested; a test asserts `ERROR_EN[errorKey(c)]` is a non-empty string for every listed code and that the `zh-CN`/`hu` catalogs contain every key `errorKey` can return.
- `ERROR_EN: Record<string,string>` in `wizard.ts` holds the English sentence per key (the catalogs carry only `zh-CN`/`hu`; `t(key, vars, fallback)` resolves `dict[lang][key] ?? fallback ?? key`, `plugin-context.tsx:195-212`, so a dynamic key MUST pass its English fallback or EN shows the key). The component renders `t(errorKey(code), { clientId }, ERROR_EN[errorKey(code)])` and the raw code separately in a muted `<span>` (support aid). `admin_policy_enforced`'s sentence interpolates `state.client.clientId`.
- The host passes the terminal message through `withholdEchoedInput` (`provider-auth-adapter.ts:489`); a withheld message is not a known code and falls to `errGeneric` (accepted).

### D3 — Failure logging at the route
In `startSignIn` (`routes.ts:59-101`):
- wrap `loginFlow.login` and `persist` (spread a new `PluginOAuthLoginFlow` object; host seam untouched) and the `deps.oauth.startFlow` `catch` (`routes.ts:98-99`);
- each logs exactly `[gmail] sign-in failed: <code>` via `logger.warn`, where `code` is `err.code` only when it is a string in the closed set `KNOWN_FLOW_CODES` (the D2 code list plus `start_timeout`/`login_failed`), else `sign_in_failed`;
- no email, no message text; rethrow the original error unchanged.
- **Exactly once:** a login that throws BEFORE its first event makes `beginFlow` return `login_failed` (`packages/server/src/auth/begin-flow.ts:152,159-162`) and the seam rejects `PluginFlowStartError` (`packages/dashboard-plugin-runtime/src/server/server-context.ts:1142-1148`), so the same failure reaches both sites. A per-call `let logged = false` closure flag, set by whichever site logs first, suppresses the second.

### D4 — Tokens via the existing guard
Add `packages/gmail-plugin/src/client` to `SCAN_ROOTS` in `scripts/theme-token-guard.mjs`; it must pass with no new baseline entries. Mapping:
| Plugin (undefined) | Host token |
|---|---|
| `--border` | `--border-primary` |
| `--bg-subtle` | `--bg-tertiary` |
| `--success-bg` (+ text) | `--severity-success-bg` / `-fg` / `-border` |
| `--warning-bg` (+ text) | `--severity-warning-bg` / `-fg` / `-border` |
| `--warning` (step highlight) | `--accent` (non-text border/ring token, `index.css:150`) |
| `--error` | `--severity-error-fg` |

Also fix `StepLink` (`GmailSettings.tsx:83`): link text `--accent` → `--accent-text` (`--accent` is 3:1 non-text only; the guard's accent-as-text arm does not catch bare `--accent`).

The status badge stays on `--severity-*`: it is an account-health notice (re-auth needed = action required), the same use the grammar plugin makes of `--severity-warning-fg`, not a session status. The capsule's `--status-*` rule (`folder-status-capsule` spec) is scoped to session status.

The existing canonical `.focus-ring` utility (`packages/client/src/index.css:337-341`; already used by plugin clients, e.g. `goal-plugin/src/client/GoalDetailClaim.tsx`) goes on every interactive element: buttons, `<select>`s, `<input>`s (alias, project id, file), `<summary>`, `StepLink` anchors, disclosure code buttons, revoke Confirm/Cancel.

### D5 — Account row
- Two lines: identity (email, alias, status badge, testing badge) / controls (level, Re-authenticate, Revoke).
- Revoke → host `ui:confirm-dialog` primitive (`useUiPrimitive`, `packages/shared/src/dashboard-plugin/ui-primitives.ts:32`; same convention as `blackhole-plugin/src/client/BlackholeSettings.tsx:167`) with its existing contract `{message, confirmLabel, onConfirm, onCancel}` (`ui-primitives.ts:105-110`): message names the email, `confirmLabel` "Revoke". No request is sent unless confirmed.
- Alias blur → save → transient `role="status"` "Saved" or the mapped error.
- Level `<option>` labels carry a short description; the help paragraph is shortened but MUST keep both statements: levels are enforced by the plugin not by Google, and any dashboard session can use every account within its level (existing test pins `/not by Google/`, `panel.test.tsx:47`).
- Add-account: visible `<label>` + one-line cross-org hint.

### D6 — Collapsed wizard summary
`<summary>` = `t("setup")` + `configured ? (projectId ? t("summaryProject",{projectId}) : t("summaryClient",{clientId})) : t("summaryNotConfigured")` (EN fallbacks `✓ project {projectId}` / `✓ {clientId}` / `not configured`).

### D7 — i18n
English stays the call-site fallback; every new/changed key is added to the `zh-CN` and `hu` catalogs (`src/i18n.ts`), parity enforced by `scripts/i18n-parity`.

## Risks / Trade-offs

- [User picks the wrong code] → cancel is harmless; message routes to a fix; retry is one click.
- [Google adds page-only codes] → `other` shows generic guidance + README error table.
- [Host changes the cancel message] → the latch (D1) does not depend on it; only the message mapping does, which falls back to `errGeneric`.
- [Non-Gmail error messages arrive as `flowError` (e.g. `fetch failed`)] → `errGeneric` sentence; raw text shown only in the muted support span, same as today.
- [`--severity-*` on the account status badge, a non-message surface] → trade-off accepted: it is an action-required notice, not a session status; revisit if a shared account-status token family appears.

## Migration Plan

Client + plugin server + one guard script root. No stored data change. Deploy: `npm run build` + `/api/restart`. Rollback: revert commit.
