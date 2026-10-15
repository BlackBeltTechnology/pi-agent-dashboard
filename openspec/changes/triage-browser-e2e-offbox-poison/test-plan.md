# Test Plan — triage-browser-e2e-offbox-poison

Stage: design   Generated: 2026-10-09

Review decisions applied: E1–E6 (`design.md` D6).

---

## Scenarios

Harness exemplars (verified present): `packages/bus-client/src/__tests__/offbox-ticket-denied.test.ts` (BC), `scripts/__tests__/e2e-reap-core.test.mjs` (RC), `scripts/__tests__/e2e-fixture-import.test.mjs` (LINT), `scripts/__tests__/coverage-report.test.mjs` (COV), `scripts/__tests__/coverage-config.test.mjs` (CCFG), `scripts/__tests__/dependency-declarations.test.mjs` (DEP), `scripts/__tests__/seed-settings-default-model.test.mjs` (SEED), `tests/e2e/network-guard.spec.ts` (NG), `tests/e2e/lan-knock.spec.ts` (LK), `tests/e2e/mcp-tiered-token.spec.ts` (MTT). L3 base URL from `.pi-test-harness.json` `dashboardPort`, never :18000.

### Edge-case

| id | requirement | technique | level | disposition | exemplar | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|----------|-------|---------|---------------------|
| E1 | bus-client: denial self-describing | EP | L1 | automated | BC | stub `/api/ws-ticket` → 403 `{success:false,error:"network_not_allowed",reason:"Source IP not loopback…",hint:"try host X"}` | `connect()` | throws `OffBoxError`, `.code==="off-box"`, `.status===403`, `.error==="network_not_allowed"`; message contains `403`, `network_not_allowed`, the reason |
| E2 | bus-client: no extra body fields | EP | L1 | automated | BC | as E1, `hint:"host-secret.example"`, extra `token:"abc"` | `connect()` | message contains neither `host-secret.example` nor `abc`; no `.hint` property |
| E3 | bus-client: 401 auth plane | EP | L1 | automated | BC | stub → 401, empty body | `connect()` | `.status===401`, `.error===undefined`; message does not contain `network_not_allowed` nor any reason text |
| E4 | bus-client: denied without machine-readable body | EP | L1 | automated | BC | 403 body `{}` / `{success:false}` | `connect()` | `.status===403`, `.error===undefined`; message has no "reason" clause |
| E5 | bus-client: non-JSON body | fault (malformed) | L1 | automated | BC | 403 body `<html>Bad Gateway</html>` | `connect()` | rejects with `OffBoxError` (instanceof), `.status===403`; never `SyntaxError` |
| E6 | bus-client: reason is prose, not branchable | EP | L1 | automated | BC | 403 `{error:"network_not_allowed",reason:"local_proof_required"}` | `connect()` | `.error==="network_not_allowed"`; no typed field carries `local_proof_required` |
| E7 | bus-client: success flag missing | EP | L1 | automated | BC | 200 `{success:false,reason:"x"}` and 200 `{success:true}` (no ticket) | `connect()` | `OffBoxError` carrying reason `x` / no ticket; existing behaviour kept |
| E8 | refusal verdict decision table | decision-table | L1 | automated | RC | `{status:403,error:"network_not_allowed"}`, armed | `decideRefusal` | `latch` + fail; message names harness, `403`, literal, reason |
| E9 | refusal verdict | decision-table | L1 | automated | RC | `{status:403,error:"host_not_allowed"}`, armed | `decideRefusal` | `latch` |
| E10 | refusal verdict | decision-table | L1 | automated | RC | `{status:403,error:"forbidden"}` ; `{status:403}` ; `{status:401}` | `decideRefusal` | `fail-no-latch`; message names status + literal (if any) |
| E11 | refusal verdict | decision-table | L1 | automated | RC | `{status:undefined}` (transport) | `decideRefusal` | `warn-continue`; latch untouched; liveness counter governs |
| E12 | refusal verdict disarmed | decision-table | L1 | automated | RC | policy 403 × {`credentialFreeAdmitted:false`, registry active, both} | `decideRefusal` | `warn-continue` (no latch, no fail) in all 3 rows; armed only when admitted=true ∧ registry empty |
| E13 | literal list is one exported constant; classifier ignores message text | EP | L1 | automated | RC | error object with `.message` containing `network_not_allowed` but `.error==="forbidden"` | `decideRefusal` | `fail-no-latch` (message text not consulted); constant equals exactly `["network_not_allowed","host_not_allowed"]` |
| E14 | trust comparison helper | EP | L1 | automated | RC | pre == post over all 7 keys | `compareTrust` | `ok` |
| E15 | trust comparison helper | EP | L1 | automated | RC | `trustedNetworks` `["0.0.0.0/0"]`→`[]`; `hostGate.mode` `off`→`enforce`; `resolvedTrustedNetworks` differs only | `compareTrust` | `breach` naming each differing key with before/after |
| E16 | trust comparison helper | BVA | L1 | automated | RC | list reordered; key absent vs `[]` | `compareTrust` | (E2 decision: fill defaults, then exact in-order) absent `auth.bypassUrls` vs `[]` → `ok`; `trustedNetworks` `["a","b"]`→`["b","a"]` → `breach` naming `trustedNetworks` before/after |
| E17 | L2 re-assert decision | decision-table | L1 | automated | RC | baseline wide/live narrow; baseline narrow `["127.0.0.1/32"]`/live narrow same; baseline `null` | `decideReassert` | write baseline / no-op (narrow stays narrow, never seed) / no-op |
| E18 | pre-read vs baseline, registry empty | state | L1 | automated | RC | registry empty, live ≠ baseline, lastReleasedOwner=`lan-knock.spec.ts` | `decidePreRead` | re-assert + fail naming `lan-knock.spec.ts`; registry active → no check |
| E19 | narrowTrust scope derivation | state | L3 | automated | LK | call from `beforeAll` vs test body | narrowTrust | describe record survives across 2 serial tests; test record drained after each test (observe via config read in next test) |
| E20 | narrowTrust no-credential path | EP | L3 | automated | NG | harness with no `auth` (narrow leg, `PW_E2E_GUARD_UNTRUSTED=1`) | throwaway test calls `narrowTrust(request,{trustedNetworks:[]})` | test fails with "harness has no operator credential — …dedicated leg"; `GET /api/config` (credential-free where readable) unchanged |
| E21 | repo lint: writes outside narrowTrust | decision-table | L1 | automated | LINT | in-memory spec sources: `PUT /api/config` with `trustedNetworks`; `putConfig({allowedHosts})`; in-container `config.json` write of `hostGate`; `stubConfig`/`page.route` with `trustedNetworks`; `narrowTrust(...)` | lint analyze | first three FAIL naming file+key; stub/route and narrowTrust pass |
| E22 | repo lint: mutation check | mutation | L1 | automated | LINT | revert one migrated spec in-memory to raw `PUT /api/config` | analyzeRepository | goes red (guard can fail) ; current tree green |
| E23 | PI_E2E_SEED override parsing | EP+BVA | L1 | automated | SEED — see New infra | `PI_E2E_TRUSTED_NETWORKS` = unset / `""` / `" , "` / `"127.0.0.1/32"` / `" 10.0.0.0/8 , ,192.168.0.0/16 "` | run the config-seed `node -e` program extracted verbatim from `docker/test-entrypoint.sh` with a tmp output path | `trustedNetworks` = `["0.0.0.0/0"]`,`["0.0.0.0/0"]`,`["0.0.0.0/0"]`,`["127.0.0.1/32"]`,`["10.0.0.0/8","192.168.0.0/16"]` |
| E24 | seed default stays UI-only | static | L1 | automated | as E23 | `docker/test-entrypoint.sh` source | parse shell structure | the trust/config seed program sits inside the `if [ "${PI_E2E_SEED:-}" = "1" ]` block (nothing seeds `trustedNetworks`/auth/faux/`defaultModel` with `PI_E2E_SEED` unset) |
| E25 | seed no-op when file exists | static | L1 | automated | as E23 | `docker/test-entrypoint.sh` source | parse shell structure | the config seed program is guarded by `if [ ! -f "${PI_DIR}/dashboard/config.json" ]` (existing file never rewritten) |
| E26 | publish budget formula | BVA | L1 | automated | DEP | `N` from `listWorkspaces().length + (rootPackage()?1:0)`; pure `budgetSeconds(N)` | N=0,1,57,58 | 30, 33, 201, 204 |
| E27 | publish budget boundary | BVA | L1 | automated | DEP | measured = budget−0.001 / = budget / budget+0.001 at N=57 | pure `withinBudget` | pass / pass ("within" = ≤) / fail with message `measured 201.001s vs budget 201s (57 workspaces)` |
| E28 | N uses checker's enumeration | EP | L1 | automated | DEP | temp fixture root with 2 non-private + 1 private workspace, root non-private | compute N via imported helpers | N=3 ; private root → N=2 |
| E29 | coverage fixture lint | decision-table | L1 | automated | LINT / COV | in-memory file outside fixture importing `fixtures/coverage-unloaded/src/*`; file inside fixture importing it | lint | outside → fail naming importer; inside → pass; current tree green |
| E30 | fixture excluded from root globs | EP | L1 | automated | CCFG | root vitest config | resolve `coverage.include`/test globs against `scripts/__tests__/fixtures/coverage-unloaded/src/x.ts` | not included in coverage nor collected as test |
| E31 | sampled coverage scope pinned | EP | L1 | automated | CCFG | root config | evaluate globs | `packages/extension/src/bridge.ts` counted; `__tests__/`, `test-support/`, `*.d.ts`, `packages/electron/` sample excluded (existing cases, confirm 1:1 with spec) |

### Performance

| id | requirement | technique | level | disposition | exemplar | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|----------|--------------------|--------|
| P1 | tripwire per-test cost | measurement (E1: record only) | — | manual-only | — | full shard, tripwire+pre-read on vs off | added ms/test recorded in `design.md` as evidence; no threshold asserted | one shard |
| P2 | publish check CI budget | threshold | L1 (timed) | automated | DEP | full checker across all non-private workspaces | wall clock ≤ `30+3*N` s (201 s at N=57) | single run |
| P3 | coverage scoped scenario ceiling | threshold | L1 (timed) | automated | COV | `npm run test:coverage` over `coverage-unloaded` fixture | completes < `RUN_TIMEOUT_MS`, and `RUN_TIMEOUT_MS ≥ 1.5 × recorded CI measurement` (comment beside constant asserted by a static check) | single run |
| P4 | scenario does not scale with repo | static | L1 | automated | COV | E2 invocation argv/config | spawned config's `include` resolves to the fixture only; no `packages/*` project loaded (no project config referenced outside fixture) | — |
| P5 | refusal fails fast | threshold | L3 | automated | NG | throwaway serial spec: test1 narrows `trustedNetworks:[]` via raw write bypass (allowlisted throwaway), 5 later tests | shard wall clock for the 5 later tests ≤ 1 test timeout (60 s) total; 1 failed + 4 skipped | one run |
| P6 | shard 10 back to pre-regression duration (task 5.3) | soak | — | manual-only | — | dispatched `ci-e2e-browser.yml` shard 10 | ≤ 24 min (run 36343992345) | live CI dispatch |

### Frontend-quirk (harness state convergence)

| id | requirement | technique | level | disposition | exemplar | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|----------|-------|---------|---------------------------------|
| F1 | describe-scope narrowing doesn't stop run | state-transition | L3 | automated | LK | `lan-knock` migrated: `narrowTrust` in `beforeAll` (`trustedNetworks: NOBODY`) | run its tests | each test logs `[reap] pre-snapshot skipped: declared narrowing active (lan-knock.spec.ts)`; no latch; all tests execute |
| F2 | describe-scope not a breach; group end = baseline | convergence | L3 | automated | LK | as F1 + following spec in same worker | group ends | no tripwire failure inside group; next test's pre-read equals `.trust-baseline.json` |
| F3 | describe-scope session release at group end | convergence | L3 | automated | LK | group spawns 1 session | `afterAll` drain | after restore, session list delta vs describe pre-snapshot = 0 before next group's first test |
| F4 | correctly restoring spec not a breach | state | L3 | automated | MTT | migrated `mcp-tiered-token` (test scope) | test passes | post-test read == pre-test read; reap released spec's sessions (residual budget unchanged) |
| F5 | UI-driven `touches:` restore | state | L3 | automated | `tests/e2e/host-gate-allow.spec.ts` | F9 adds `allowedHosts` via UI Save under `narrowTrust(request,{}, {touches:["allowedHosts"]})` | test ends | `allowedHosts` equals pre-test value on next read |
| F6 | harness booted narrow does not stop run / not widened | state | L3 | automated | NG | narrow leg `PI_E2E_TRUSTED_NETWORKS=127.0.0.1/32` | run `network-guard.spec.ts` | all tests execute, no latch; `.trust-baseline.json` has `credentialFreeAdmitted:false` and `baseline:null` (no credential on this leg); a guarded endpoint still answers 403 `network_not_allowed` at the end of the run (worker start did not widen) |
| F7 | healthy harness unaffected | invariant | L3 | automated | NG | default shared harness | run 3 ordinary specs | same pass/skip counts and order as with gate disabled; no `[reap]` refusal lines |
| F8 | verification works while narrowed | state | L3 | automated | MTT | inside a test-scope narrowing (`trustedNetworks:[]`) | tripwire/pre-read | config read succeeds with operator cookie (200); credential-free 403 not recorded as a config difference |

### Error-handling

| id | requirement | technique | level | disposition | exemplar | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|----------|-------|---------|---------------------|
| X1 | unreachable mint endpoint | fault (abort) | L1 | automated | BC | fetch rejects ECONNREFUSED to base URL | `connect()` | `OffBoxError` naming base URL, `.status===undefined`; message text ≠ any policy-denial text |
| X2 | slow mint endpoint | fault (delay) | L1 | automated | BC | fetch never resolves until existing client timeout | `connect()` | rejects within the client's existing timeout with the unreachable-shaped `OffBoxError` (no `.status`) |
| X3 | refusing harness stops run | fault-injection | L3 | automated | NG (throwaway) | harness narrowed outside `narrowTrust` (undeclared) | next test's pre-snapshot | 403 `network_not_allowed` → that test fails with message naming harness, `403`, reason; every remaining test reported skipped |
| X4 | host-gate refusal latches | fault-injection | L3 | automated | `tests/e2e/preview-denial-remedy.spec.ts` (throwaway) | `hostGate.mode=enforce`, harness Host not allowed, undeclared | pre-snapshot | 403 `host_not_allowed` → latch, rest skipped |
| X5 | slow harness not dead (existing, regression) | fault (delay) | L1 | automated | RC | probe fails ×2 then ok | gate | not latched |
| X6 | daemon death (existing, regression) | fault (abort) | L1 | automated | RC | 3 consecutive probe failures | gate | latch; ≤1 extra failure; rest skipped |
| X7 | 401 at pre-snapshot | fault | L1 | automated | RC | `OffBoxError{status:401}` | fixture catch path (pure wiring fn) | current test fails naming `401`; liveness counter unchanged; no latch |
| X8 | timed-out spec still restores | fault (timeout) | L3 | automated | NG (throwaway, `harness-isolation-faults.spec.ts`) | test calls `narrowTrust(request,{trustedNetworks:[]})` then hangs past `timeout` | test timeout | next test reaches harness (pre-snapshot succeeds); tripwire does NOT fire on the timed-out test; `trustedNetworks` == baseline |
| X9 | retry after refusal latch (sticky, E4) | state | L1 | automated | RC | refusal latch latched by `{status:403,error:"network_not_allowed"}`, then gate consulted again with probe ok (the retry) | gate decision | `skip` with the harness-unusable message; latch still armed; no re-probe clears it |
| X10 | killed worker does not poison successor | fault (kill) | L3 | automated | NG (throwaway) | test narrows via `narrowTrust` then `process.kill(process.pid,'SIGKILL')` | Playwright starts fresh worker | new worker's start fixture writes baseline back; next spec's pre-snapshot succeeds; live keys == `.trust-baseline.json` |
| X11 | rejected operator credential | fault (auth) | L1 + L3 | automated | RC ; NG | operator cookie signed with wrong secret (env override in throwaway) | worker-start fixture | first test fails with `operator credential rejected: 401 <error>`; rest skipped |
| X12 | globalSetup baseline mint transport failure (E3) | fault (delay/abort) | L1 | automated | RC | injected mint: ECONNREFUSED ×2 then 200; and ECONNREFUSED/timeout until the health-wait budget expires | pure admission-recording helper | first → `credentialFreeAdmitted:true` after retries; second → throws naming the transport failure (setup aborts); `credentialFreeAdmitted:false` never produced from a transport failure |
| X13 | globalSetup with no access at all | fault | L1 | automated | RC | no credential, credential-free `/api/config` → 403 | record baseline | file `{baseline:null, credential:false, credentialFreeAdmitted:false}`; L2/tripwire/refusal verdict all no-ops |
| X14 | leaked describe-scope narrowing (afterAll failed) | fault | L3 | automated | LK (throwaway) | describe `afterAll` drain throws before restore | next spec's first test | pre-read ≠ baseline → baseline re-asserted; that test fails naming the describe's spec; following test passes |
| X15 | tripwire attributes undeclared UI write | fault | L3 | automated | `tests/e2e/gateway-url-action.spec.ts` (throwaway) | test changes `trustedNetworks` via UI Save without `touches:` | post-test tripwire | owning test fails naming spec + `trustedNetworks` before/after; next test not first to fail |
| X16 | `/api/config` lacks a trust key | fault | L1 | automated | RC | config response missing `requireLocalProof` | compareTrust/baseline read | key dropped with logged note; no false breach |
| X17 | coverage fixture rots | fault | L1 | automated | LINT | see E29 | — | covered by E29 |
| X18 | bisect decision (task 4.1/4.2) | — | — | manual-only | — | live `ci-e2e-browser.yml` dispatch on develop (baseline + instrumented) | dispatch | first denial line recorded verbatim in design.md `## Bisect outcome` |
| X19 | #683 candidate unquarantine (task 5.5) | — | — | manual-only | — | original #683 failure log + ≥3 consecutive green dispatched runs | review | decision + run ids recorded in triage table |

---

## Coverage summary

- Requirements covered: 8/8 (bus-client mint rejection; PI_E2E_SEED; dead/refusing harness latch; no-narrowing-left-behind; coverage scoped verification; publish budget; + bisect/triage tasks as manual)
- Scenarios by class: edge 31 · perf 6 · frontend 8 · error 19 (=64)
- Scenarios by level: L1 42 (incl. 2 timed) · L3 17 · L1+L3 1 (X11) · L2 0 · ci 0 · — 4
- Scenarios by disposition: automated 60 · manual-only 4 (P1, P6, X18, X19)
- Clarifications: none open — C1–C4 resolved by review decisions E1–E4 (design.md D6)

## New infra needed

- E23–E25: no unit harness exists for `docker/test-entrypoint.sh`. New `scripts/__tests__/e2e-trust-seed.test.mjs` extracts the config-seed `node -e '…'` program verbatim from the entrypoint and runs it with a tmp output path (E23), and asserts the shell gating structure statically (E24, E25). No entrypoint change (spec-sync only).
- L3 fault specs (X3, X4, X8, X10, X11-L3, X14, X15, P5) live in `tests/e2e/harness-isolation-faults.spec.ts`, which SKIPS unless `PW_E2E_HARNESS_FAULTS=1` (same pattern as `network-guard.spec.ts`'s `PW_E2E_GUARD_UNTRUSTED`), runs only against a dedicated fresh harness, and is allowlisted by the E21 trust-write lint. It never runs in the default shards.
- E20 is an extra test in `tests/e2e/network-guard.spec.ts` (runs only on its no-auth narrow leg, `PW_E2E_GUARD_UNTRUSTED=1`).
