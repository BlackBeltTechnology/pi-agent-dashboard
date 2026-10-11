## 1. Shared proof primitive (D1)

- [x] 1.1 Test (test-plan #E1), L1 in `packages/shared/src/__tests__/local-credential-proof.test.ts`; exemplar `packages/shared/src/__tests__/dashboard-paths.test.ts`.
  - Input: ts of 12/13/14 digits, nonce of 21/22/23 chars, a nonce containing `+`, mac of 42/43/44 chars, a `v2.` prefix.
  - Trigger: `parseProof` (and later `verifier.stamp`).
  - Observable: only the 13/22/43 `v1.` form parses; every other form is `malformed`, and an HMAC spy records 0 calls.
- [x] 1.2 Test (test-plan #E20), same file.
  - Input: `0.0.0.0`, `::`, `localhost`, `::1`, `127.0.0.5`, `192.168.1.5`.
  - Trigger: `localDialHost` / `isLoopbackLiteral`.
  - Observable: `127.0.0.1`, `127.0.0.1`, `127.0.0.1`, `[::1]`, `127.0.0.5`, `192.168.1.5`; loopback true for the first five.
- [x] 1.3 Test (test-plan #E21), same file plus `scripts/__tests__/reload-all-mint.test.mjs`; exemplar `scripts/__tests__/assert-bundled-plugins-complete.test.mjs`.
  - Input: a fixed vector (token, ts, nonce, binding, purpose).
  - Trigger: shared `mintProof`, and the inline mint extracted from `scripts/reload-all.sh`.
  - Observable: an identical header string from both. (The script half goes red until 7.5.)
- [x] 1.4 Implement `packages/shared/src/local-credential-proof.ts`: `deriveKey`, `mintProof`, `parseProof`, `canonicalBinding`, `serverCounterProof`, `verifyCounterProof`, `localDialHost`, `isLoopbackLiteral`. Pure, `node:crypto` only, constant-time compares, and a round-trip test for the counter-proof. Verify: `npx vitest run packages/shared/src/__tests__/local-credential-proof.test.ts` is green.

## 2. Server verifier + edge stamp (D3, D4, D9)

All tests in this section are L1 in `packages/server/src/__tests__/local-credential.test.ts`, with an injected `now` and per-listener `boundAt`; exemplar `packages/server/src/__tests__/local-token.test.ts`.

- [x] 2.1 Test (test-plan #E2).
  - Input: `now`=T and proofs with ts T−30000, T−30001, T+30000, T+30001.
  - Trigger: stamp.
  - Observable: ±30000 → `proof`; ±30001 → `stale`.
- [x] 2.2 Test (test-plan #E3).
  - Input: `boundAt`=B with proofs at ts B and B−1; plus a proof accepted by verifier #1, then re-presented to a fresh verifier whose `boundAt` is later than its ts.
  - Trigger: stamp.
  - Observable: B → `proof`; B−1 → `before-start`; the re-presented proof → `before-start`.
- [x] 2.3 Test (test-plan #E4).
  - Input: a proof bound to `127.0.0.1:P`, with `localAddress` ∈ {`127.0.0.1`, `::ffff:127.0.0.1`, `::1`, `127.0.0.2`} and port ∈ {P, P+1}.
  - Trigger: stamp.
  - Observable: only the first two addresses with port P → `proof`; everything else → `binding-mismatch`.
- [x] 2.4 Test (test-plan #E5).
  - Input: one valid proof.
  - Trigger: presented at T, at T+1 s, and at T+61 s.
  - Observable: the 2nd → `replayed`; the T+61 s one → `stale`.
- [x] 2.5 Test (test-plan #E6).
  - Input: nonce N with a bad MAC, then the same N with a valid MAC.
  - Trigger: stamp ×2.
  - Observable: `bad-mac`, then `proof`.
- [x] 2.6 Test (test-plan #E7).
  - Input: a cache filled with 10 000 unexpired proofs.
  - Trigger: the 10 001st proof; then the clock +61 s and a fresh proof.
  - Observable: `replay-cache-full` with size still 10 000; after expiry, `proof`.
- [x] 2.7 Test (test-plan #E8).
  - Input: one request carrying a valid proof.
  - Trigger: `hasLocalCredential` read 3×.
  - Observable: true each time, with exactly 1 cache entry.
- [x] 2.8 Test (test-plan #E9).
  - Input: `[garbage, valid]` and `[valid, garbage]`, for both the proof header and the raw-token header.
  - Trigger: stamp.
  - Observable: only the valid-first form is credentialed.
- [x] 2.9 Test (test-plan #E10).
  - Input: an invalid proof plus a matching raw token.
  - Trigger: stamp.
  - Observable: `invalid`, and `hasLocalCredential` false.
- [x] 2.10 Test (test-plan #E11).
  - Input: a fake clock; 5 bridge-kind legacy admissions in 0–59 s, 1 more at 60 s, and 1 http-kind admission at 10 s.
  - Trigger: admit.
  - Observable: 2 bridge lines, the 2nd with `suppressed=4`; 1 http line.
- [x] 2.11 Implement `createLocalCredentialVerifier` / `stamp` / `hasLocalCredential` in `packages/server/src/auth/local-credential.ts`: the Symbol stamp on the `IncomingMessage` headers object, plus the 60 s per-kind limiter. Verify: 2.1–2.10 green.
- [x] 2.12 Test (test-plan #E13), L1 in `packages/server/src/__tests__/local-credential-fastify.test.ts`; exemplar `packages/server/src/__tests__/auth-plugin.test.ts`.
  - Input: a real Fastify instance with the stamp hook, a later hook, a route, a forced `additionalHeaders` copy, and a client header named `Symbol(local-credential)`.
  - Trigger: read the stamp; `JSON.stringify`; `Object.entries`.
  - Observable: the stamp is visible in the hook, the route and the copy; absent from the JSON and the entries; the forged name grants nothing.
- [x] 2.13 Wire the verifier in `server.ts`, until 2.12 is green and the existing `auth-plugin.test.ts` stays green:
  - `acceptLegacyToken: true` next to `server.ts:1119`;
  - the stamp `onRequest` hook registered before `fastify.register(rateLimit)` (`server.ts:1637`);
  - a stamp at the top of `fastify.server.on("upgrade")` (`server.ts:3667`), before the Host and Origin gates;
  - HTTP `boundAt` taken immediately before `fastify.listen`.

## 3. Every HTTP / main-WS exemption site (D4)

- [x] 3.1 Test (test-plan #E12), L1 in `packages/server/src/__tests__/local-credential-fastify.test.ts`; exemplar `auth-plugin.test.ts`.
  - Input: real Fastify on `127.0.0.1:0` and a proof for `GET /api/x?a=1&b=%20c`.
  - Trigger: send it as that GET; as a POST to the same target; as a GET to `/api/x?a=1`.
  - Observable: 200 for the first; not exempt for the other two, each with a body byte-identical to the no-credential response.
- [x] 3.2 Test (test-plan #E14), L1 spread over the sites' own test files: `auth-plugin.test.ts`, `local-proof-strict.test.ts`, the pairing guard tests, the passkey user-routes tests, the local-proof route tests, the identity local-code / break-glass tests, and the network-guard tests. Exemplar `local-proof-strict.test.ts`.
  - Input: each site × verdict {proof, legacy, absent, invalid}.
  - Trigger: a request (the main-server WS upgrade for the WS sites).
  - Observable:
    - proof and legacy → admitted;
    - absent and invalid → not admitted, with byte-identical bodies;
    - the network guard records no denial block-event on admission;
    - the main-server WS upgrade refuses a replayed proof.
- [x] 3.3 Replace `verifyLocalToken(...)` with `hasLocalCredential(headers)` at `auth-plugin.ts:437,533,628`, `localhost-guard.ts:407`, `local-proof.ts:74`, `pairing-routes.ts:115`, `user-routes.ts:74`, `local-proof-routes.ts:28` and `server.ts:1946,2014`. Verify:
  - 3.1 and 3.2 are green;
  - `rg -n "verifyLocalToken\(" packages/server/src --glob '!**/__tests__/**'` lists only `local-credential.ts`.

## 4. Gateway decision + counter-proof (D2, D5)

- [x] 4.1 Test (test-plan #E15), L1 in `packages/server/src/__tests__/bridge-upgrade-auth.test.ts` (extend; this is the exemplar).
  - Input: {unix, Origin, ticket, valid, legacy, absent, invalid} × {grace, no-grace}.
  - Trigger: `decideBridgeUpgrade`.
  - Observable:
    - unix → allow; Origin → `browser-origin`; ticket → allow;
    - valid → allow; legacy → allow `deprecated`;
    - absent / invalid on grace → allow `deprecated`;
    - on no-grace → `local-token-missing` (absent) or `local-proof-invalid` (invalid);
    - the raw header is never read.
- [x] 4.2 Change `decideBridgeUpgrade` to take the verdict: drop the `verifyLocalToken` callback and derive the cause from the verdict instead of reading `bridge-upgrade-auth.ts:150-152`. Its only side effect stays `consumeTicket`. Verify: 4.1 green.
- [x] 4.3 Test (test-plan #E16), L1 in `packages/server/src/__tests__/bridge-local-token-upgrade.test.ts` (extend; this is the exemplar).
  - Input: a real gateway with TCP started first, plus the unix socket; upgrades admitted by proof, ticket, legacy and grace; a unix upgrade carrying a proof; a refused upgrade.
  - Trigger: upgrade.
  - Observable: `X-Pi-Local-Proof-Server` appears only on the proof admission and verifies; the unix upgrade gets none and is never stamped; the refused upgrade gets no 101.
- [x] 4.4 Test (test-plan #X1), L1 in `bridge-local-token-upgrade.test.ts`.
  - Input: the genuine gateway at `127.0.0.1:A`, a TCP relay at `127.0.0.1:B` piping to A, and a bridge marked for B.
  - Trigger: the marked dial to B.
  - Observable: the gateway logs `binding-mismatch`; the grace admission carries no counter-proof; the bridge terminates in `upgrade`; the gateway receives 0 `session_register`; against a fallback gateway the relay gets 401.
- [x] 4.5 Test (test-plan #X4), L1 in `bridge-local-token-upgrade.test.ts`.
  - Input: a client sending a raw `X-Pi-Local-Token`.
  - Trigger: dial a new gateway, grace and fallback.
  - Observable: admitted on both, with the E11 deprecation line.
- [x] 4.6 Implement in `pi-gateway.ts`, until 4.3–4.5 are green:
  - `verifyClient` stamps `"bridge"` and records a `WeakMap<req,{binding,nonce,mac}>` only for a `valid` admission;
  - `startTcp` attaches `wss.on("headers")` gated on `!unixUpgrades.has(req)`;
  - TCP `boundAt` is taken before listen;
  - sub-causes are logged server-side only.

## 5. Bridge: per-dial plan, verification, quarantine, report slot (D6, D8)

- [x] 5.1 Test (test-plan #F1), L1 in `packages/extension/src/__tests__/connection-dial-plan.test.ts`; exemplar `packages/extension/src/__tests__/connection-migration.test.ts`.
  - Input: a fake `WebSocketImpl` emitting `upgrade` with no counter-proof, under fake timers.
  - Trigger: 7 marked dials, then a verified open, then a transient drop.
  - Observable: delays of 5, 30, 60, 120, 240, 300, 300 s; after the verified open, the drop uses the normal backoff.
- [x] 5.2 Test (test-plan #F2), same file.
  - Input: `session_register` and 3 `event_forward` frames buffered.
  - Trigger: a failed verify, then a verified dial.
  - Observable: 0 frames written on the failed dial; all 4, in order, on the verified one.
- [x] 5.3 Test (test-plan #F3), same file.
  - Input: a real `ws` server that writes a frame right after its 101, without a counter-proof.
  - Trigger: a marked dial.
  - Observable: `onMessage` is never called, `onopen` never fires, and the socket is terminated.
- [x] 5.4 Test (test-plan #F4), same file.
  - Input: 25 identity failures, then a re-target that opens, then a verified open at the marked endpoint.
  - Trigger: the opens.
  - Observable: the slot keeps the newest 20; 0 diagnostics go to the other endpoint; 20 are sent on the verified open and the slot empties; `transportDiagnostics` receives none.
- [x] 5.5 Test (test-plan #F5), same file.
  - Input: the connector rejects with `ECONNREFUSED`.
  - Trigger: a marked dial.
  - Observable: normal backoff, no quarantine, no identity log line.
- [x] 5.6 Test (test-plan #F6), same file.
  - Input: three attempts — the first, a reconnect, and a re-target.
  - Trigger: `planDial`.
  - Observable: called 3×, with 3 distinct nonces, and the re-target plan derived from the new base URL.
- [x] 5.7 Implement in `connection.ts`, until 5.1–5.6 and the existing `connection*.test.ts` are green:
  - `planDial`/`DialPlan` (with `createConnection`), merged with `prepareConnect`;
  - `credentialsFor` returns `{ planDial }`;
  - `'upgrade'` verification with fail-closed when the implementation lacks `on("upgrade")`;
  - quarantine;
  - the single `pendingIdentityReports` slot.
- [x] 5.8 Test (test-plan #E17), L1 in `packages/extension/src/__tests__/local-token-header.test.ts` (rewrite; this is the exemplar).
  - Input: marker `ws://127.0.0.1:9999`, dialled as `/`, upper-case, `/x`, `:9998` and `[::1]`; markers `""` and `not a url`; `ws+unix:` and `wss://remote` dials.
  - Trigger: `localCredentialPlan`.
  - Observable:
    - the first three dial forms enforce; `:9998` and `[::1]` do not;
    - the empty marker means unmarked;
    - `not a url` enforces on every loopback TCP dial;
    - unix and remote dials get no plan and no pre-connect.
- [x] 5.9 Test (test-plan #E18), same file.
  - Input: an injected connector that resolves `localhost` to `::1`, then to `127.0.0.1`.
  - Trigger: `planDial("ws://localhost:P")`.
  - Observable: the binding is `[::1]:P`, then `127.0.0.1:P`; `createConnection` returns that same socket; no `X-Pi-Local-Token`.
- [x] 5.10 Implement `localCredentialPlan` in `local-token-header.ts`, and wire `bridge.ts` (`credentialsFor` and the `/dashboard-connect` connection at `bridge.ts:2088`). Verify: 5.8 and 5.9 green.
- [x] 5.11 Test (test-plan #X2), L1 in `packages/extension/src/__tests__/bridge-identity-log.test.ts`; exemplar `packages/extension/src/__tests__/transport-diagnostics.test.ts`.
  - Input: a plain `ws` server at the marked endpoint that answers 101 with no counter-proof header.
  - Trigger: a marked dial.
  - Observable: abort, and a `{ts,pid,endpoint,cause:"server-proof-missing"}` line in a `0600` log file.
- [x] 5.12 Test (test-plan #X3), same file.
  - Input: `X-Pi-Local-Proof-Server: v1.<random 43>`.
  - Trigger: a marked dial.
  - Observable: abort with `server-proof-invalid`.
- [x] 5.13 Test (test-plan #X5), same file.
  - Input: a proof-ignorant server that either (a) accepts like the grace path, or (b) returns 401.
  - Trigger: an unmarked dial and a marked dial.
  - Observable: (a) the unmarked bridge registers, the marked one aborts and quarantines; (b) both retry transiently with no identity line.
- [x] 5.14 Test (test-plan #X6), same file.
  - Input: a read-only `local/` dir; a log file already at 256 KiB.
  - Trigger: write a failure.
  - Observable: the read-only case does not throw and quarantine continues; the full log rotates to `.1` and the new file is `0600`.
- [x] 5.15 Implement the owner-only `bridge-identity.log` writer and hook it to identity failures. Verify: 5.11–5.14 green.

## 6. Spawn marker + literal URL (D7)

- [x] 6.1 Test (test-plan #E19), L1 in `packages/server/src/__tests__/process-manager-spawn-env.test.ts` (extend; this is the exemplar).
  - Input: mechanism {headless, tmux, wt, wsl-tmux} × bindHost {`127.0.0.1`, `0.0.0.0`, `::1`, `192.168.1.5`} × piPort {set, null} × inherited marker {none, `ws://127.0.0.1:1`}.
  - Trigger: build the spawn env and the tmux argv.
  - Observable:
    - loopback, own-OS mechanisms: URL = `localDialHost` literal, and marker = URL;
    - tmux: `-e` carries the marker, or an empty value;
    - wsl-tmux: no marker and an empty `-e`;
    - non-loopback bind: no marker;
    - null piPort: the inherited marker is removed and the URL is untouched;
    - wt: the marker is in the env passed to `wt.exe`.
- [x] 6.2 Implement: `server.ts` passes `config.host` through the existing piPort spawn setter, and `process-manager.ts` builds the URL, the marker and the `{url, socket, marker}` pin. Verify: 6.1 and the existing process-manager suites are green.

## 7. HTTP callers stop sending the raw token (D10)

- [x] 7.1 Test (test-plan #E22), L1 across `packages/server/src/__tests__/cli-open.test.ts`, `cli-login.test.ts`, `cli-restart.test.ts`, `cli-service.test.ts`, the token-create test, `packages/electron/src/lib/__tests__/local-proof-bootstrap.test.ts`, and the bridge plan test. Exemplar `cli-open.test.ts`.
  - Input: captured outgoing requests of the bridge plan; the CLI (`token create`, `login --local`, `open`, `restart`, and two consecutive service verbs); and Electron main (`server-lifecycle` ×2, `runtime-overlay-main`).
  - Trigger: invoke each.
  - Observable: every request carries `X-Pi-Local-Proof` and no `X-Pi-Local-Token`; nonces are unique; the dial host is `localDialHost(config.host)`.
- [x] 7.2 CLI: replace `localTokenHeader()` (`cli.ts:780`) with `localCredentialHeaders(method, target)` (target = WHATWG `pathname+search`). Wire it into `cmdTokenCreate`, `cmdLogin`, `cmdOpen`, `restart` (`:597`) and the service verbs (`:1014`, with `services/cli-service.ts` `authHeaders(method, target)`). Verify: the CLI part of 7.1 is green.
- [x] 7.3 Electron: add a per-request minter in `local-proof-bootstrap.ts`, used by `server-lifecycle.ts:517,557` and `runtime-overlay-main.ts:233`, dialling a literal host. Verify: the Electron part of 7.1 is green.
- [x] 7.4 Update or remove the existing client-side tests that assert the raw header is sent (`local-token-header.test.ts`, `local-proof-bootstrap.test.ts`); server-side raw-token tests stay. Grep gate: `rg -n -i "x-pi-local-token|LOCAL_TOKEN_HEADER" packages/*/src scripts --glob '!**/__tests__/**'` lists only the server legacy verification and the constant definitions.
- [x] 7.5 `scripts/reload-all.sh`: add the inline mint, minting per `/ws` upgrade and per `fetch`, and use a literal host. Verify: the script half of 1.3 is green.

## 8. Process-level, harness and manual scenarios

- [x] 8.1 Test (test-plan #X7), L2 in `qa/tests/43-gateway-squatter-proof.sh`; exemplar `qa/tests/23-gateway-socket-fallback.sh`.
  - Input: a forced-fallback dashboard with a spawned headless session; stop the dashboard and bind a node logger to `127.0.0.1:<piPort>`.
  - Trigger: the session reconnects to the logger; then stop the logger and restart the dashboard.
  - Observable:
    - the logger sees `X-Pi-Local-Proof`, no `X-Pi-Local-Token`, and no `session_register`;
    - `bridge-identity.log` gets a `server-proof-missing` line;
    - the session re-registers within 300 s, and its `bridge_diagnostic` appears in server.log.
- [x] 8.2 Test (test-plan #X8), L2 in `qa/tests/39-cli-open.sh` (extend; this is the exemplar).
  - Input: a running dashboard.
  - Trigger: `pi-dashboard open --print`, `login --local`, `token create`, `restart`, `service status`.
  - Observable: all exit 0, with no `x-pi-local-token` deprecation line from them in server.log.
- [x] 8.3 Test (test-plan #X9), L3 in `tests/e2e/local-credential-proof-nat.spec.ts`; exemplar `tests/e2e/identity-matrix/security.spec.ts`, using the port from `.pi-test-harness.json`.
  - Input: a proof minted on the host for the published address.
  - Trigger: `POST /api/identity/local-code` through the published port, then the same request inside the container.
  - Observable: 401 with `binding-mismatch` in the container server.log for the published-port request; success inside the container.
- [x] 8.4 Test (test-plan #X10), L2 in `qa/tests/28-gateway-windows.ps1` (extend; this is the exemplar).
  - Input: the dashboard holds `127.0.0.1:<piPort>`.
  - Trigger: a second standard user attempts to bind it.
  - Observable: the bind fails (EADDRINUSE/EACCES), recorded from an actual attempt.
- [x] 8.5 Live deploy-order check on a dev instance (test-plan: manual-only, #X11): restart the server first (`curl -X POST http://localhost:8000/api/restart`), then `npm run reload`; confirm that spawned sessions stay registered and that no quarantine lines appear.

## 9. Integration, review, docs, follow-up

- [x] 9.1 Full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then `grep -nE 'FAIL|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log` shows no failures.
- [x] 9.2 Spawn an `Audit` subagent on the diff (auth / untrusted input / secrets); fix the findings; run `review-code` before commit.
- [x] 9.3 DocScribe:
  - `docs/architecture.md` Auth model: proof, edge stamp, counter-proof, marker, legacy window, and the rotation owed at 1.0.0;
  - a `docs/faq.md` entry: "spawned session stuck: server-proof-missing" → restart after a downgrade or squatter;
  - the main agent updates AGENTS.md rows for every touched file (`See change: loopback-credential-proof`).
- [x] 9.4 File the stub change `close-loopback-legacy-window` (`openspec change new`, proposal only). Its scope: flip `acceptLegacyToken` and `requireTicketOnLoopback` at 1.0.0, rotate the local token in the same step, and amend `trust-and-credential-boundaries`, `bearer-device-auth` and `qr-device-pairing`. Verify: `openspec list` shows it.
