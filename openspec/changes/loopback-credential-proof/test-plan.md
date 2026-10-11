# Test Plan — loopback-credential-proof

Stage: design   Generated: 2026-10-14

Hard gate: one clarification was resolved before this file was written. The
deprecation-log limiter is at most 1 line per caller kind per 60 s, with a
suppressed-count on the next emitted line; it is folded into the spec and
design D4. No open markers.

Constants under test (design D1/D3/D8): window ±30 s; replay TTL 61 s; cache
cap 10 000; floor = `boundAt` with zero tolerance; quarantine 5 s → 30 s →
doubling → cap 300 s; report slot 20; identity log rotation at 256 KiB; header
grammar `v1.<13 digits>.<22 b64url>.<43 b64url>`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | proofs bounded (pi-gateway-auth "Unbounded proof input") | BVA | L1 | automated | `X-Pi-Local-Proof` with ts of 12/13/14 digits; nonce of 21/22/23 chars; nonce containing `+`; mac of 42/43/44 chars; `v2.` prefix | `verifier.stamp(req)` | only the 13/22/43 `v1.` forms parse. Every other form gives verdict `invalid/malformed`, and an HMAC spy records 0 calls |
| E2 | freshness window 30 s | BVA | L1 | automated | injected `now`=T; proofs with ts T−30000, T−30001, T+30000, T+30001 (valid MAC, `boundAt` ≤ T−60000) | stamp | T−30000 and T+30000 give `proof`; T−30001 and T+30001 give `invalid/stale` |
| E3 | before-start floor | BVA + state-transition | L1 | automated | `boundAt`=B; proofs with ts B and B−1; a proof accepted by verifier #1, then re-presented to a NEW verifier (empty cache) whose listener has `boundAt` later than the proof's ts | stamp | ts=B gives `proof`; ts=B−1 gives `invalid/before-start`; the re-presented proof gives `invalid/before-start` (not `proof`) |
| E4 | binding = arriving socket | EP | L1 | automated | proof bound to `127.0.0.1:P`; req `localAddress` ∈ {`127.0.0.1`, `::ffff:127.0.0.1`, `::1`, `127.0.0.2`}, `localPort` ∈ {P, P+1}; also `canonicalBinding("localhost",P)` | stamp / `canonicalBinding` | `127.0.0.1` and `::ffff:127.0.0.1` with port P give `proof`; every other address or port gives `binding-mismatch`; the host name throws/rejects |
| E5 | replay rejected | state-transition | L1 | automated | one valid proof | presented twice at T and T+1 s; again at T+61 s | 2nd gives `invalid/replayed`; the T+61 s presentation gives `invalid/stale` (never `proof`) |
| E6 | replay insert after MAC | state-transition | L1 | automated | nonce N with bad MAC, then the same N with a valid MAC | stamp ×2 | 1st gives `bad-mac`; 2nd gives `proof` |
| E7 | cache overflow fails closed | BVA | L1 | automated | `maxNonces`=10 000; fill with 10 000 unexpired proofs | 10 001st valid proof; then advance the clock 61 s and retry with a fresh proof | 10 001st gives `invalid/replay-cache-full`, cache size stays 10 000 (none evicted); after expiry the fresh proof gives `proof` |
| E8 | one verdict per request | invariant | L1 | automated | one request with a valid proof | `hasLocalCredential` read 3× (hook, guard, route) | all 3 true; replay cache holds exactly 1 entry |
| E9 | multi-valued headers | EP | L1 | automated | `X-Pi-Local-Proof: [garbage, valid]` and `[valid, garbage]`; same for `X-Pi-Local-Token` | stamp | `[garbage, valid]` is not credentialed; `[valid, garbage]` is credentialed |
| E10 | proof judged alone | decision table | L1 | automated | invalid proof + matching raw token | stamp | verdict `invalid` (not `legacy`); `hasLocalCredential` false |
| E11 | legacy log limiter | BVA | L1 | automated | fake clock; 5 bridge-kind legacy admissions in 0–59 s, 1 at 60 s; 1 http-kind admission at 10 s | admit | 2 bridge lines total; the 2nd carries `suppressed=4`; 1 http line at 10 s (kinds independent) |
| E12 | HTTP purpose binds method+target | EP | L1 | automated | real Fastify on `127.0.0.1:0`; proof minted for `GET /api/x?a=1&b=%20c` | send it as GET to that target; as POST to the same; as GET to `/api/x?a=1` | 1st exempt (200); 2nd and 3rd not exempt, and the response body is byte-identical to the no-credential response |
| E13 | stamp propagation and non-leak | invariant | L1 | automated | stamped request; a later `onRequest` hook; a route; `request.headers = {...}` forcing the `additionalHeaders` copy; a client header literally named `Symbol(local-credential)` | read stamp; `JSON.stringify(request.headers)`; `Object.entries` | stamp visible in hook, route and copy; absent from JSON and entries; the forged header name grants nothing |
| E14 | every exemption site honours the verdict | decision table | L1 | automated | for each site (request hook, `validateWsUpgrade`, `authorizeWsUpgrade`, network guard, `hasLocalProof`, pairing operator/approval, passkey genuine-local, `POST /api/local-proof`, `POST /api/identity/local-code`, identity break-glass) × verdict {proof, legacy, absent, invalid} | request | admitted for proof/legacy; not admitted for absent/invalid. Refusal bodies for invalid and absent are byte-identical. The network guard records no denial block-event on admission |
| E15 | gateway decision table | decision table | L1 | automated | {unix, Origin present, valid ticket, valid, legacy, absent, invalid} × {grace listener, no-grace fallback} | `decideBridgeUpgrade` | unix allows. Origin refuses `browser-origin`. Ticket allows. valid allows (not deprecated). legacy allows `deprecated`. absent/invalid: grace allows `deprecated`; no-grace refuses `local-proof-invalid` (invalid) or `local-token-missing` (absent). No raw-header read |
| E16 | counter-proof emitted only for proof admissions | decision table | L1 | automated | real gateway serving TCP (started first) + unix socket; upgrades admitted by {proof, ticket, legacy, grace}, a unix upgrade carrying a proof, a refused upgrade | upgrade | `X-Pi-Local-Proof-Server` present ONLY on the proof admission and verifies against that dial's nonce/mac/binding. Unix: absent and never stamped. Refused: no 101 |
| E17 | marker comparison | EP + BVA | L1 | automated | marker `ws://127.0.0.1:9999`; dials `ws://127.0.0.1:9999/`, `WS://127.0.0.1:9999`, `ws://127.0.0.1:9999/x`, `ws://127.0.0.1:9998`, `ws://[::1]:9999`; marker `""`; marker `not a url`; dials `ws+unix:/x`, `wss://remote.example` | `localCredentialPlan` | first three enforce; :9998 and `[::1]` do not; empty means unmarked; `not a url` enforces on every loopback TCP dial; unix/remote produce no plan and no pre-connect |
| E18 | name dial bound to the address reached | EP | L1 | automated | injected connector resolving `localhost` to `::1` (then `127.0.0.1`) | `planDial("ws://localhost:P")` | binding `[::1]:P` (then `127.0.0.1:P`); the socket given to `ws` via `createConnection` is the same object; no `X-Pi-Local-Token` |
| E19 | spawn env decision table | decision table | L1 | automated | mechanism {headless, tmux, wt, wsl-tmux} × bindHost {`127.0.0.1`, `0.0.0.0`, `::1`, `192.168.1.5`} × piPort {set, null} × inherited marker {none, `ws://127.0.0.1:1`} | build spawn env / tmux argv | loopback + own-OS: URL = `localDialHost` literal and marker = URL. tmux: `-e` marker (empty when unmarked). wsl-tmux: no marker, empty `-e`. Non-loopback: no marker. Null piPort: inherited marker removed, URL untouched. wt: marker in the env passed to `wt.exe` |
| E20 | `localDialHost` / `isLoopbackLiteral` | EP | L1 | automated | `0.0.0.0`, `::`, `localhost`, `::1`, `127.0.0.5`, `192.168.1.5` | map | `127.0.0.1`, `127.0.0.1`, `127.0.0.1`, `[::1]`, `127.0.0.5`, `192.168.1.5`; loopback true for the first five |
| E21 | one mint everywhere | invariant | L1 | automated | fixed vector (token, ts, nonce, binding, purpose) | shared `mintProof`; the inline mint copied from `scripts/reload-all.sh` | identical header string from both |
| E22 | clients never send the raw token; fresh proof per request | invariant | L1 | automated | captured outgoing requests of the bridge plan, CLI (`token create`, `login --local`, `open`, `restart`, two consecutive service verbs), Electron main (`server-lifecycle` ×2, `runtime-overlay-main`) | invoke | every request has `X-Pi-Local-Proof` and no `X-Pi-Local-Token`; no two requests share a nonce; each dial host comes from `localDialHost(config.host)` |

### Frontend-quirk (connection state machine)

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | quarantine schedule | state-transition | L1 | automated | fake `WebSocketImpl` emitting `upgrade` without a counter-proof; fake timers | 7 consecutive marked dials | dial delays 5, 30, 60, 120, 240, 300, 300 s. A verified open then resets: the next transient drop uses the normal backoff, not quarantine |
| F2 | no frame before verification | state-transition | L1 | automated | `session_register` + 3 `event_forward` buffered | verify fails, then a later dial verifies | fake socket write log: 0 frames on the failed dial; on the verified dial all 4, in order |
| F3 | nothing dispatched from an unverified peer | state-transition | L1 | automated | real `ws` server that writes a text frame immediately after its 101 (no counter-proof) | marked dial | `onMessage` never called; `onopen` never fired; socket terminated |
| F4 | report slot follows the endpoint, not the connection | state-transition | L1 | automated | 25 identity failures, then a re-target to another endpoint that opens, then a verified open at the marked endpoint | open events | slot holds the 20 newest. 0 `bridge_diagnostic` sent on the other endpoint. 20 sent on the verified open; slot then empty; `transportDiagnostics` received none |
| F5 | pre-connect failure is transient | state-transition | L1 | automated | connector rejects with `ECONNREFUSED` | marked dial | next attempt uses the normal backoff (not quarantine); no identity log line |
| F6 | per-dial headers | state-transition | L1 | automated | 3 attempts: first, reconnect, re-target | `planDial` | invoked 3×; 3 distinct nonces; the re-target plan is derived for the new base URL |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | relay earns nothing | fault-injection (MITM) | L1 | automated | genuine gateway at `127.0.0.1:A`; TCP relay on `127.0.0.1:B` piping to A; bridge marked for B | marked bridge dials B | gateway log `binding-mismatch`; grace listener admits without a counter-proof, so the bridge terminates in `upgrade` and the gateway receives 0 `session_register`; with a no-grace (fallback) gateway the relay receives 401 |
| X2 | squatter detected and logged off-channel | fault-injection (abort) | L1 | automated | plain `ws` server at the marked endpoint answering 101 with no header | marked dial | bridge aborts; `bridge-identity.log` gains `{ts,pid,endpoint,cause:"server-proof-missing"}`; file mode `0600` |
| X3 | forged counter-proof | fault-injection (corrupt) | L1 | automated | squatter returns `X-Pi-Local-Proof-Server: v1.<random 43>` | marked dial | abort with cause `server-proof-invalid` |
| X4 | old bridge keeps working | compat | L1 | automated | pre-change client sending raw `X-Pi-Local-Token` | dial a new gateway (grace and fallback) | admitted on both; deprecation line per E11 |
| X5 | new bridge vs pre-proof server | compat | L1 | automated | `ws` server that ignores proof headers: (a) grace-like accept, (b) 401 | unmarked dial; marked dial | (a) unmarked opens and registers, marked aborts and quarantines; (b) both get a transient retry, no identity log line |
| X6 | identity log writer faults | fault-injection | L1 | automated | `local/` dir read-only; log at 256 KiB | failure written | unwritable: no throw and quarantine proceeds; at 256 KiB: rotated to `.1`, new file `0600` |
| X7 | POSIX squatter, end to end | fault-injection (process) | L2 | automated | dashboard with a forced loopback fallback (as `23-gateway-socket-fallback.sh`) and a spawned headless session; dashboard stopped; a node logger bound on `127.0.0.1:<piPort>` | session reconnects to the logger; then the logger stops and the dashboard restarts | logger log shows `X-Pi-Local-Proof`, no `X-Pi-Local-Token`, no `session_register` frame; `bridge-identity.log` has a `server-proof-missing` line; the session re-registers within 300 s and the server log shows its `bridge_diagnostic` |
| X8 | CLI end to end | integration | L2 | automated | running dashboard (as `39-cli-open.sh`) | `pi-dashboard open --print`, `login --local`, `token create`, `restart`, `service status` | all exit 0; server.log has no `x-pi-local-token` deprecation line from them |
| X9 | NAT'd caller not admitted by proof | fault-injection (network) | L3 | automated | docker harness (published port, `.pi-test-harness.json` port); proof minted from the host for the published address | request a credential-gated route (`POST /api/identity/local-code`) from the host through the published port | not admitted (401); container server.log shows `binding-mismatch`; the same request made inside the container succeeds |
| X10 | Windows: another user cannot co-bind | fault-injection (OS) | L2 | automated | Windows VM, dashboard holding `127.0.0.1:<piPort>` (as `28-gateway-windows.ps1`) | second standard user attempts to bind `127.0.0.1:<piPort>` | the bind fails (EADDRINUSE/EACCES) and is recorded from an actual attempt |
| X11 | live deploy order on a dev instance | runbook | — | manual-only | local dev instance with spawned sessions | restart the server first, then `npm run reload` | [judgment: operator confirms sessions stay registered and no quarantine lines appear — a runbook check against a personal instance, not reproducible in CI] |

---

## Coverage summary

- Requirements covered: 16/16 delta requirements (pi-gateway-auth 9, local-ipc-allowlist-token 2, including MODIFIED blocks; the unchanged POSIX socket/Windows ACL scenarios stay covered by the existing `28-gateway-windows.ps1` and socket tests)
- Scenarios by class: edge 22 · perf 0 · frontend 6 · error 11
- Scenarios by level: L1 33 · L2 3 · L3 1 · manual 1
- Scenarios by disposition: automated 38 · manual-only 1

Perf: no latency/throughput SHALL in the spec. Bounded cost is covered by E1
(no HMAC on malformed input) and E7 (fixed cap).

## New infra needed

- none (L1 vitest, `qa/tests/*.sh|*.ps1`, the docker e2e harness all exist).
