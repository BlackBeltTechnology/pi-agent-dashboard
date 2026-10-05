# Test Plan — harden-trust-and-credential-boundaries

Stage: design   Generated: 2026-07-16

Gap resolved before writing (hard gate): `pi-dashboard open` prints the
one-time URL to stdout and opens the browser; `--print` prints only; server
down → exit 1 + "server not running".

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | B5 returnUrl constrained | decision-table | L1 | automated | `return` ∈ {`https://evil.example/x`, `//evil.example`, `/\evil.example`, `%252F%252Fevil.example`, `javascript:alert(1)`, `/sessions?x=1`, `/`} | `GET /auth/login?return=<v>` (single provider) | authorize-redirect `state` decodes to `returnUrl` = `/` for the first five, `/sessions?x=1` and `/` for the last two; never 5xx |
| E2 | B5 state cookie attributes | EP | L1 | automated | single provider, redirect base `http://…` then `https://…` | `GET /auth/login` | `Set-Cookie: pi_dash_oauth_state` has `HttpOnly`, `SameSite=Lax`, `Path=/auth/`, `Max-Age=600`; `Secure` present only for the `https` base |
| E3 | B5 key domain separation | EP | L1 | automated | known `auth.secret` | `GET /auth/login` | cookie MAC equals `HMAC(HMAC(secret,"pi-dashboard/oauth-state/v1"), nonce)` and differs from `HMAC(secret, nonce)` |
| E4 | B5 picker propagates return | EP | L1 | automated | two providers, `return=/sessions` | `GET /auth/login?return=/sessions` | each picker link href ends `?return=%2Fsessions`; with `return=//evil.example` links carry `?return=%2F` |
| E5 | B14 strict decision table | decision-table | L1 | automated | {strict off/on} × {bare loopback, proof cookie, `X-Pi-Local-Token`, forged cookie, expired cookie, cookie signed with old local token} | `POST /api/restart` from `127.0.0.1`, no forwarding header | off+bare → admitted; on+bare → 403 `local_proof_required` with `pi-dashboard open` hint; on+cookie / on+token → admitted; on+forged/expired/old-key → 403 |
| E6 | B14 observe exception | BVA | L1 | automated | strict on, bare loopback | `GET /api/sessions` (observe), `POST /api/restart` (operate), unmatched `GET /api/nope` | 200, 403, 403 respectively |
| E7 | B14 WS scopes under strict | decision-table | L1 | automated | strict {off,on} × proof {none, cookie} | upgrade `/ws`, `/ws/terminal/x`, `/live/x` from `127.0.0.1` | off → accepted all; on+none → rejected all; on+cookie → accepted all |
| E8 | B14 plugin-scope WS | EP | L1 | automated | strict on, loopback IP + loopback Host + no forwarding header, no proof | plugin-scope WS upgrade (`isPluginScopePeerLocal` path, `server.ts:3486`) | rejected; with proof cookie accepted; strict off accepted |
| E9 | B14 loopback trusted entry | decision-table | L1 | automated | `trustedNetworks: ["127.0.0.1"]`, bare loopback | `POST /api/restart` with strict off, then on | off → admitted; on → 403 |
| E10 | B14 tier exemption | decision-table | L1 | automated | loopback request bearing an `observe` device token | `POST /api/restart` and `POST /api/session/:id/lifecycle {action:"force_kill"}` | strict off → not tier-refused; strict on without proof → 403 `insufficient_scope`; strict on + proof → not refused |
| E11 | B14 bridge-ticket mint | decision-table | L1 | automated | loopback caller, no device bearer | `decideBridgeTicketMint` with strict {off,on} × local token {absent,valid} | off → allow; on+absent → deny; on+valid → allow |
| E12 | B14 pairing operator routes | decision-table | L1 | automated | bare loopback, no session | `GET /api/pair/pending`, `POST /api/pair/deny`, `POST /api/paired-devices`, `DELETE /api/paired-devices/:id` with strict off, then on | off → admitted (2xx); on → 401 |
| E13 | B14 posture disclosure unchanged | EP | L1 | automated | strict on, bare loopback | `GET /api/health` | `accessGrants`/`trustPosture` present (disclosure keeps bare `isGenuinelyLocal`) |
| E14 | B14 /v1 unchanged | EP | L1 | automated | strict on, bare loopback | `/v1/*` model-proxy request | admission identical to strict off (no `local_proof_required`) |
| E15 | B14 local-proof code TTL | BVA | L1 | automated | code minted at t0 (fake timers) | redeem `GET /auth/local-proof?code=` at t0+59 s and (fresh code) t0+61 s | 59 s → 302 `/` + `Set-Cookie: pi_dash_local` (`HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age=2592000`); 61 s → no `pi_dash_local` cookie |
| E16 | B14 config field | EP | L1 | automated | config `requireLocalProof` ∈ {absent, `true`, `false`, `"yes"`} | `loadConfig()` | `false`, `true`, `false`, `false` |
| E17 | B14 live toggle | state-transition | L1 | automated | running app, strict off | flip `requireLocalProof` to `true` via config write, no restart | next bare-loopback `POST /api/restart` → 403 |
| E18 | B14 single predicate | static-scan | L1 | automated | `packages/server/src/**` non-test source | scan for `isGenuinelyLocal(` callers | only `localhost-guard.ts` (`isLocallyTrusted`, `canDiscloseAccessPosture`) calls it directly |
| E19 | D6 approval matrix | decision-table | L1 | automated | pending device + correct confirm code; credential ∈ {bare loopback, login session, proof cookie (auth off), `X-Pi-Local-Token`, device bearer from loopback} | `POST /api/pair/approve` and `POST /api/pair/approve-pending` | bare loopback → 401 + device stays pending; session/cookie/token → approved; device bearer → 401 |
| E20 | D6 host admission kept | EP | L1 | automated | valid local token, `Host: evil.example` | `POST /api/pair/approve` | 403 `host_not_admitted` |
| E21 | B15 reserved prefixes | BVA | L1 | automated | trusted plugin; `eventType` ∈ {`roles:set`, `role:resolve-model`, `model:resolve`, `prompt:register-adapter`, `dashboard:enqueue-followup`, `ui:invalidate`, `roles`, `rolesx:set`, `flow:run`} | `emitEventToSession("s1", t, {})` | first six → `false`, no `sendToSession` call, one warn; last three → `sendToSession` called, `true` |
| E22 | B15 raw lane | EP | L1 | automated | trusted plugin | `sendExtensionMessage("s1", {type:"plugin_emit_event", eventType:"roles:set"})` and `{type:"mcp_token_minted", …}` | first → `false`, nothing sent; second → sent, `true` |
| E23 | B15 registry emits | BVA | L1 | automated | contributions: `buildEvent` + no `emits`; `emits: []`; `emits: ["flow:run"]`; `buildPrompt` only | `register()` | `false`, `false`, `true`, `true`; rejected ids absent from `/actions` |
| E24 | B15 engine refusal | decision-table | L1 | automated | action `emits:["flow:run"]` whose `buildEvent` returns `flow:run` / `flow:other` / `roles:set`; action `emits:["roles:set"]` returning `roles:set` | run dispatch | `flow:run` → `{kind:"event"}`; others → `{kind:"refused", reason}` |
| E25 | B15 flows declaration | EP | L1 | automated | flows contribution | inspect `flows.run` | `emits` equals `["flow:run"]`; `buildEvent({flow:"test:x",task:"go"})` returns `flow:run` with `completion.eventType: "flow_complete"` |
| E26 | B15 listener coverage | static-scan | L1 | automated | `packages/extension/src/**` non-test source | collect literal `events.on("<name>"` names plus `forwardedBusChannels()` output (`flow-event-wiring.ts:147` dynamic subscriptions) | every name is under a reserved prefix or in the reviewed benign list (`flow:rediscover`, `flow:complete`, `flow:get-available-models`, forwarded channels); an unlisted name fails |
| E27 | B25 secure write | EP | L1 | automated | `process.umask(0o022)` | `writeConfigFileSecure(tmpDir/config.json, "{}")` | `stat.mode & 0o777 === 0o600`; no `*.tmp.*` left behind |
| E28 | B25 every write path | EP | L1 | automated | temp HOME config | each path: defaults bootstrap, `PUT /api/config` (2 sites), plugin config route, plugin activation route, auth secret persist, zrok reserve, server plugin-config write | resulting `config.json` mode `0600` after each |
| E29 | B25 load tightening | BVA | L1 | automated | `config.json` mode `0644`, `0640`, `0600` | `loadConfig()` | `0600`, `0600`, unchanged with no `chmodSync` call |
| E30 | B25 static writers | static-scan | L1 | automated | non-test source referencing `CONFIG_FILE`/`getConfigFile`/`config.json` | scan for raw `writeFileSync`/`renameSync` | none outside `writeConfigFileSecure` + reviewed allowlist |
| E31 | B4 exchange route | decision-table | L1 | automated | device bearer tier ∈ {observe, operate}; no bearer | `POST /api/device-session` | with bearer → 200 + `Set-Cookie: pi_dash_device` `HttpOnly; SameSite=Strict; Path=/api/; Max-Age=34560000`; no bearer → 401 |
| E32 | B4 cookie admission | decision-table | L1 | automated | `pi_dash_device` cookie only, from a non-local IP, tier `observe` | `GET /api/sessions`, `POST /api/restart` | 200 with `authVia="device"`; 403 `insufficient_scope` |
| E33 | B4 cookie path scope | EP | L1 | automated | valid `pi_dash_device` cookie only | request to `/mcp` and a `/ws` upgrade | cookie not used: not authenticated by it |
| E34 | B4 header precedence | EP | L1 | automated | `Authorization: Bearer <A>` + cookie of device B | `GET /api/sessions` | principal is device A |
| E35 | B4 logout of cookie | EP | L1 | automated | cookie set | `DELETE /api/device-session` | `Set-Cookie: pi_dash_device=; Max-Age=0; Path=/api/` |
| E36 | B4 cross-origin unchanged | EP | L1 | automated | `getApiBase()` = `https://other.example`, bearer stored | pairing finish + startup | no `POST /api/device-session`; bearer stays in `localStorage`; `mintWsTicket` sends `Authorization: Bearer` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | B4 pairing exchange ordering | state-transition | L1 | automated | `PairLanding` finishing with token `T` | `finishPaired(T)` with exchange resolving after 50 ms | `window.location.href` assigned only after the exchange resolves; `localStorage` has `pi-dashboard:device-paired` and no `pi-dashboard:device-bearer` |
| F2 | B4 legacy migration | state-transition | L1 | automated | `localStorage` has legacy `pi-dashboard:device-bearer` | app startup with exchange → 200 / 401 / network error | 200 → key removed, marker set; 401 → key removed, no marker; network error → key kept |
| F3 | B4 WS ticket via cookie | state-transition | L1 | automated | marker set, no bearer, no identity token | `useWebSocket` connect | `POST /api/ws-ticket` sent with `credentials:"same-origin"` and no `Authorization`; socket URL carries the ticket |
| F4 | B4 identity-plane ticketing kept | EP | L1 | automated | identity access token, no marker | `useWebSocket` connect | ticket minted with `Authorization: Bearer <access>` (regression) |
| F5 | B4 stale marker | state-transition | L1 | automated | marker set, cookie revoked | ticket mint returns 401 | marker removed from `localStorage` |
| F6 | B4 approval host skip | EP | L1 | automated | marker set, no bearer | `PairingApprovalHost` mounts | no `GET /api/pair/pending` request |
| F7 | D6 approval hint | EP | L1 | automated | approve call returns 401 | operator clicks Approve in `PairingApprovalDialog` | dialog shows text containing `pi-dashboard open` |
| F8 | B4 paired browser end-to-end | state-transition | L3 | automated | docker harness, fresh browser context | run pairing redeem→confirm→approve (operator via local token) then reload `/` | `localStorage` lacks `pi-dashboard:device-bearer`; `GET /api/sessions` from the page succeeds; the session list renders over a ticketed `/ws` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | B5 mismatched state | fault-injection (forged) | L1 | automated | state cookie nonce ≠ `state` nonce | `GET /auth/callback/github?code=c&state=s` | 302 `/auth/login?error=Invalid+login+state`; `exchangeCode` not called; no `pi_dash_token` cookie; state cookie cleared |
| X2 | B5 missing state cookie | fault-injection (abort) | L1 | automated | no state cookie | callback with valid-looking `state` | same as X1 |
| X3 | B5 tampered MAC | fault-injection (forged) | L1 | automated | cookie nonce matches but MAC altered | callback | same as X1 |
| X4 | B5 happy path | EP | L1 | automated | matching cookie, `state.returnUrl=/sessions` | callback with exchange + userinfo mocked OK | 302 `/sessions`; `pi_dash_token` set; state cookie cleared |
| X5 | B14 mint without token | fault-injection (unauth) | L1 | automated | no / wrong `X-Pi-Local-Token` | `POST /api/local-proof` | 401; no code issued |
| X6 | B14 code reuse | fault-injection (replay) | L1 | automated | code already redeemed | second `GET /auth/local-proof?code=` | no `pi_dash_local` cookie set |
| X7 | B14 bootstrap without OAuth / strict off | EP | L1 | automated | no providers, `requireLocalProof` false | mint with token, redeem | cookie set (routes registered regardless) |
| X8 | D0 cookie parsing without providers | EP | L1 | automated | no providers configured, valid `pi_dash_device` cookie | `GET /api/sessions` from non-local IP | admitted as device (cookie parsed); without cookie → unchanged 401/403 |
| X9 | B25 chmod failure at load | fault-injection (abort) | L1 | automated | `chmodSync` throws `EPERM`; config has `port: 9123` | `loadConfig()` | returns `port: 9123` (not defaults); one warn logged |
| X10 | B25 Windows | fault-injection (platform) | L1 | automated | `process.platform = "win32"`, chmod throws | `writeConfigFileSecure` and `loadConfig()` | no throw; file written; config parsed |
| X11 | B25 concurrent writes | fault-injection (race) | L1 | automated | two `writeConfigFileSecure` calls in parallel, same pid | `Promise.all` | both resolve; final file is valid JSON from one writer; no tmp leftovers |
| X12 | B15 refused run | fault-injection (refusal) | L1 | automated | dispatch resolves `{kind:"refused"}` | run-session registers | run ends `failed` with reason; `emitEventToSession` not called; run not marked delivered |
| X13 | B4 revoked cookie | fault-injection (revoke) | L1 | automated | device revoked in `PairedDeviceRegistry` | request with its `pi_dash_device` cookie, non-local IP | 401 |
| X14 | B15 bridge relay unchanged | EP | L1 | automated | `plugin_emit_event` with `eventType:"custom:x"` | bridge receives message | `pi.events.emit("custom:x", data)` called (generic relay preserved) |
| X15 | CLI `open` | EP + fault-injection (abort) | L2 | automated | server up / server stopped | `pi-dashboard open --print` | up → stdout matches `/auth/local-proof?code=[A-Za-z0-9_-]{43}`, exit 0; down → exit 1, output contains `server not running` |
| X16 | Electron bootstrap URL | EP | L1 | automated | mocked server `POST /api/local-proof` → code `C` | Electron main creates window | `mainWindow.loadURL` called with `http://localhost:<port>/auth/local-proof?code=C` |
| M1 | B14 strict-mode desktop UX | exploratory | — | manual-only | real Electron install, `requireLocalProof: true` | launch app; open terminal tab; approve a phone pairing | [judgment: no login prompt, terminal and approval work, no visible friction vs strict off] |
| M2 | Docs accuracy | review | — | manual-only | `requireLocalProof` docs + tunnel guidance | read rendered docs | [judgment: operator understands zrok-safe vs `ssh -R` and how to enable strict] |

---

## Coverage summary

- Requirements covered: 11/11 (B5 login + callback, D0, B14 strict + bootstrap, D6 approval, B15 seam + registry + flows, B25, B4 server + client)
- Scenarios by class: edge 36 · perf 0 · frontend 8 · error 18
- Scenarios by level: L1 58 · L2 1 · L3 1 · manual 2
- Scenarios by disposition: automated 60 · manual-only 2

## New infra needed

- none — `emitEventToSession`/`sendExtensionMessage` are inline in `server.ts`; the L1 rows E21/E22 need them extracted into a testable helper (implementation task, no new harness).
