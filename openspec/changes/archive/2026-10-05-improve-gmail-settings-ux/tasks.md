## 1. Error table (wizard.ts, pure)

- [x] 1.1 Test: every design-D2 code maps to a non-generic key with a non-empty English sentence; `Cancelled`/`CANCELLED` map to the cancelled key. Triple: D2 code list · `errorKey` + `ERROR_EN` · non-generic key + sentence. Exemplar `packages/gmail-plugin/src/client/__tests__/wizard.test.tsx` (test-plan #E1); verify it fails
- [x] 1.2 Test: `"fetch failed"`, `""`, `"Org_Internal "`, 65-char string map to `errGeneric`. Triple: unknown inputs · `errorKey` · `errGeneric`. Exemplar `wizard.test.tsx` (test-plan #E2); verify it fails
- [x] 1.3 Test: `errorStep("admin_policy_enforced")` is `null` (new, fails first); regression assertions `org_internal`→3, `access_denied`→3, `state_mismatch`→null stay green. Exemplar `wizard.test.tsx` (test-plan #E3)
- [x] 1.4 Implement `errorKey`, `ERROR_EN`, `KNOWN_FLOW_CODES` and the `admin_policy_enforced` step mapping in `packages/gmail-plugin/src/client/wizard.ts` (design D2); verify 1.1–1.3 pass

## 2. Server failure logging (routes.ts)

- [x] 2.1 Test: loopback `waitForCode` rejecting `{code:"access_denied"}` logs exactly one `warn` `[gmail] sign-in failed: access_denied` and the flow error stays `access_denied`. Triple: callback abort · `POST /accounts` · one warn line, code unchanged. Exemplar `packages/gmail-plugin/src/server/__tests__/routes.test.ts` (test-plan #X1); verify it fails
- [x] 2.2 Test: persist failures log one `warn` each, `account_mismatch` (re-auth returns other sub) and `scope_missing` (grant lacks tier scopes). Exemplar `routes.test.ts` (test-plan #X2); verify it fails
- [x] 2.3 Test: callback factory throwing before the `auth_url` notify, with a host `startFlow` fake that rejects `PluginFlowStartError("login_failed")` after the settled login, yields exactly ONE `[gmail] sign-in failed:` line. Exemplar `routes.test.ts` (test-plan #X3); verify it fails
- [x] 2.4 Test: codes `evil_123`, `ya29.token`, `42`, missing code, and a message containing `https://x?code=abc` all log `sign_in_failed`; no line contains `ya29`, `code=abc`, `https://`, `@` or the client secret. Exemplar `routes.test.ts` E29 secret-free log assertions (test-plan #X4); verify it fails
- [x] 2.5 Test: `deps.oauth.startFlow` rejecting `PluginFlowStartError("start_timeout")` logs one `warn` `…: start_timeout` and replies 502 `{error:"start_timeout"}`. Exemplar `routes.test.ts` (test-plan #X5); verify it fails
- [x] 2.6 Implement the login/persist wrapper, the `startFlow` catch log, the `KNOWN_FLOW_CODES` allow-list and the per-call `logged` flag in `startSignIn` (`packages/gmail-plugin/src/server/routes.ts`, design D3); verify 2.1–2.5 and the existing routes tests pass

## 3. Theme tokens and focus

- [x] 3.1 Add `packages/gmail-plugin/src/client` to `SCAN_ROOTS` in `scripts/theme-token-guard.mjs`, plus a guard test that a `var(--border)` fixture under that root fails the undeclared arm. Triple: gmail root scanned · `scripts/__tests__/theme-token-guard.test.mjs` · undeclared arm fails on current source. Exemplar `scripts/__tests__/theme-token-guard.test.mjs` (test-plan #E7); verify it fails
- [x] 3.2 Test: `GmailSettings.tsx` source has no `text-[var(--accent)]` and `StepLink` uses `--accent-text`. Exemplar `packages/gmail-plugin/src/client/__tests__/client-entry.test.tsx` (source-read pattern) (test-plan #E8); verify it fails
- [x] 3.3 Test: with one account and a waiting flow rendered, every `button, select, input, summary, a` in the section has class `focus-ring`. Exemplar `packages/gmail-plugin/src/client/__tests__/panel.test.tsx` (test-plan #E9); verify it fails
- [x] 3.4 Replace the six undefined tokens per design D4, switch `StepLink` to `--accent-text`, and apply `.focus-ring` to all interactive elements; verify 3.1–3.3 pass with no new baseline entry (`node scripts/theme-token-guard.mjs`)

## 4. Settings UI (GmailSettings.tsx)

- [x] 4.1 Test: a waiting flow shows the disclosure; choosing `org_internal` calls `oauthFlowClient.cancel(flowId)` once, shows the org_internal sentence, sets `data-step="3"` and opens the wizard. Exemplar `panel.test.tsx` "a start failure maps to its wizard step" (test-plan #F1); verify it fails
- [x] 4.2 Test: after F1, the next poll resolving `{status:"error", error:"Cancelled"}` leaves the org_internal sentence and `data-step="3"` in place with no `Cancelled` text (fake timers 1 s). Exemplar `panel.test.tsx` (test-plan #F2); verify it fails
- [x] 4.3 Test: an in-flight `status()` resolving `pending` AFTER the code click does not re-render the OAuth flow widget, and the status call count stops growing (fake timers 2 s). Exemplar `panel.test.tsx` "a level raise whose flow status fails…" (test-plan #F3); verify it fails
- [x] 4.4 Test: choosing `admin_policy_enforced` with client id `603…apps.googleusercontent.com` shows a message containing the client id and `data-step=""`. Exemplar `panel.test.tsx` (test-plan #F4); verify it fails
- [x] 4.5 Test: after a reported code, a new Add account whose poll returns `{status:"error", error:"access_denied"}` shows the access_denied sentence at step 3 (latch reset). Exemplar `panel.test.tsx` (test-plan #F5); verify it fails
- [x] 4.6 Test: a flow status error that is not a known code (withheld constant) shows the generic sentence, with the raw text only in the muted support span. Exemplar `panel.test.tsx` (test-plan #X6); verify it fails
- [x] 4.7 Implement the disclosure, `reportedRef` latch on both poll callbacks, latch reset on new flow, and `t(errorKey(code), {clientId}, ERROR_EN[...])` rendering (design D1/D2); verify 4.1–4.6 and existing panel tests pass
- [x] 4.8 Test: Revoke opens the mocked `ui:confirm-dialog`; Cancel sends no DELETE and the row stays; Confirm sends exactly 1 `DELETE /api/plugins/gmail/accounts/<sub>`. Exemplar `packages/blackhole-plugin/src/client/BlackholeSettings.tsx:167` confirm usage + `panel.test.tsx` revoke test (test-plan #F6); verify it fails
- [x] 4.9 Test: alias blur with PATCH 200 shows `role="status"` "Saved"; with PATCH 409 `alias_taken` shows the mapped sentence. Exemplar `panel.test.tsx` (test-plan #F7); verify it fails
- [x] 4.10 Test: the summary shows `p-1` when projectId is set, shows the client id (never `undefined`) without projectId, and shows `not configured` when unconfigured. Exemplar `panel.test.tsx` (test-plan #E5); verify it fails
- [x] 4.11 Test: `gmail-step-3` text says Internal admits only the project's own Workspace organization, otherwise External + test users. Exemplar `wizard.test.tsx` (test-plan #E6); verify it fails
- [x] 4.12 Test: `gmail-level-help` matches `/not by Google/` and states any dashboard session can use every account within its level; each level `<option>` has a description after the tier. Exemplar `panel.test.tsx` "lists accounts…" (test-plan #E10); verify it fails
- [x] 4.13 Test: the add-account level select has a visible label and a hint mentioning an External audience for other organizations. Exemplar `panel.test.tsx` (test-plan #E11); verify it fails
- [x] 4.14 Implement the revoke confirm via `useUiPrimitive` `ui:confirm-dialog`, the two-line row, alias feedback, level descriptions, add-account label/hint, the i18n'd summary and the step-3 `audienceHelp` text (design D5/D6); verify 4.8–4.13 and existing panel/wizard tests pass

## 5. Consent hint

- [x] 5.1 Test: while a flow is waiting the panel shows the "tick every permission (Select all)" hint next to the `ui:oauth-flow` view, and not when no flow is active. Triple: waiting add-account flow · render · hint visible. Exemplar `packages/gmail-plugin/src/client/__tests__/panel.test.tsx` (test-plan #E12); verify it fails
- [x] 5.2 Test: a flow error `scope_missing` shows the "Gmail permission was not granted, add again with every permission ticked" sentence with `data-step=""`. Exemplar `panel.test.tsx` "a start failure maps to its wizard step" (test-plan #E13); verify it fails
- [x] 5.3 Implement the plugin-owned hint and the `scope_missing` sentence (design D8); verify 5.1–5.2 pass

## 6. Gmail 403 classification (bridge)

- [x] 6.1 Test: a modern `SERVICE_DISABLED` ErrorInfo for `projects/603220229616` yields `api_disabled` whose message names the project and the `gcloud services enable gmail.googleapis.com` command; legacy `accessNotConfigured` yields `api_disabled` without a number. Exemplar `packages/gmail-plugin/src/bridge/__tests__/tools.test.ts` "X6 — Gmail 429" (test-plan #E14); verify it fails
- [x] 6.2 Test: `ACCESS_TOKEN_SCOPE_INSUFFICIENT` and legacy `insufficientPermissions` yield `scope_insufficient` with the re-authenticate instruction. Exemplar `tools.test.ts` X6 (test-plan #E15); verify it fails
- [x] 6.3 Test: `SERVICE_DISABLED` with consumer `projects/abc`, `projects/1;rm -rf`, numeric `12345` or missing yields `api_disabled` and the message contains none of those values. Exemplar `tools.test.ts` X6 (test-plan #E16); verify it fails
- [x] 6.4 Test: `SERVICE_DISABLED` with `metadata.service` `drive.googleapis.com` yields `gmail_error`. Exemplar `tools.test.ts` X6 (test-plan #E17); verify it fails
- [x] 6.5 Test: the 403 bodies `not json`, `{}`, `{error:"x"}`, `{error:{details:"x"}}`, mistyped ErrorInfo fields, and `{error:{message:"SECRET-TEXT",details:[]}}` each reject a `GmailToolError` `gmail_error` (never a raw TypeError), and no message contains `SECRET-TEXT`. Exemplar `tools.test.ts` X6 (test-plan #X8); verify it fails
- [x] 6.6 Implement the guarded 403 branch in `GmailApi.call` (`packages/gmail-plugin/src/bridge/gmail-api.ts`, design D9); verify 6.1–6.5 and all existing bridge tests pass

## 7. i18n

- [x] 7.1 Test: `catalog["zh-CN"]` and `catalog.hu` contain every key `errorKey` returns plus `summaryProject`/`summaryClient`/`summaryNotConfigured` and the consent-hint key. Exemplar `packages/gmail-plugin/src/client/__tests__/client-entry.test.tsx` catalog parity (test-plan #E4); verify it fails, then add the keys to `src/i18n.ts` and verify it plus `npm run i18n:parity` pass

## 8. E2E

- [x] 8.1 Update the revoke scenario in `tests/e2e/gmail-plugin.spec.ts` (exemplar: its own F4 block): click Revoke and confirm in the dialog, so the row disappears and the fake records `revokes==1`; dismissing the dialog instead leaves the row and `revokes==0`. Triple: one connected fake account · Revoke + confirm/dismiss · row + revoke count (test-plan #F8). Verify via the `run-dashboard-e2e-local-changes` harness

## 9. Docs

- [x] 9.1 Update `packages/gmail-plugin/README.md` (audience section + error table incl. `org_internal`, `admin_policy_enforced`, `scope_missing`; tool error codes `api_disabled`, `scope_insufficient`) and the DOX rows in `packages/gmail-plugin/src/client/AGENTS.md`, `src/server/AGENTS.md`, `scripts/theme-token-guard.mjs.AGENTS.md`, `src/bridge/AGENTS.md` (`gmail-api.ts` 403 codes), and `tests/e2e/gmail-plugin.spec.ts.AGENTS.md` (`See change: improve-gmail-settings-ux`); verify the rows are present
- [x] 9.2 Delegate the `docs/gmail-plugin.md` audience/multi-org note to DocScribe (caveman style); verify the section exists

## 10. Verification

- [x] 10.1 `cd packages/gmail-plugin && npx vitest run`, `npx vitest run scripts/__tests__/theme-token-guard.test.mjs` and `npm run quality:changed` all green
- [x] 10.2 Manual (test-plan: manual-only, #F9): after `npm run build` and `/api/restart`, open `/settings/plugins/gmail` in all 9 named themes × light/dark. Check borders use the theme colour, ok badge is green, re-auth badge amber, errors red, and the focus ring is visible
- [x] 10.3 Manual (test-plan: manual-only, #X7): with a real Internal-audience client, add an account from another Workspace org and report `org_internal` in the disclosure. The guidance should say to switch to External and add a test user; after doing that, the account connects
