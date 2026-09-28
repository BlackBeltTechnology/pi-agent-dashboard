# Test Plan — add-gmail-plugin

Stage: design   Generated: 2026-09-23

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | setup: client validation | decision-table | L1 | automated | JSON with `installed` + id `x.apps.googleusercontent.com` + secret; `web` block; `installed` without secret; id without that suffix; non-JSON | upload | first accepted and stored under `client`; the others rejected with step-4/5 guidance |
| E2 | setup: error→step map | decision-table | L1 | automated | callback errors `access_denied`, `org_internal`, `redirect_uri_mismatch`, `invalid_client` | test sign-in fails | mapped to steps 3, 3, 4, 5 respectively |
| E3 | setup: deep links | EP | L1 | automated | project id `my-proj-1` | render wizard | links contain `?project=my-proj-1` for branding/audience/clients; the gcloud commands contain `my-proj-1` |
| E4 | sign-in: auth URL | EP | L1 | automated | tier `draft`, re-auth of `a@x.com` | build URL | `scope` = `openid email …gmail.readonly …gmail.compose`; `access_type=offline`; `prompt=consent select_account`; `login_hint=a@x.com`; `nonce` present; no `include_granted_scopes`; redirect `http://127.0.0.1:<port>/` |
| E5 | sign-in: id_token claims | decision-table | L1 | automated | id_token variants: valid; wrong `aud`; wrong `iss`; expired; nonce mismatch; `email_verified:false` | code exchange | only valid → account stored; others fail with no store write |
| E6 | sign-in: missing refresh (new) | EP | L1 | automated | token response without `refresh_token`, new `sub` | persist | fails with the "revoke app access and retry" message; no record |
| E7 | sign-in: re-auth in place | state-transition | L1 | automated | existing `acct:s1` alias `work`; re-auth returns `sub s1`, new email | persist | one record `acct:s1`, alias `work`, email updated |
| E8 | sign-in: parallel adds | state-transition | L1 | automated | two add flows (`add-<uuid1>`, `add-<uuid2>`) | complete both | two records; neither flow superseded |
| E9 | paste path | decision-table | L1 | automated | pasted `http://127.0.0.1:1/?code=c&state=<callback.state>`; wrong state; garbage | manual_code input | first completes; second `state_mismatch`; third `invalid_redirect`; errors never contain the input |
| E10 | account resolution | decision-table | L1 | automated | accounts: s1 `a@x.com` alias `work`; s2 `B@y.com`; s3 & s4 both `dup@z.com` | resolve `work`, `b@Y.com`, `dup@z.com`, `nobody` | s1; s2; ambiguity error asking for an alias; not-found listing the aliases/emails |
| E11 | alias uniqueness | EP | L1 | automated | alias `work` on s1 | set alias `work` on s2 | rejects |
| E12 | tier × op matrix | decision-table | L1 | automated | tiers readonly/draft/send × ops read/draft/send/modify/trash | lease | allowed iff tierRank ≥ opRank; else `tier_denied` |
| E13 | scope implication | decision-table | L1 | automated | send tier with grantedScopes `[gmail.modify]` | lease op `read` and `draft` | allowed (implication table); readonly tier with `[gmail.readonly]` op draft → `tier_denied` |
| E14 | scope missing | EP | L1 | automated | draft tier but grantedScopes `[gmail.readonly]` | lease op draft | `scope_missing` |
| E15 | downgrade immediate | state-transition | L1 | automated | account send tier | set tier readonly, then `gmail_send` | the very next call is refused `tier_denied`; no Gmail call recorded |
| E16 | lease reply shape | EP | L1 | automated | valid lease | inspect reply | keys exactly `accessToken, expiresAt, email, tier`; no `refresh` |
| E17 | refresh window | BVA | L1 | automated | access expires in 61 s / 60 s / 59 s | lease | no refresh / refresh / refresh |
| E18 | tools: accounts | EP | L1 | automated | two accounts | `gmail_accounts` (no args) | lists both with level + status; `details.untrusted` absent |
| E19 | tools: account required | EP | L1 | automated | `gmail_search` without `account` | call | error listing the connected accounts; no lease request |
| E20 | tools: untrusted marking | EP | L1 | automated | search/get/labels/attachments results | call each | `details.untrusted === true` on all four; HTML get has `contentType: text/html` |
| E21 | guard declarations | EP | L1 | automated | bridge load, guard absent | load | registry `declarations` has reads→untrusted and writes→selfConfirming |
| E22 | search limits | BVA | L1 | automated | `maxResults` 0 / 1 / 50 / 51 | `gmail_search` | 0 and 51 rejected by the tool schema before any lease request; 1 and 50 accepted |
| E23 | confirm content | EP | L1 | automated | `gmail_send` to 2 recipients, subject S, 5 KB body | confirm prompt | shows account, both recipients, S, ≤ 500-char body preview |
| E24 | confirm outcomes | decision-table | L1 | automated | write tool | confirm true / false / dismissed / timeout; `hasUI=false` | executes / not executed ×4; recorded Gmail calls = 1/0/0/0/0 |
| E25 | reply threading | EP | L1 | automated | original message id `<m1@x>`, thread `t1` | `gmail_reply` confirmed | sent raw has `In-Reply-To: <m1@x>`, `References` ending `<m1@x>`, request body `threadId: t1` |
| E26 | MIME | EP | L1 | automated | UTF-8 subject `Árvíztűrő`, body, 1 attachment | build + parse | round-trips subject, body and attachment bytes |
| E27 | attachment confinement | decision-table | L1 | automated | targets `a.pdf`, `../../.ssh/x`, `sub/link` (symlink → /tmp), an existing file, `\\\\?\\C:\\x` | save | only `a.pdf` written; others refused; the existing file unchanged |
| E28 | endpoint override gate | decision-table | L1 | automated | `PI_E2E_GOOGLE_BASE_URL` = `http://127.0.0.1:9999`, `http://localhost:9999`, `https://evil.com`, unset | resolve endpoints | first two used; third ignored + warning; unset → Google defaults |
| E29 | secrets never logged | invariant | L1 | automated | full sign-in + lease + refresh + revoke with a captured logger | run | logs contain no access/refresh token, client secret, code or pasted URL |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | single-flight refresh | load | L1 | automated | 10 concurrent leases on an expiring account | fake token endpoint receives exactly 1 refresh; all 10 get the same token | single run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | wizard + add account | state-convergence | L3 | automated | harness with `PI_E2E_GOOGLE_BASE_URL` → fake-google; valid client JSON | upload JSON → Add account → flow view → paste the redirect from fake-google | accounts panel converges to 1 row `a@fake.test`, level readonly, status ok |
| F2 | two accounts | state-convergence | L3 | automated | F1 state | add a second account `b@fake.test` at level send | 2 rows with their own levels |
| F3 | level change | state-transition | L3 | automated | account at readonly | raise to send (re-consent via fake-google) then lower to draft | the row shows send after consent, then draft immediately with no flow shown |
| F4 | revoke | state-transition | L3 | automated | account present; fake-google revoke endpoint returns 200, then a second run with it down | click Revoke | row removed; UI says remote revoke ok / must revoke manually |
| F5 | tool round-trip | state-convergence | L3 | automated | account `a@fake.test` level send; harness session | prompt: send a mail via `gmail_send` from `a@fake.test` | confirm card appears; after approve, fake-google records 1 send with the expected recipients |
| F6 | reauth badge | state-transition | L3 | automated | fake-google returns `invalid_grant` on refresh | trigger a tool call | panel shows "re-auth needed"; the tool result reports reauth_required |
| F7 | real Google end-to-end | manual smoke | — | manual-only | real GCP project via the wizard, 2 real accounts | add both, read, draft, send-to-self, revoke | [judgment: works against live Google incl. testing-mode notice] |
| F8 | wizard clarity | subjective | — | manual-only | wizard steps 1–6 | a non-expert follows it | [judgment: can complete setup without external docs] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | invalid_grant | fault-injection (abort) | L1 | automated | token endpoint returns `invalid_grant` | lease | record status `reauth_required`; reply `reauth_required`; later leases refused without network |
| X2 | token endpoint down | fault-injection (abort) | L1 | automated | refresh returns HTTP 503 | lease | reply error `refresh_failed`; status stays `ok`; no token leaked in the error |
| X3 | token endpoint slow | fault-injection (delay) | L1 | automated | refresh delayed 20 s | lease | lane `timeout` at 15 s for the caller; refresh completes and is stored; the next lease succeeds without a new refresh |
| X4 | concurrent refresh + re-auth | fault-injection (race) | L1 | automated | refresh in flight while re-auth persists new tokens for the same sub | both finish | the final record holds the re-auth refresh token (update-based merge; nothing clobbered) |
| X5 | revoke offline | fault-injection (abort) | L1 | automated | revoke endpoint unreachable | revoke | local record deleted; result flag `remoteRevoked:false` |
| X6 | Gmail API 429/5xx | fault-injection (abort) | L1 | automated | Gmail returns 429 with Retry-After 2 | `gmail_search` | tool error states rate-limited + retry-after; no retry storm (≤ 1 call) |
| X7 | cancel closes listener | fault-injection (abort) | L1 | automated | add flow pending | cancel flow | loopback port closed within 100 ms; no unhandled rejection |
| X8 | paste wins race | fault-injection | L1 | automated | paste completes before the callback | flow ends | callback closed; `unhandledRejection` listener not fired |

---

## Coverage summary

- Requirements covered: 11/11
- Scenarios by class: edge 29 · perf 1 · frontend 8 · error 8
- Scenarios by level: L1 38 · L2 0 · L3 6 (+2 manual-only)
- Scenarios by disposition: automated 44 · manual-only 2

## New infra needed

- `tests/e2e/helpers/fake-google.ts` fake Google server (authorize redirect, token, revoke, minimal Gmail REST: search/get/labels/send), started by the L3 specs. The harness passes `PI_E2E_GOOGLE_BASE_URL` to the dashboard container.
- Depends on the seams change's demo-plugin fixture for nothing; Gmail's own plugin is the fixture.
