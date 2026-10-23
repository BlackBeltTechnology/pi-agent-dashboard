# Test Plan — close-container-loopback-impersonation

Stage: design   Generated: 2026-10-22

Hard gate resolved: the D11 rotation failure observable is "fail closed" (owner decision). No open clarifications.

Notes:
- A server-side "L1" row uses vitest with `createTestServer`/`inject`, or a real listener where a WS upgrade or socket peer is needed.
- The docker e2e harness reaches the dashboard through a NATed port mapping, so its peers are not loopback (`tests/e2e/local-credential-proof-nat.spec.ts`). Bare-loopback refusal is therefore proven at L1 against a real loopback listener, not at L3.
- L3 covers "the harness still boots and works under the new default".

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | T&CB "Opt-in local proof" (default) | decision table | L1 | automated | config `requireLocalProof` ∈ {absent, `true`, `false`, `"false"`, `"yes"`, `null`} | `loadConfig()` then server snapshot read | effective = true, true, false, true, true, true; exactly one server-side warning for each of `"false"`, `"yes"`, `null`; `loadConfig` alone logs nothing |
| E2 | T&CB "spoofed loopback Host from a relayed container is denied" | decision table | L1 | automated | real loopback listener, default config, peer `127.0.0.1`, `Host: 127.0.0.1:<port>`, no forwarding header, no proof | `POST /api/paired-devices` `{label}`; `POST /api/ws-ticket {scope:"bridge"}`; `GET /api/paired-devices`; `GET /api/config` | each refused (401/403, REST body `reason:"local_proof_required"` where the guard answers); `paired-devices.json` row count unchanged; no ticket in body |
| E3 | T&CB "default keeps local tooling working" | EP (valid class) | L1 | automated | same as E2 plus a valid `X-Pi-Local-Proof` for each method and target | same four requests | `POST /api/paired-devices` 200 with token; ws-ticket 200; GET 200; `/api/config` 200 with secrets `"***"` |
| E4 | T&CB "observe-tier route still allowed" (default) | EP | L1 | automated | default config, bare loopback, no proof | `GET /api/sessions` (observe) and `POST /api/restart` (operate) | 200 and 403 respectively |
| E5 | T&CB "default off preserves loopback access" | EP | L1 | automated | `requireLocalProof: false`, bare loopback, no proof | `POST /api/paired-devices` | 200, token minted (rollback path) |
| E6 | oauth "Localhost control request without proof under the default"; cross-site-request-gate scenarios | state-transition (upgrade) | L1 | automated | default config, real listener, `/ws` upgrade from loopback with `Origin: http://localhost:<port>` | upgrade without proof; then with valid `pi_dash_local` cookie | first: HTTP 403, socket destroyed, `wsUpgradeRejectLog` line with `reason:"local_proof_required"`; second: 101 |
| E7 | T&CB "A refused local browser is told how to authorize itself" | decision table | L1 | automated | default config; callers: bare loopback / loopback + proof cookie / non-loopback no session / loopback + valid session cookie / loopback + device bearer / `requireLocalProof:false` bare | `GET /api/health` | `localProof:"required"` present only for the bare-loopback caller; absent in the other five |
| E8 | D3 session tagging order | state-transition | L1 | automated | default config, loopback, valid session cookie; then an expired cookie | `GET /api/health`, `GET /api/sessions` | valid cookie: `isAuthenticated` true, no `localProof`; expired cookie: no `Set-Cookie` clearing on these observe routes |
| E9 | oauth "OAuth login flow" (unproven local not auto-redirected) | decision table | L1 | automated | one OAuth provider; callers: bare loopback / loopback + proof / non-loopback | `GET /auth/login` (HTML) | bare: 200 picker containing `pi-dashboard open`, no `Location`; proofed and non-loopback: 302 to the provider |
| E10 | T&CB "proof cookie is bound to its port" | EP | L1 | automated | cookie issued by a server on port A | presented to a server on port B (same HOME and token) | not proof: B answers an operate route 403 `local_proof_required` |
| E11 | T&CB "idle proof cookie expires" (12 h sliding, 30 d cap) | BVA | L1 | automated | fake clock; cookie lastUse at t0 | requests at t0+59m, t0+61m, t0+11h59m59s after the last refresh, t0+12h0m1s idle, issuedAt+30d+1s | 59m: admitted, no re-sign; 61m: admitted plus `Set-Cookie` re-signed; just under 12 h idle: admitted; just over: not proof; past 30 d: not proof even if fresh lastUse |
| E12 | T&CB "Dashboard state is never served" tiers | decision table | L1 | automated | paths `local/token`, `identity.key`, `config.json`, `~/.pi/agent/x.md`; callers bare-unproven / proofed / session / device / bare with `requireLocalProof:false` | `GET /api/file` through a session's `~/.pi` anchor | token and identity.key: refused for all five; config.json: refused for bare-unproven and device, admitted for proofed, session and opt-out bare; agent file: admitted for all as today |
| E13 | T&CB "local token unreadable from a relayed container"; frc anchor | EP | L1 | automated | default config, a session with cwd `/tmp/proj` (not `$HOME`), bare loopback | `GET /api/file?cwd=/tmp/proj&path=~/.pi/dashboard/local/token` (raw and render variants too) | 403, body contains no token bytes |
| E14 | T&CB "grep cannot surface the token" | EP × fault (no rg) | L1 | automated | session cwd = fake `$HOME` containing `.pi/dashboard/local/token` with a known marker string; run once with `rg` on PATH and once with `rg` removed | `GET /api/grep?q=<marker>` bare loopback | zero matches in both runs |
| E15 | T&CB path-taking routes coverage | EP | L1 | automated | token path | file-mention resolve, `POST /api/open-in-system`, `POST /api/reveal-in-file-manager`, live-server static gate request for that path | each refused; mention resolve does not report the path as existing |
| E16 | spm "Local tooling … proof-minting CLI" path rule | EP + BVA | L1 | automated | `<path>` ∈ {`/api/health`, `api/health`, `//evil.example/x`, `/\evil`, `https://x/api`, `/a<BEL>`, `/a#b`, `/api/file?path=a`} | `pi-dashboard api GET <path>` against a fake server recording requests | `/api/health` and `?path=` sent, exit 0; all others exit 2 with zero requests recorded |
| E17 | spm CLI exit codes | EP | L1 | automated | fake server answering 200 / 404 / 302 `Location: http://evil` / not listening | `pi-dashboard api GET /x` | exit 0 (body on stdout); 1 (body on stderr); 1 with no request to `evil`; 2 with "server not running" |
| E18 | spm "Backward compatible foreground mode" + dispatch | decision table | L1 | automated | argv: `--port 9000 api GET /x`; `frobnicate`; `--port 9000`; `token list`; `pair`; `api` | CLI dispatch | api dispatched; exit 2 with usage and no port bound; foreground start; token, pair and api dispatched unchanged |
| E19 | browser-relay "Relay endpoints are loopback-only" (ticket) | state-transition | L1 | automated | issued `cdpUrl` with ticket t for guid g | dial within 60 s; dial again with t; dial after 61 s with a fresh-issue t2 unused; dial `browser-ext` with the cdp ticket; dial g with no ticket | admitted; refused; refused; refused (wrong role); refused; no CDP attach on any refusal |
| E20 | plugin-ws-route "Core gates" (`peerCredential`) | decision table | L1 | automated | default config, bare loopback no proof; scope A with `peerCredential:"plugin"`, scope B without | upgrade to A and B | A reaches `handleUpgrade` (spy called); B 403 before delegation (spy not called); A with a tunnel Host still 403 |
| E21 | ptem "Dashboard env vars injected" | EP | L1 | automated | extension installed at a path containing a space | `buildDashboardExecEnv()` | `PI_DASHBOARD_CLI` is absolute and shell-quoted; `$PI_DASHBOARD_CLI api GET /api/health` in a bash exec exits 0 with no `pi-dashboard` on PATH |
| E22 | T&CB "Secrets exposed before this version are rotated once" | state-transition | L1 | automated | fake HOME with token T0, `auth.secret` S0, no epoch | start; capture T1/S1; start again | T1≠T0, S1≠S0, epoch=1; second start leaves T1/S1; proof minted with T0 → 401; JWT signed with S0 → 401 |
| E23 | D5 bus-client | EP | L1 | automated | bus-client with an injected proof provider | `mintTicket("browser")` | request carries the provider's `X-Pi-Local-Proof` header |
| E24 | dashboard-mcp-server "Other routes retain the loopback allowance" | EP | L1 | automated | default config, bare loopback | `POST /mcp` without bearer; `GET /api/sessions` | `/mcp` refused; `/api/sessions` 200 |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | D6 bounded refusal log | soak (flood) | L1 | automated | 10 000 bare-loopback refusals with random `Host` values across 300 route patterns | limiter key count ≤ 256; emitted lines ≤ number of distinct (route, reason) keys; every line single-line (no raw newline) | one 60 s limiter window (fake clock) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | T&CB remedy (offline) | async state-convergence | L1 | automated | `useNetworkDenied` with a mocked health returning 200 `{localProof:"required"}` | status transitions connecting → offline | converges to `{reason:"local_proof_required"}` with a hint containing `pi-dashboard open`; stays set across further re-probes |
| F2 | T&CB remedy (OAuth `auth_required`) | async state-convergence | L1 | automated | same mock | status → `auth_required` | converges to the same denial (not null) |
| F3 | T&CB "proofed tab sees no banner" | state-transition | L1 | automated | health returns 200 without `localProof` after previously returning it | next probe | denial clears to null |
| F4 | T&CB remedy rendering | visual/subjective | — | manual-only | plain browser tab on `http://localhost:8000` with no proof cookie, OAuth off and on | human opens the dashboard | [judgment: banner readable, command copyable, no confusing reconnect flicker] |
| F5 | docker harness under the new default | state-convergence | L3 | automated | `docker/test-up.sh` with this change | harness boot (entrypoint `/ws` smoke) + existing e2e suite | harness reaches ready; the entrypoint's `/ws` smoke passes with proof; e2e suite green |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | T&CB "rotation failure fails closed" (lock) | fault-injection (delay) | L1 | automated | `local/rotation.lock` held by a live pid | server start | after ≤ 35 s: exit 1, no listener bound, one log line naming the step and the lock and epoch paths, epoch absent; after releasing the lock, the next start rotates |
| X2 | T&CB "rotation failure fails closed" (write) | fault-injection (abort) | L1 | automated | `writeConfigFileSecure` throws EACCES after the token write | server start | exit 1, no listener, epoch absent; next start rotates the token again and writes `auth.secret` and the epoch |
| X3 | T&CB "concurrent first starts rotate once" | fault-injection (race) | L1 | automated | two server processes on one fake HOME, different ports, started together | both start | exactly one rotation (token file mtime changes once); both accept a proof minted from the final token |
| X4 | T&CB "always-refused file swapped in after the check" | fault-injection (race) | L1 | automated | hook between path check and open swaps `cwd/d` for a symlink to `local/` | `GET /api/file` for `d/token` | refused (handle dev/ino matches the always-refused file); no bytes returned |
| X5 | T&CB "unproven local caller cannot raise an access prompt"; frc suspension | fault-injection (miss) | L1 | automated | bare loopback no proof, path outside every anchor | `GET /api/file` | immediate 403; pending-prompt store empty; a proofed caller's identical miss still suspends |
| X6 | browser-relay reconnect | state-transition | L1 | automated | CDP client disconnects after attach | client re-dials the same `cdpUrl` | refused (ticket consumed); a fresh `connect` URL attaches |
| X7 | spm CLI under the default (real binary) | EP | L2 | automated | qa VM, installed `pi-dashboard`, default config | `pi-dashboard api POST /api/restart`; `curl -X POST http://127.0.0.1:8000/api/restart` | CLI exit 0 and server restarts; bare curl 403 with `local_proof_required` |
| X8 | Electron loads under the new default | EP | electron | automated | packaged app, fresh HOME | launch smoke | main window loads the dashboard (no `local_proof_required` refusal in the renderer log); `curl /api/health` 200 |
| X9 | relay end-to-end with real clients | integration | — | manual-only | real Chrome profile + `agent-browser` | `browser_connect` then `agent-browser connect <cdpUrl>`, plus a Playwright `connectOverCDP` | [judgment: real third-party clients attach and drive the browser; depends on the task 6.1 spike outcome] |
| X10 | forwarded-loopback users | integration | — | manual-only | `ssh -L 8000:127.0.0.1:8000` from a second machine | `pi-dashboard open --print` on the server, open the URL through the forward | [judgment: remedy flow works over a same-port forward as documented] |
| X11 | live container probe (workflow follow-up) | fault-injection (real relay) | — | manual-only | Docker Desktop container on the dev Mac | spoofed-Host probe to `host.docker.internal:8000`; `/api/file` and `/api/grep` token read | [observable on a real host relay: 401/403 and no token bytes; needs Docker Desktop, not automatable in CI] |

---

## Coverage summary

- Requirements covered: every MODIFIED/ADDED requirement in this change's 15 delta files has ≥1 row. `principal-resolution` and `settings-panel` are covered via E6/E2–E3 (same admission path); `trusted-networks` and `bearer-device-auth` wording deltas are covered by E2–E5.
- Scenarios by class: edge 24 · perf 1 · frontend 5 · error 11
- Scenarios by level: L1 34 · L2 1 · L3 1 · electron 1 · — 4
- Scenarios by disposition: automated 37 · manual-only 4 (F4, X9, X10, X11)

## New infra needed

- none. The L1 rows use `createTestServer`, real-listener helpers (`local-proof-strict.test.ts`) and the fake-HOME `trust-mode-home.ts`. X3 spawns two server processes, as `cli-foreground-real.test.ts` does.
