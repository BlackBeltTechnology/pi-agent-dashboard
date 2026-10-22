# Tasks

## 1. Default flip, rotation, suite triage (design D1, D2, D9, D11)

- [ ] 1.1 Change `DEFAULTS.requireLocalProof` to `true` (`packages/shared/src/config.ts:1811`). Make the parse boolean-strict (`config.ts:2670`), and update the doc comment at `:1255-1262`. Log the non-boolean warning from the server's `liveRequireLocalProof` consumer (`packages/server/src/config-snapshot.ts:113-115`), keyed on the last-warned raw value, never from `loadConfig`. Verify: the E16 matrix (`config-secure-write.test.ts:91-94`) asserts unset → `true`, `false` → `false`, `"yes"`/`"false"` → `true`; a bridge-process `loadConfig` logs nothing.
- [ ] 1.2 Add a proof-based stamp helper next to `stampedHeaders`/`stampLegacyHook` in `packages/server/src/test-support/local-credential-stamp.ts`. Run the full suite once under the new default (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`). Triage per design D9: admission tests use `setTrustConfig`; other tests use the proof helper. Add no global opt-out. Verify: the suite passes, and `rg -n "requireLocalProof: false" packages/*/src` lists only explicit, commented opt-out tests.
- [ ] 1.3 Implement `rotateSecretsOnce()` (design D11). It holds a link-claimed `local/rotation.lock` (stale after 30 s or a dead pid, wait capped at 35 s) and uses `local/rotation-epoch` with `REQUIRED_ROTATION_EPOCH = 1`. It writes a new 0600 token atomically, then a new `auth.secret` via `writeConfigFileSecure`, then the epoch. Call it in server startup before `server.ts:734` reads the token. Verify: unit tests for first start rotating once, second start not rotating, two concurrent starts rotating once, an old token's proof plus an old-secret JWT both rejected afterwards, and lock timeout or write failure exiting 1 before listening with the epoch unwritten.
- [ ] 1.4 Label `auth/approval-refusal.ts:79`, `auth/operate-required.ts:103` and the live-capability sites (`live-server/live-capability.ts:445`, `server.ts:4644`, `routes/live-server-routes.ts:99`) in the `auth/localhost-guard.ts` sidecar: the first two as non-admission, the live sites as the D2 accepted residual. Verify: the sidecar rows exist and cite those lines.
- [ ] 1.5 Test (test-plan #E1): L1 test in `packages/shared/src/__tests__/config-secure-write.test.ts` (extend the E16 matrix there). Scenario: input: `requireLocalProof` ∈ {absent, `true`, `false`, `"false"`, `"yes"`, `null`} · trigger: `loadConfig()` then a server snapshot read · observable: effective true/true/false/true/true/true; one server-side warning each for `"false"`, `"yes"`, `null`; `loadConfig` alone logs nothing.
- [ ] 1.6 Test (test-plan #E22): L1 test, copy harness from `packages/server/src/__tests__/local-token.test.ts`. Scenario: input: fake HOME with token T0, `auth.secret` S0, no epoch · trigger: server start, then start again · observable: T1≠T0, S1≠S0, epoch=1; the second start keeps T1/S1; proof from T0 and JWT signed with S0 both 401.
- [ ] 1.7 Test (test-plan #X1): L1 test, copy harness from `packages/server/src/__tests__/local-token.test.ts`. Scenario: input: `local/rotation.lock` held by a live pid · trigger: server start · observable: within 35 s exit 1, no listener, one log line naming the step plus lock and epoch paths, epoch absent; after the lock is released the next start rotates.
- [ ] 1.8 Test (test-plan #X2): L1 test, copy harness from `packages/server/src/__tests__/local-token.test.ts`. Scenario: input: `writeConfigFileSecure` throws EACCES after the token write · trigger: server start · observable: exit 1, no listener, epoch absent; the next start rotates the token again and writes `auth.secret` and the epoch.
- [ ] 1.9 Test (test-plan #X3): L1 test, copy the two-process harness from `packages/server/src/__tests__/cli-foreground-real.test.ts`. Scenario: input: two server processes on one fake HOME, different ports, started together · trigger: both start · observable: exactly one rotation (token mtime changes once); both accept a proof minted from the final token.
- [ ] 1.10 Test (test-plan #E2): L1 test, copy the real-listener harness from `packages/server/src/__tests__/local-proof-strict.test.ts`. Scenario: input: default config, peer `127.0.0.1`, `Host: 127.0.0.1:<port>`, no forwarding header, no proof · trigger: `POST /api/paired-devices`, `POST /api/ws-ticket {scope:"bridge"}`, `GET /api/paired-devices`, `GET /api/config` · observable: each 401/403 (`reason:"local_proof_required"` where the guard answers); `paired-devices.json` unchanged; no ticket.
- [ ] 1.11 Test (test-plan #E3): L1 test, copy harness from `packages/server/src/__tests__/local-proof-strict.test.ts`. Scenario: input: as E2 plus a valid `X-Pi-Local-Proof` per request · trigger: the same four requests · observable: device token 200, ticket 200, GET 200, `/api/config` 200 with secrets `"***"`.
- [ ] 1.12 Test (test-plan #E4): L1 test, copy harness from `packages/server/src/__tests__/local-proof-strict.test.ts`. Scenario: input: default config, bare loopback, no proof · trigger: `GET /api/sessions` and `POST /api/restart` · observable: 200 and 403.
- [ ] 1.13 Test (test-plan #E5): L1 test, copy harness from `packages/server/src/__tests__/local-proof-strict.test.ts`. Scenario: input: `requireLocalProof: false`, bare loopback, no proof · trigger: `POST /api/paired-devices` · observable: 200 with a token (rollback path).
- [ ] 1.14 Test (test-plan #E24): L1 test, copy harness from `packages/server/src/__tests__/local-proof-strict.test.ts`. Scenario: input: default config, bare loopback · trigger: `POST /mcp` without bearer and `GET /api/sessions` · observable: `/mcp` refused, `/api/sessions` 200.
- [ ] 1.15 Test (test-plan #E6): L1 test, copy the real-upgrade harness from `packages/server/src/__tests__/local-proof-strict.test.ts`. Scenario: input: default config, loopback `/ws` upgrade with `Origin: http://localhost:<port>` · trigger: upgrade without proof, then with a valid `pi_dash_local` cookie · observable: first 403, socket destroyed, `wsUpgradeRejectLog` line with `reason:"local_proof_required"`; second 101.

## 2. Refusal remedy and cookie (design D3, D12)

- [ ] 2.1 Add `needsLocalProof(request, ctx)` = `isLocallyTrusted(input) && !isLocallyTrusted(input, ctx) && !request.isAuthenticated` in `auth/localhost-guard.ts`, with no direct `isGenuinelyLocal` call. Use it in `sendNetworkDenied` (`:353-356`). Thread `localTrust` into the `/api/health` registration (`routes/system-routes.ts`) and add `localProof: "required"` to the shared health type. Verify: unit tests for each health case, including a signed-in or paired caller with no proof getting no field.
- [ ] 2.2 In `auth/auth-plugin.ts`, recognise a valid session cookie (`tagSessionCookie`) before the strict observe early-return (`:517-521`). It only tags, never refuses, and never clears a cookie on observe routes. Verify: a signed-in loopback tab is `isAuthenticated` on observe routes; an invalid cookie on an observe route is not cleared.
- [ ] 2.3 In `/auth/login` (`auth/auth-plugin.ts:358-371`), skip the single-provider auto-redirect when `needsLocalProof` holds, and render the `pi-dashboard open` remedy in the picker. Verify: a bare loopback HTML request to `/auth/login` with one provider gets 200, the remedy text and no redirect.
- [ ] 2.4 Make `useNetworkDenied`/`probeNetworkDenied` (`packages/client/src/hooks/useNetworkDenied.ts:26-51`) probe in `offline` and `auth_required`, handle a 200 body with `localProof === "required"` (not only 403), and render `{ reason: "local_proof_required" }` with a copyable `pi-dashboard open` in the existing banner. Verify: hook tests for both states and both body shapes, plus a visual check in a plain tab with OAuth off and on (`browser` skill).
- [ ] 2.5 Bind `pi_dash_local` to the issuing port and add a 12 h sliding idle expiry, with re-signing when a request arrives more than 1 h after the last refresh and an absolute cap of 30 days (`auth/local-proof.ts`, `routes/local-proof-routes.ts:44-49`). Verify: unit tests for a cookie rejected on another port, rejected after 12 h idle, refreshed on use, and rejected after 30 days.
- [ ] 2.6 Test (test-plan #E7): L1 test, copy harness from `packages/server/src/__tests__/health-access-grants.test.ts`. Scenario: input: default config; callers bare loopback / loopback + proof cookie / non-loopback no session / loopback + session cookie / loopback + device bearer / opt-out bare · trigger: `GET /api/health` · observable: `localProof:"required"` only for bare loopback.
- [ ] 2.7 Test (test-plan #E8): L1 test, copy harness from `packages/server/src/__tests__/auth-plugin-health-session.test.ts`. Scenario: input: default config, loopback, valid then expired session cookie · trigger: `GET /api/health`, `GET /api/sessions` · observable: valid → `isAuthenticated`, no `localProof`; expired → no clearing `Set-Cookie` on these observe routes.
- [ ] 2.8 Test (test-plan #E9): L1 test, copy harness from `packages/server/src/__tests__/auth-plugin-oauth-state.test.ts`. Scenario: input: one OAuth provider; callers bare loopback / loopback + proof / non-loopback · trigger: `GET /auth/login` (HTML) · observable: bare → 200 picker containing `pi-dashboard open`, no `Location`; the other two → 302 to the provider.
- [ ] 2.9 Test (test-plan #E10): L1 test, copy harness from `packages/server/src/__tests__/local-proof-next.test.ts`. Scenario: input: cookie issued on port A · trigger: presented to a server on port B (same HOME and token) · observable: operate route 403 `local_proof_required`.
- [ ] 2.10 Test (test-plan #E11): L1 test, copy harness from `packages/server/src/__tests__/local-proof-next.test.ts` (fake clock). Scenario: input: cookie last used at t0 · trigger: requests at +59m, +61m, just under 12 h idle, 12h0m1s idle, issuedAt+30d+1s · observable: admitted with no re-sign; admitted plus re-signed `Set-Cookie`; admitted; not proof; not proof.
- [ ] 2.11 Test (test-plan #F1): L1 test, copy harness from `packages/client/src/hooks/__tests__/useNetworkDenied.test.ts`. Scenario: input: mocked health 200 `{localProof:"required"}` · trigger: status connecting → offline · observable: converges to `{reason:"local_proof_required"}`, hint contains `pi-dashboard open`, stays set across re-probes.
- [ ] 2.12 Test (test-plan #F2): L1 test, copy harness from `packages/client/src/hooks/__tests__/useNetworkDenied.test.ts`. Scenario: input: same mock · trigger: status → `auth_required` · observable: converges to the same denial, not null.
- [ ] 2.13 Test (test-plan #F3): L1 test, copy harness from `packages/client/src/hooks/__tests__/useNetworkDenied.test.ts`. Scenario: input: health returns 200 without `localProof` after previously returning it · trigger: next probe · observable: denial clears to null.
- [ ] 2.14 Manual check: open a plain browser tab on `http://localhost:8000` with no proof cookie, OAuth off and on. Confirm the banner is readable, the `pi-dashboard open` command is copyable, and the reconnect does not flicker confusingly. (test-plan: manual-only, #F4)

## 3. Observability (design D6)

- [ ] 3.1 Log `[local-proof] refused peer=… host=<sanitized> method=… route=<pattern>` for REST refusals, keyed on (route pattern, reason) and bounded like `auth/ws-upgrade-reject-log.ts:41-55`. Extend `wsUpgradeRejectLog` with `reason` rather than adding a second WS emitter. Verify: unit tests for the limiter and for Host sanitization.
- [ ] 3.2 Test (test-plan #P1): L1 timed test, copy harness from `packages/server/src/__tests__/ws-upgrade-reject-log.test.ts`. Scenario: input: 10 000 bare-loopback refusals, random `Host`, 300 route patterns · trigger: the refusal log within one 60 s window (fake clock) · observable: limiter keys ≤ 256; lines ≤ distinct (route, reason) keys; no raw newline in any line.

## 4. Dashboard-state protection on path-taking routes (design D8)

- [ ] 4.1 Add `isDashboardStatePath(realPath)` with the realpath'd `getDashboardConfigDir()` and two tiers. The always-refused tier (`local/**`, `identity.key`) is checked before open and re-checked after open by comparing the handle's `fstat` (dev, ino) with each always-refused file. The trust-gated tier (rest of the dir) is admitted when `isLocallyTrusted(…, ctx)` holds or the caller has a session, and then falls through to the normal anchors. Do not reuse `verified-read`. Verify: unit tests for each tier and caller kind, a symlink swapped in after the check, a `$HOME`/`~/.pi` symlink, and `requireLocalProof:false` restoring the trust-gated tier.
- [ ] 4.2 Apply the check on every path-taking route:
  - `/api/file*`, `/api/session-file`, `/api/file/write*`;
  - the `~/.pi` anchor sites (`routes/file-routes.ts:137-139, 401`, plus raw and render);
  - `/api/grep`, filtering matches and skipping the state dir in the JS fallback (`lib/grep.ts:41, 72`);
  - mention resolution (`resolve-file-mention.ts:79`);
  - open-in-system and reveal;
  - the live static gates (`server.ts:3263, 3279`).

  Verify with integration tests: a session with a non-`$HOME` cwd cannot read `~/.pi/dashboard/local/token`; `/api/grep` with and without `rg` returns nothing from it; `~/.pi/agent/…` stays readable as before; a proofed caller reads `config.json`.
- [ ] 4.3 Make a `needsLocalProof` caller's containment miss prompt-ineligible (`access/containment-gate.ts:303-307`, `holdDenial`), per MODIFIED `file-read-containment`. Verify: an unproven loopback miss is refused immediately and no pending access prompt is created.
- [ ] 4.4 Test (test-plan #E12): L1 test, copy harness from `packages/server/src/__tests__/file-absolute-containment.test.ts`. Scenario: input: paths `local/token`, `identity.key`, `config.json`, `~/.pi/agent/x.md` × callers bare-unproven / proofed / session / device / opt-out bare · trigger: `GET /api/file` via the `~/.pi` anchor · observable: token and identity.key refused for all; config.json refused for bare-unproven and device, admitted for the rest; agent file admitted for all.
- [ ] 4.5 Test (test-plan #E13): L1 test, copy harness from `packages/server/src/__tests__/file-absolute-containment.test.ts`. Scenario: input: default config, session cwd `/tmp/proj`, bare loopback · trigger: `GET /api/file` (plus raw and render) for `~/.pi/dashboard/local/token` · observable: 403, no token bytes in the body.
- [ ] 4.6 Test (test-plan #E14): L1 test, copy harness from `packages/server/src/__tests__/grep.test.ts`. Scenario: input: session cwd = fake `$HOME` with `.pi/dashboard/local/token` holding a marker; runs with and without `rg` on PATH · trigger: `GET /api/grep?q=<marker>` bare loopback · observable: zero matches in both runs.
- [ ] 4.7 Test (test-plan #E15): L1 test, copy harness from `packages/server/src/lib/__tests__/resolve-file-mention.test.ts`. Scenario: input: the token path · trigger: mention resolve, `POST /api/open-in-system`, `POST /api/reveal-in-file-manager`, a live static gate request · observable: each refused; mention resolve does not report the path as existing.
- [ ] 4.8 Test (test-plan #X4): L1 test, copy harness from `packages/server/src/__tests__/file-absolute-containment.test.ts`. Scenario: input: a hook swaps `cwd/d` for a symlink to `local/` between the check and the open · trigger: `GET /api/file` for `d/token` · observable: refused (handle dev/ino matches), no bytes.
- [ ] 4.9 Test (test-plan #X5): L1 test, copy harness from `packages/server/src/__tests__/file-absolute-containment.test.ts`. Scenario: input: bare loopback, no proof, path outside every anchor · trigger: `GET /api/file` · observable: immediate 403, pending-prompt store empty; the same miss by a proofed caller still suspends.

## 5. CLI, exec env, caller migration (design D4, D5)

- [ ] 5.1 Extract the leading-slash predicate behind `sanitizeReturnUrl` (`auth/auth-plugin.ts:117`) into `packages/shared/src/safe-local-path.ts` (`isSafeLocalPath`, no dependencies), and make `sanitizeReturnUrl` call it. Verify: the return-target tests pass unchanged, and a grep shows one implementation.
- [ ] 5.2 Add `pi-dashboard api <METHOD> <path> [--data <json>] [--port N]` in `packages/server/src/cli.ts`:
  - resolve the subcommand word as the first positional that is not a flag value, with one scan shared by `api`, `token`, `service`, `pair`, `login` and `SUBCOMMANDS`;
  - dial the address literal `restart` uses (`:859-866`);
  - mint with `localCredentialHeaders` and send `redirect:"manual"`;
  - validate the path with `isSafeLocalPath` and reject `#`;
  - exit 0 on 2xx, 1 on any other status, 2 on usage error or server not running.

  An unknown word prints a runtime usage line and exits 2; flag-only invocations still run in the foreground. Verify: unit tests for each exit path, each rejected path, `--port 9000 api GET /x`, and an unknown word binding no port.
- [ ] 5.3 Inject `PI_DASHBOARD_CLI` (an absolute, shell-quoted command from `resolveServerCliPath`, `packages/extension/src/server-launcher.ts:52-67`) in `buildDashboardExecEnv` (`packages/extension/src/command-handler.ts:1360-1366`). Switch the non-observe templates (`commands/dashboard-server-config.md:5`, `dashboard-peer-scan.md:5`) to `$PI_DASHBOARD_CLI api …`. Verify: the exec-env test asserts the variable, and both templates succeed under the default with no `pi-dashboard` on PATH.
- [ ] 5.4 Send proof, dialling the address literal (never `localhost`), from:
  - `.pi/skills/implement/scripts/full-rebuild.ts:62-65` and `restart-server.ts:47-52` (`httpProofHeaders`);
  - `packages/extension/src/dev-build.ts:34` (`localCredentialPlan`);
  - `packages/bus-client/src/client.ts:146` `mintTicket`, through an injected proof-header provider wired from `dashboard-bus.ts` and `debug-dashboard/scripts/{list-sessions,health-probe}.ts`;
  - the `tests/e2e/goal-plugin-relocation.spec.ts:37` mint;
  - the `docker/test-entrypoint.sh:997-1010` `/ws` smoke.

  Append the `pi-dashboard open` remedy to `packages/extension/src/server-auto-start.ts:427`. Verify: a bus-client unit test asserts the header; `npx tsx .pi/skills/implement/scripts/restart-server.ts` restarts the dev server under the default.
- [ ] 5.5 Run `rg -n -i "(curl|wget|fetch\(|WebSocket\()[^#\n]*(localhost|127\.0\.0\.1|PI_DASHBOARD_BASE|apiBase)" qa scripts docker packages/electron/scripts tests/e2e docs README.md AGENTS.md .pi/skills packages/*/.pi/skills packages/claude-plugin packages/dashboard-plugin-skill`. Triage every hit against `packages/shared/src/route-tiers.ts`, including GETs on `operate` routes and `/ws`. Migrate non-observe hits to `pi-dashboard api …`/`pi-dashboard restart`/proof helpers. This includes `packages/electron/scripts/test-*-inner.sh`, `AGENTS.md:72`, `.pi/skills/implement/SKILL.md:24` and `packages/dashboard-plugin-skill/src/next-steps.ts:32`. `docs/**` and `README.md` go to DocScribe (5.8). Verify: re-running the `rg` leaves only observe or proofed hits, and `bash -n` passes on each edited script.
- [ ] 5.6 Check dev-checkout resolution: confirm `pi-dashboard api GET /api/health` and `pi-dashboard restart` reach the checked-out dev server. If PATH resolves to an installed bundle, document the `npx tsx packages/server/src/cli.ts` fallback and the minimum CLI version (5.8). Verify: the documented command runs as written.
- [ ] 5.7 Run the docker e2e harness (`run-dashboard-e2e-local-changes`) and one qa smoke under the new default. Fix any remaining bare-loopback caller, and record whether harness peers arrive as loopback. Verify: both runs are green.
- [ ] 5.8 DocScribe updates `docs/architecture.md` (Auth model), `docs/faq.md` and `README.md`. The FAQ covers:
  - the default;
  - forwarded-loopback users (`ssh -L`, VS Code, WSL) using `pi-dashboard open --print` with a same-port forward;
  - the opt-out re-exposing containers;
  - never mounting `~/.pi/dashboard` into a container;
  - the one-time rotation and sign-out;
  - the proof cookie reaching other `localhost` sites;
  - the minimum CLI version.

  Verify: the 5.5 `rg` is clean over `docs/` and `README.md`.
- [ ] 5.9 Test (test-plan #E16): L1 test, copy harness from `packages/server/src/__tests__/cli-restart.test.ts`. Scenario: input: `<path>` ∈ {`/api/health`, `api/health`, `//evil.example/x`, `/\evil`, `https://x/api`, `/a<BEL>`, `/a#b`, `/api/file?path=a`} · trigger: `pi-dashboard api GET <path>` against a recording fake server · observable: `/api/health` and `?path=` sent with exit 0; all others exit 2 with zero requests.
- [ ] 5.10 Test (test-plan #E17): L1 test, copy harness from `packages/server/src/__tests__/cli-restart.test.ts`. Scenario: input: fake server answering 200 / 404 / 302 to `http://evil` / not listening · trigger: `pi-dashboard api GET /x` · observable: exit 0 with body on stdout; exit 1 with body on stderr; exit 1 with no request to evil; exit 2 with "server not running".
- [ ] 5.11 Test (test-plan #E18): L1 test, copy harness from `packages/server/src/__tests__/cli-parse.test.ts`. Scenario: input: argv `--port 9000 api GET /x`, `frobnicate`, `--port 9000`, `token list`, `pair`, `api` · trigger: CLI dispatch · observable: api dispatched; exit 2 with usage and no port bound; foreground start; token, pair and api dispatched unchanged.
- [ ] 5.12 Test (test-plan #E21): L1 test, copy harness from `packages/extension/src/__tests__/command-handler.test.ts`. Scenario: input: extension installed at a path containing a space · trigger: `buildDashboardExecEnv()` plus a bash exec of `$PI_DASHBOARD_CLI api GET /api/health` · observable: absolute, shell-quoted value; exit 0 with no `pi-dashboard` on PATH.
- [ ] 5.13 Test (test-plan #E23): L1 test, copy harness from `packages/bus-client/src/__tests__/connect.test.ts`. Scenario: input: bus-client with an injected proof provider · trigger: `mintTicket("browser")` · observable: the request carries the provider's `X-Pi-Local-Proof`.
- [ ] 5.14 Test (test-plan #X7): L2 qa smoke, copy harness from `qa/tests/39-cli-open.sh`. Scenario: input: qa VM, installed `pi-dashboard`, default config · trigger: `pi-dashboard api POST /api/restart`, then bare `curl -X POST http://127.0.0.1:8000/api/restart` · observable: CLI exit 0 and the server restarts; curl 403 with `local_proof_required`.
- [ ] 5.15 Test (test-plan #F5): L3 harness run, see `tests/e2e/network-guard.spec.ts` and `docker/test-entrypoint.sh`. Scenario: input: `docker/test-up.sh` with this change · trigger: harness boot (entrypoint `/ws` smoke) plus the existing e2e suite · observable: harness ready; `/ws` smoke passes with proof; suite green.
- [ ] 5.16 Test (test-plan #X8): electron launch smoke, extend the job in `.github/workflows/ci-electron.yml`. Scenario: input: packaged app, fresh HOME · trigger: launch smoke · observable: main window loads the dashboard with no `local_proof_required` refusal in the renderer log; `curl /api/health` 200.
- [ ] 5.17 Manual check: from a second machine, `ssh -L 8000:127.0.0.1:8000`, run `pi-dashboard open --print` on the server, and open the URL through the forward. Confirm the remedy flow works as documented. (test-plan: manual-only, #X10)

## 6. Browser relay ticket (design D10)

- [ ] 6.1 Spike before building. Check that `agent-browser connect`, Playwright `connectOverCDP` and the pinned Playwright extension (`mcpRelayUrl`) each preserve a `?ticket=` query on the relay WS URL, and whether each reconnects silently with the same URL. If any drops the query or needs a reusable URL, write `SHIP_IT_BLOCKED.md` and hand back to planning. Verify: a spike note under the change with the observed behaviour per client.
- [ ] 6.2 Add optional `peerCredential: "plugin"` to `WsRouteRegistration` (`packages/dashboard-plugin-runtime/src/server/ws-route-registry.ts`). In the core gate (`server.ts:4594` → `isPluginScopePeerLocal`), skip only the strict proof requirement for such scopes. Verify: unit tests showing a `peerCredential` scope admitted without proof (host, origin and locality still enforced) and an ordinary plugin scope refused without proof under the default.
- [ ] 6.3 In `packages/browser-plugin`, mint a relay ticket per issued URL: 32 bytes, 60 s TTL, bound to (guid, role), consumed on first upgrade attempt, never logged. Append it to `cdpUrl` (`relay-manager.ts:442, 643, 1061`) and `mcpRelayUrl` (`connect.ts:48-51`). Verify it in `handleUpgrade` (`ws-routes.ts`) before `manager.resolve`, and register both scopes with `peerCredential: "plugin"`. Verify: unit tests for fresh ticket admitted, replayed ticket refused, expired ticket refused, wrong role refused; then an end-to-end `browser_connect` → `agent-browser connect` under the default (`browser` skill).
- [ ] 6.4 Test (test-plan #E19): L1 test, copy harness from `packages/browser-plugin/src/server/__tests__/ws-routes.test.ts`. Scenario: input: issued `cdpUrl` with ticket t for guid g · trigger: dial within 60 s; re-dial with t; dial with an unused ticket after 61 s; dial `browser-ext` with the cdp ticket; dial g with no ticket · observable: admitted; refused; refused; refused; refused; no CDP attach on any refusal.
- [ ] 6.5 Test (test-plan #X6): L1 test, copy harness from `packages/browser-plugin/src/server/__tests__/ws-routes.test.ts`. Scenario: input: CDP client disconnects after attach · trigger: re-dial the same `cdpUrl` · observable: refused (ticket consumed); a fresh `connect` URL attaches.
- [ ] 6.6 Test (test-plan #E20): L1 test, copy harness from `packages/server/src/__tests__/plugin-ws-route.test.ts`. Scenario: input: default config, bare loopback, no proof; scope A with `peerCredential:"plugin"`, scope B without · trigger: upgrade to A and B, and A with a tunnel Host · observable: A reaches `handleUpgrade` (spy called); B 403 before delegation; tunnel-Host A 403.
- [ ] 6.7 Manual check with real clients: `browser_connect`, then `agent-browser connect <cdpUrl>` and a Playwright `connectOverCDP` against a real Chrome profile. Confirm they attach and drive the browser (depends on the task 6.1 spike). (test-plan: manual-only, #X9)

## 7. Sibling coordination (design D7)

- [ ] 7.1 Ask the owner of `openspec/changes/close-residual-audit-findings` (in-flight, untracked) to drop only its B14r material, keeping B4r and B18, and to replace the B14r `blocked_by` with `blocked_by: close-container-loopback-impersonation`. Hand over design D7 as the brief; this change does not edit those files. Verify: the request is recorded in the PR description.
- [ ] 7.2 Re-run `node scripts/spec-collateral.mjs --change close-container-loopback-impersonation` and list any other active change MODIFYING `browser-relay`, `plugin-ws-route` or `prompt-template-executable-mode` in the PR description as an archive-time rebase. Verify: the list is in the PR description.

## 8. Release notes

- [ ] 8.1 Add a CHANGELOG `[Unreleased]` BREAKING entry covering:
  - the default posture;
  - "stop every instance before upgrading";
  - the one-time secret rotation and sign-out;
  - forwarded-loopback users;
  - the `pi-dashboard open` remedy;
  - `pi-dashboard api` and the unknown-subcommand exit 2;
  - the dashboard-state refusals;
  - the relay ticket;
  - the port-bound 12 h proof cookie;
  - the opt-out with its container warning.

  Verify: the entry is present.
- [ ] 8.2 Manual check on the dev Mac with Docker Desktop: from a container, send the spoofed-Host probe to `host.docker.internal:8000` and attempt the `/api/file` and `/api/grep` token reads. Expect 401/403 and no token bytes. (test-plan: manual-only, #X11)

## Workflow follow-up

- After merge, repeat the container probe from `docs/research/containerized-spawn.md` against the live `:8000` instance:
  - spoofed Host → 401/403;
  - honest Host → 403;
  - token read through `/api/file` and `/api/grep` refused.

  Then mark the research finding fixed (DocScribe).
