# Test Plan — improve-gmail-settings-ux

Stage: design   Generated: 2026-10-01

L1 = vitest in `packages/gmail-plugin/src/{client,server}/__tests__/` (client suites jsdom) or `scripts/__tests__/`. L3 = `tests/e2e/gmail-plugin.spec.ts` (fake Google, paste-fallback consent).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Guided setup — error table | decision-table | L1 | automated | every code in design D2 list (`org_internal` … `aborted`, plus `Cancelled`, `CANCELLED`) | `errorKey(code)` + `ERROR_EN[key]` | each returns a non-generic key with a non-empty English sentence; `Cancelled`/`CANCELLED` → cancelled key |
| E2 | Guided setup — error table | EP | L1 | automated | `"fetch failed"`, `""`, `"Org_Internal "`, 65-char `a…a` | `errorKey(code)` | `errGeneric` for all four |
| E3 | Guided setup — step map | decision-table | L1 | automated | `admin_policy_enforced`; regression `org_internal`, `access_denied`, `state_mismatch` | `errorStep(code)` | `null`; regression `3`, `3`, `null` |
| E4 | i18n parity | completeness | L1 | automated | `catalog["zh-CN"]`, `catalog.hu`, every key `errorKey` can return + `summaryProject`/`summaryClient`/`summaryNotConfigured` | key lookup | every key present in both catalogs; `node scripts/i18n-parity.mjs` exits 0 |
| E5 | Guided setup — summary | decision-table | L1 | automated | state `{configured:true, projectId:"p-1", clientId:"c.apps…"}` / `{configured:true, clientId:"c.apps…"}` (no projectId) / `{configured:false}` | render `GmailSettings` | summary text contains `p-1` / contains `c.apps…` and not `undefined` / `not configured` |
| E6 | Guided setup — audience text | content | L1 | automated | rendered wizard | read `gmail-step-3` | text states Internal admits only the project's own Workspace organization and External + test users otherwise |
| E7 | Readable section — tokens | static scan | L1 | automated | `SCAN_ROOTS` incl. `packages/gmail-plugin/src/client` | `scripts/__tests__/theme-token-guard.test.mjs` | passes with no new baseline entry; injecting `var(--border)` into a fixture under that root fails the undeclared arm |
| E8 | Readable section — link text | static scan | L1 | automated | `GmailSettings.tsx` source | grep | no `text-[var(--accent)]`; `StepLink` uses `--accent-text` |
| E9 | Readable section — focus | DOM | L1 | automated | rendered section with one account + waiting flow | query all `button, select, input, summary, a` | every element has class `focus-ring` |
| E10 | Readable section — scope limit | content | L1 | automated | rendered accounts list | read `gmail-level-help` + level `<option>`s | help matches `/not by Google/` and states any dashboard session can use every account within its level; each option text has a description after the tier name |
| E12 | Consent hint | content | L1 | automated | add-account flow in `waiting` | render `GmailSettings` | text "tick every permission" (Select all) visible next to the `ui:oauth-flow` view; absent when no flow |
| E13 | Consent hint — scope_missing | content | L1 | automated | flow status `{status:"error", error:"scope_missing"}` | poll | `gmail-flow-error` says the Gmail permission was not granted and to add the account again with every permission ticked; `data-step=""` |
| E14 | API errors — disabled | decision-table | L1 | automated | 403 body `{error:{details:[{"@type":"type.googleapis.com/google.rpc.ErrorInfo",reason:"SERVICE_DISABLED",metadata:{service:"gmail.googleapis.com",consumer:"projects/603220229616"}}]}}`; legacy `{error:{errors:[{reason:"accessNotConfigured"}]}}` | `gmail_search` | code `api_disabled`; modern message contains `603220229616` and `gcloud services enable gmail.googleapis.com`; legacy message has no project number |
| E15 | API errors — scope | decision-table | L1 | automated | 403 reasons `ACCESS_TOKEN_SCOPE_INSUFFICIENT` (ErrorInfo) / `insufficientPermissions` (legacy) | `gmail_search` | code `scope_insufficient`; message says re-authenticate with every permission ticked |
| E16 | API errors — consumer validation | EP | L1 | automated | `SERVICE_DISABLED` with consumer `projects/abc`, `projects/1;rm -rf`, `12345` (number), missing | `gmail_search` | code `api_disabled`; message contains none of `abc`, `rm -rf`, `12345` |
| E17 | API errors — other service | decision-table | L1 | automated | `SERVICE_DISABLED` with `metadata.service:"drive.googleapis.com"` | `gmail_search` | code `gmail_error` |
| X8 | API errors — malformed | fault-injection | L1 | automated | 403 bodies: `not json`, `{}`, `{error:"x"}`, `{error:{details:"x"}}`, `{error:{details:[{"@type":5,reason:{}}]}}`, `{error:{message:"SECRET-TEXT",details:[]}}` | `gmail_search` | every call rejects a `GmailToolError` with code `gmail_error` (never a raw TypeError); no message contains `SECRET-TEXT` |
| E11 | Readable section — cross-org hint | content | L1 | automated | rendered add-account area | read text | label for the level select is visible; hint mentions External audience for other organizations |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Guided setup — report code | state-transition | L1 | automated | add-account flow in `waiting` (mocked `oauthFlowClient.status` → pending) | click disclosure, choose `org_internal` | `oauthFlowClient.cancel(flowId)` called once; `gmail-flow-error` shows the org_internal sentence; `data-step="3"`; wizard `<details>` open |
| F2 | Cancel settling keeps code | state-convergence | L1 | automated | F1 state; next status poll resolves `{status:"error", error:"Cancelled"}` | advance fake timers 1 s | `gmail-flow-error` still shows org_internal sentence, `data-step="3"`; no `Cancelled` text |
| F3 | Latch on pending arm | state-convergence | L1 | automated | F1 click while a `status()` promise is in flight, resolving `pending` AFTER the click | resolve it, advance timers 2 s | OAuth flow widget not re-rendered; `status` call count stops growing after cleanup |
| F4 | Report admin policy | state-transition | L1 | automated | waiting flow, client id `603…apps.googleusercontent.com` | choose `admin_policy_enforced` | message contains the client id; `data-step=""` (no wizard step highlighted) |
| F5 | Latch reset | state-transition | L1 | automated | after F1, click Add account again; status poll returns `{status:"error", error:"access_denied"}` | advance timers | access_denied sentence shown, step 3 (latch did not suppress the new flow) |
| F6 | Revoke confirm | state-transition | L1 | automated | one account; mocked `ui:confirm-dialog` primitive | click Revoke → Cancel; then Revoke → Confirm | after Cancel: no DELETE fetch, row present; after Confirm: exactly 1 `DELETE /api/plugins/gmail/accounts/<sub>` |
| F7 | Alias saved feedback | state-transition | L1 | automated | alias input; PATCH → 200 / PATCH → 409 `alias_taken` | type + blur | `role="status"` with "Saved" / mapped alias_taken sentence |
| F8 | Revoke confirm in real UI | state-transition | L3 | automated | harness with one connected fake account (existing F4 setup in `gmail-plugin.spec.ts`) | click Revoke, confirm in dialog | row disappears; fake records `revokes==1`; dismissing the dialog instead leaves the row and `revokes==0` |
| F9 | Visual theming | visual/subjective | — | manual-only | `/settings/plugins/gmail` in all 9 named themes × light/dark | human looks | borders use theme colour (not black), ok badge green, re-auth badge amber, errors red, focus ring visible |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Failure logged once | fault-injection (abort) | L1 | automated | `createCallback` stub whose `waitForCode` rejects `{code:"access_denied"}` | `POST /accounts`, run flow to terminal | exactly one `warn` line `[gmail] sign-in failed: access_denied`; flow status error `access_denied` (unchanged) |
| X2 | Failure logged once | fault-injection | L1 | automated | persist path: sign-in returns another sub (re-auth) / grant lacks tier scopes | re-auth / add | one `warn` each: `…: account_mismatch` / `…: scope_missing` |
| X3 | Pre-first-event failure | fault-injection (abort) | L1 | automated | `createCallback` throws before `auth_url` notify (with a host `startFlow` fake reproducing `login_failed` → `PluginFlowStartError`) | `POST /accounts` | exactly ONE `[gmail] sign-in failed:` line total |
| X4 | Unknown / input-bearing code | EP | L1 | automated | errors with `code:"evil_123"`, `code:"ya29.token"`, `code: 42`, no code, message containing `https://x?code=abc` | each failure path | logged code is `sign_in_failed` for all; no line contains `ya29`, `code=abc`, `https://`, `@`, or the client secret |
| X5 | Start rejection | fault-injection | L1 | automated | `deps.oauth.startFlow` rejects `PluginFlowStartError("start_timeout")` | `POST /accounts` | one `warn` `…: start_timeout`; HTTP 502 `{error:"start_timeout"}` (existing `sendError` shape) |
| X6 | Withheld host message | EP | L1 | automated | flow status `{status:"error", error:"<withheld constant>"}` | poll | generic sentence shown; raw text only in the muted support span |
| X7 | Google page error (real browser) | exploratory | — | manual-only | real Google client with Audience=Internal; account from another Workspace org | Add account, Google shows 403 org_internal, report it in the disclosure | guidance tells to switch to External + add test user; after doing so the account connects |

---

## Coverage summary

- Requirements covered: 5/5 (Guided setup, Revoke, Secrets never logged, Settings section readable, Actionable Gmail API errors)
- Scenarios by class: edge 17 · perf 0 · frontend 9 · error 8
- Scenarios by level: L1 31 · L3 1 · — 2
- Scenarios by disposition: automated 32 · manual-only 2

## New infra needed

- none (X3 reuses the route test's `deps.oauth` fake; F6 mocks `useUiPrimitive` like existing plugin tests; F8 extends `tests/e2e/gmail-plugin.spec.ts`).
