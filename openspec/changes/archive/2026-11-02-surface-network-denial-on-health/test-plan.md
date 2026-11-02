# Test Plan — surface-network-denial-on-health

Stage: design   Generated: 2026-10-30

Clarifications resolved at the hard gate (2026-10-30):
- Browser level → new no-sign-in `pair`-mode E2E harness variant + spec (option A).
- Performance → deterministic `statSync` ceiling only; no wall-clock p99 (option A).

Notation: "remote caller" = request with a non-loopback peer (`fastify.inject({ remoteAddress: "192.168.16.31" })` or equivalent) and no forwarding header. "Generic hint" = `GENERIC_NETWORK_DENIED_HINT` ("Pair this device (Request access) or sign in."). Server L1 rows use a real wired server (`createTestServer`, as `packages/server/src/__tests__/local-proof-remedy.test.ts`) unless marked unit.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | trust: Health reports the caller's own verdict | decision-table | L1 | automated | `network.trustMode:"pair"`, no OAuth provider, passkeys off; remote caller, no cookie/bearer | `GET /api/health` | `200`; body `networkAccess` deep-equals `{ error:"network_not_allowed", hint:<generic hint> }`; no `localProof` key |
| E2 | trust: Health reports the caller's own verdict (403 parity) | decision-table | L1 | automated | same server + caller as E1 | `GET /api/paired-devices` | `403`; body `error:"network_not_allowed"`, `hint` === E1 `networkAccess.hint` |
| E3 | trust: Signed-out caller on an OAuth server also gets the verdict | decision-table | L1 | automated | `pair`; OAuth `github` provider seeded (non-blank clientId), no `bypassUrls`; remote caller, no session | `GET /api/health`, then `GET /api/paired-devices` | health `200` with the E1 `networkAccess` value; guarded route `401` (auth hook), not `403` |
| E4 | trust: Signed-out caller … (passkeys-only sign-in) | decision-table | L1 | automated | `pair`; no OAuth provider, `passkeys.enabled:true`; remote caller | `GET /api/health` | `200` with the E1 `networkAccess` value |
| E5 | trust: Admitted callers see no field | decision-table | L1 | automated | `pair` server; six callers: (a) remote + valid device bearer header, (b) remote + valid device cookie, (c) remote + valid session cookie (OAuth seeded), (d) loopback + local token, (e) loopback + valid local-proof cookie; plus `legacy` server with `trustedNetworks:["192.168.16.0/24"]` and (f) remote `192.168.16.31` | `GET /api/health` per caller | each body has no `networkAccess` key |
| E6 | trust: Local-proof caller gets only the local-proof field | decision-table | L1 | automated | `requireLocalProof` default (strict); loopback peer, no proof, no credential | `GET /api/health` | body `localProof:"required"`; no `networkAccess` key |
| E7 | trust: Admitted callers see no field (query string); design D8 | EP | L1 | automated | `pair` + OAuth seeded; remote caller with valid session cookie | `GET /api/health?x=1` | `200`; no `networkAccess` key (session tagged by pathname) |
| E8 | trust: Health verdict carries no posture | decision-table | L1 | automated | caller X = remote `192.168.16.31`, no credential; server A `pair`; server B `legacy` with `trustedNetworks:["10.0.0.0/8"]` | `GET /api/health` on A and on B | both bodies carry deep-equal `networkAccess`; neither has `accessGrants`, `trustPosture`, nor any key whose value contains `192.168`, `10.0.0.0`, `pair` or `legacy` |
| E9 | trust: Presence reveals only the caller's own admission | decision-table | L1 | automated | caller X; server A `pair`; server C `legacy` with `trustedNetworks:["192.168.16.0/24"]` | `GET /api/health` and `GET /api/paired-devices` on A and C | A: field present + guarded `403`; C: field absent + guarded route not `403 network_not_allowed` |
| E10 | trust: verdict equals non-observe route (design D2, no override) | decision-table | L1 | automated | strict mode; loopback peers: (a) no proof + valid session cookie, (b) no proof + local token, (c) no proof, no credential | `GET /api/health` vs `GET /api/paired-devices` | (a),(b): no `networkAccess` and guarded route admitted; (c): `localProof` only (E6) |
| E11 | design D4 — generic 403 constants; strict body untouched | EP | L1 | automated | remote caller refused (generic); loopback caller lacking proof (strict) | `GET /api/paired-devices` for each | generic body `{ success:false, error:"network_not_allowed", reason:<unchanged string>, hint:GENERIC_NETWORK_DENIED_HINT }`; strict body byte-identical to pre-change snapshot (`reason:"local_proof_required"`, existing hint) |
| E12 | design D2 — `evaluateNetworkPass` arms (unit) | decision-table | L1 | automated | requests: genuine-local proofed; strict bare-local on observe route; strict bare-local on `/v1/*`; local token; `isAuthenticated`; trusted CIDR; none | `evaluateNetworkPass(req, opts)` | `passed` = `"local"`, `"strict-exception"`, `"strict-exception"`, `"token"`, `"auth"`, `"trusted"`, `null` respectively; `trustedList` set only for the last two |
| E13 | design D8 — exact-path session tagging | EP | L1 | automated | OAuth seeded; remote caller with valid session cookie | `GET /api/health`, `/api/health?probe=1` (tagged → no field) and `GET /api/healthcheck` | first two: no `networkAccess`; `/api/healthcheck` is not tagged by the health branch (falls through to the normal auth hook path: `401`/`404`, never `200` via the health exemption) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | design Risks — verdict I/O ceiling | threshold (syscall count) | L1 | automated | 100 sequential `GET /api/health` from remote caller (E1), fake clock frozen | `fs.statSync` calls on `config.json` path attributable to the verdict ≤ 1 | 100 requests within one 1 s TTL window |
| P2 | design Risks — short-circuit callers pay nothing | threshold (syscall count) | L1 | automated | 100 `GET /api/health` each from loopback+local-token and from remote+device bearer | `fs.statSync` calls from the verdict path = 0 | 100 requests |
| P3 | design Risks — TTL refresh | threshold (syscall count) | L1 | automated | E1 caller; 3 requests at t=0, t=0.5 s, t=1.1 s (fake timers) | verdict `statSync` count = 2 (t=0 and t=1.1 s) | 1.1 s |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | banner: Network-not-allowed (200 trigger) | state-convergence | L1 | automated | `useNetworkDenied("offline", "")`, fetch → `200 { ok:true, networkAccess:{ error:"network_not_allowed", hint:"H" } }` | hook effect runs | `result.current` deep-equals `{ hint:"H" }` |
| F2 | banner: local-proof precedence | decision-table | L1 | automated | fetch → `200 { localProof:"required", networkAccess:{…} }` | hook effect runs | `result.current.reason === "local_proof_required"` (local-proof result, not `{ hint:"H" }`) |
| F3 | banner: malformed verdict is not a denial | EP | L1 | automated | fetch → `200` with (a) `networkAccess:{ error:"other" }`, (b) `networkAccess:{ error:"network_not_allowed", hint: 42 }`, (c) `networkAccess:"x"` | hook effect runs | (a) `null`; (b) `{}` (no hint); (c) `null` |
| F4 | banner: verdict clears on admission | state-transition | L1 | automated | `intervalMs:1000`; fetch returns the F1 body, then `200 { ok:true }` | advance 1000 ms | `result.current` goes `{ hint }` → `null` |
| F5 | banner: probe credential is origin-scoped (design D6) | invariant | L1 | automated | `installDeviceAuthFetch()` active; page origin `http://a:8000` with identity token `ID`; slot for `http://b:8000` = `SLOT`; hook `apiBase = "http://b:8000"`, no `fetchImpl` | hook probes | the underlying fetch for `http://b:8000/api/health` carries `Authorization: Bearer SLOT`, never `Bearer ID` |
| F6 | banner: Visible disconnection banner replaced on denial (desktop) | state-transition | L1 | automated | `App` rendered with WS status `offline` and `useNetworkDenied` → `{ hint:"H" }` | render | `network-denied-request-access` present; text "Server offline" absent |
| F7 | banner: Unpaired remote browser with no sign-in sees Request access | state-convergence | L3 | automated | new harness variant: `PI_E2E_TRUST_MODE=pair`, `PI_E2E_OAUTH=0`, `pairing.acceptLanRequests:true`; fresh browser context, no cookies | `page.goto("/")`, wait ≤ 30 s | `network-denied-request-access` visible; no "Server offline" / "Disconnected from" text; `headerAppBar` count 0; a page-context `fetch("/api/health")` JSON has `networkAccess.error === "network_not_allowed"` |
| F8 | banner: Request access navigates same context | state-transition | L3 | automated | F7 state | click `network-denied-request-access` | same `page` URL path+search === `/pair?request` (no new page opened: `context.pages().length` unchanged); the pairing landing's Request access button is visible |
| F9 | issue #1082 end to end on a real device | visual/hardware | — | manual-only | issue config (`pair`, `acceptLanRequests:true`, no OAuth) on a LAN host; iOS home-screen WebView (or fresh Chromium profile) never paired | open the dashboard, tap Request access, approve on the host with the code | [judgment: Request access appears instead of Offline; knock → approve → dashboard loads in the same WebView] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | trust: Verdict failure omits the field | fault-injection (abort) | L1 | automated | `readNetworkVerdict` throws `new Error("boom")` | `GET /api/health` (remote caller) | `200`; no `networkAccess`; other health fields present (`ok:true`) |
| X2 | design D2 — dep absent | fault-injection (abort) | L1 | automated | `registerSystemRoutes` deps without `readNetworkVerdict` (hand-built, as `health-compatibility.test.ts`) | `GET /api/health` | `200`; no `networkAccess` |
| X3 | trust: Refused caller polling health has no side effects | fault-injection (observe) | L1 | automated | `setNetworkDenialObserver(spy)`; block-event store empty; E1 caller | 20 × `GET /api/health` | observer spy called 0 times; block-event store still empty; (control) 1 × `GET /api/paired-devices` → observer called once, one block event |
| X4 | trust: Trusted legacy caller polling health is not counted | fault-injection (observe) | L1 | automated | `legacy`, `trustedNetworks:["192.168.16.0/24"]`, remote `192.168.16.31`, no credential | snapshot network-only telemetry; 20 × `GET /api/health`; snapshot again | `admissions` and `distinctPeers` unchanged; no `[trusted-networks]` / network-only log line emitted (log spy); (control) 1 guarded request increments `admissions` by 1 |
| X5 | design Risks — TTL staleness bound | fault-injection (delay) | L1 | automated | E1 caller on `pair`; write `config.json` switching to `legacy` with `trustedNetworks:["192.168.16.0/24"]` at t=0 (fake timers) | `GET /api/health` at t=0.2 s and t=1.2 s | t=0.2 s MAY still carry the field; t=1.2 s carries no `networkAccess` |
| X6 | banner: Transport outage still shows offline | fault-injection (abort) | L1 | automated | fetch rejects `TypeError("Failed to fetch")` | hook effect | `null` (offline banner path; existing test kept green) |
| X7 | banner: expired presented bearer | fault-injection (abort) | L1 | automated | fetch → `401 { error:"bearer_expired" }` | hook effect | `null`, no throw |

---

## Coverage summary

- Requirements covered: 9/9 (trust ×5 delta requirements incl. renamed exception; banner ×2 modified; design D2/D4/D6/D8 invariants; Risks budget)
- Scenarios by class: edge 13 · perf 3 · frontend 9 · error 7
- Scenarios by level: L1 29 · L2 0 · L3 2
- Scenarios by disposition: automated 31 · manual-only 1

## New infra needed

- `docker/test-entrypoint.sh`: opt-in `PI_E2E_TRUST_MODE=pair` seed — merges `network: { trustMode:"pair", trustModeOrigin:"operator" }` and `pairing: { acceptLanRequests:true }` into `config.json` before boot (mirror the `PI_E2E_OAUTH` block style).
- `docker/test-up.sh`: export `PI_E2E_TRUST_MODE` passthrough (empty-string guard per harness pitfalls).
- `tests/e2e/global-setup.ts`: forward `PI_E2E_TRUST_MODE`; verify setup performs no guarded API call that a `pair`-refused Playwright host would fail (health is public).
- `.github/workflows/ci-e2e-browser.yml`: new variant job (pattern: browser-relay job) running only the new spec with `PI_E2E_SEED=1`, `PI_E2E_OAUTH=0`, `PI_E2E_TRUST_MODE=pair`.
- New spec `tests/e2e/pair-mode-request-access.spec.ts` (F7, F8): imports `{ expect, test }` from `./fixtures.js` (mandatory — `scripts/check-e2e-fixture-import.mjs` fails a direct `@playwright/test` value import; playwright-e2e-qa "A spec SHALL release every session it spawns"). The auto reap fixture's credential-free pre-snapshot / trust read will be refused on this harness: verify the refusal latch stays un-armed when the boot baseline never admitted the client (`tests/e2e/fixtures.ts` header, latch D2) and that a refused pre-snapshot only disables the reap (`preOk:false`); if either fails the test, add a harness-mode exemption in `tests/e2e/reap-core.ts` with an L1 test in `tests/e2e/helpers/__tests__/`. Runs on its own CI leg per ci-cd-pipeline "Variant-harness spec runs on its own leg"; `test.skip` unless `process.env.PI_E2E_TRUST_MODE === "pair"` (never key the skip off the health field — a regression would turn into a green skip).
