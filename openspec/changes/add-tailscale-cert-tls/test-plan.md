# Test Plan — add-tailscale-cert-tls

Stage: design   Generated: 2026-09-28

Clarifications resolved before writing (hard gate): Gateway section status cadence = 5 s poll while mounted (2026-10-19); backoff 5 min doubling → cap 6 h; tailnet-HTTPS-disabled re-check every 15 min; TLS covered by L1 vitest integration (real `https` listener on an ephemeral port + injected fake `CertSource`), real tailscale = manual; no performance budget (performance class intentionally empty).

Test certs for L1: committed fixture PEMs (a test CA + leaf certs for `host.example.ts.net`, `*.example.com`, `a.test`, `b.test`, `x.test`; long validity) generated once by a checked-in `openssl` script — Node's `crypto` can parse but not mint X.509. Clients trust the test CA via `ca:`; validity-dependent tests use a fake clock relative to the fixture's `validFrom`/`validTo`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Optional native TLS listener — disabled by default | decision-table | L1 | automated | config with no `tls` block; second config `tls.enabled:false`, `port:8443` | server start | TCP connect to `127.0.0.1:8443` refused in both; `/api/health.tls` = `{enabled:false,bound:false}`; with `bindHost:"0.0.0.0"` + `tls:{enabled:true}` the detailed host is `127.0.0.1` |
| E2 | Enabled without usable sources | decision-table | L1 | automated | `tls:{enabled:true,sources:[]}` | reconcile | port not bound; detailed status gates contain `{id:"no-sources",ok:false}` |
| E3 | Unknown source type / duplicate id rejected | EP | L1 | automated | `PUT /api/config` with `sources:[{type:"foo"}]`; then `sources:[{type:"tailscale"},{type:"tailscale"}]` | PUT | HTTP 400, body names `sources[0].type` / duplicate id `tailscale`; config file bytes unchanged |
| E4 | Port validation (D7) | BVA | L1 | automated | `tls.port` ∈ {0, 1, 65535, 65536, = `port`, = `piPort`}; then stored `tls.port:9443` + PUT `port:9443` | PUT | 0/65536/collisions → 400 naming the field; 1 and 65535 → 200; changing main `port` onto stored `tls.port` → 400 |
| E5 | Partial config write preserves sibling keys | state | L1 | automated | stored `tls:{enabled:false,port:9443,sources:[{type:"tailscale"}]}` | `PUT {tls:{enabled:true}}` | stored `tls` = `{enabled:true,port:9443,sources:[{type:"tailscale"}]}` |
| E6 | Certificate selection per SNI name | EP | L1 | automated | store holds `host.example.ts.net` and `*.example.com` | TLS connects with servername `host.example.ts.net`, `dash.example.com`, `a.b.example.com`, `example.com`, `other.test`, and via IP (no SNI) | first two succeed with matching cert subject; the other four fail the handshake (client `error` event, no HTTP response); resuming a pre-prune session for a pruned name also fails |
| E7 | Renewal threshold at 1/3 validity | BVA | L1 | automated | cert with 90 d validity; fake clock at 60.1 d elapsed (29.9 d left) and 59.9 d elapsed (30.1 d left) | manager tick | `obtain()` called exactly once — only in the < 1/3 case |
| E8 | Renewal without restart (hot swap) | state-transition | L1 | automated | listener serving cert A; one keep-alive socket open | store swaps to cert B | new connection's peer cert fingerprint = B; existing socket still usable; `process.pid` unchanged |
| E9 | Settings change forces re-issue; per-name fingerprint | decision-table | L1 | automated | held fresh cert with `meta.fingerprint:"f1"`, source fingerprint → `"f2"`; list source `[a.test,b.test]` gains `c.test` | reconcile | one `obtain()` for the f2 name; for the list source only `c.test` obtained |
| E10 | Removed name is pruned | state-transition | L1 | automated | fake source returns `[a.test,b.test]`, both held | source now returns `[a.test]`; reconcile | handshake for `b.test` fails; `b.test` absent from `/api/tunnel/endpoints`; its files under `tls/<sourceId>/` deleted |
| E11 | Name conflict | decision-table | L1 | automated | sources `s1`,`s2` both return `x.test` | reconcile | only `s1.obtain` called; `s2` status gate `{id:"name-conflict",name:"x.test",ok:false}` |
| E12 | Single-flight issuance | state-transition | L1 | automated | scheduled `obtain("x.test")` pending (deferred promise) | `trigger("s1","x.test")` | `obtain` call count stays 1; both awaiters resolve with the same result |
| E13 | Backoff schedule | BVA | L1 | automated | `obtain` always rejects; fake timers | advance time | gaps between attempt starts 5, 10, 20, 40, 80, 160, 320, 360, 360 min (cap 6 h) |
| E14 | Source-imposed retry delay | BVA | L1 | automated | first failure `RetryAfterError(60 min)` | advance 59 min, then 1 more | no attempt at 59 min; attempt at 60 min |
| E15 | Private key storage | EP | L1 | automated | successful obtain | write | key file mode `0o600`; written via tmp + rename (no partial file observed by a concurrent reader stub) |
| E16 | Keys never exposed | EP | L1 | automated | held cert with known PEM key | `GET /api/config`, `GET /api/health` as local caller | neither body contains `PRIVATE KEY` nor any 40-char slice of the key PEM |
| E17 | Source removal deletes its keys | state-transition | L1 | automated | source `s1` with files + `onRemoved` spy | remove `s1` from config; reconcile | `tls/s1/` does not exist; `onRemoved` called once |
| E18 | Tailscale source — MagicDNS normalisation | EP | L1 | automated | fake runner: `status --json` `Self.DNSName:"host.example.ts.net."` | `names()` + `obtain()` | name `host.example.ts.net` (no trailing dot); `cert` argv ends with `host.example.ts.net` |
| E19 | Tailscale source — HTTPS not enabled | state-transition | L1 | automated | fake status reporting HTTPS certs disabled | due attempt; then `tls` config change | `https-certs` gate unmet with admin-console hint; no `cert` argv; failure count unchanged; re-check after 15 min and immediately on config change |
| E20 | Tailscale source — slow issuance | BVA | L1 | automated | fake runner resolving after 30 s; second after 121 s (fake timers) | obtain | 30 s → success; 121 s → timeout error (runner timeout 120 s), not 4 s |
| E21 | Tailscale absent | EP | L1 | automated | runner reports binary missing | reconcile | source not-ready gate; main listener `GET /api/health` 200 |
| E22 | TLS endpoint enumerated and paired | decision-table | L1 | automated | listener bound `0.0.0.0:8443`, advertisable `magicdns` cert `host.example.ts.net` | `GET /api/tunnel/endpoints`; mint pairing payload | endpoints include `{kind:"magicdns",url:"https://host.example.ts.net:8443",tls:true}`; payload `urls[]` includes it; after the cert is removed no TLS endpoint is listed |
| E23 | Port 443 omitted | BVA | L1 | automated | same as E22 with `port:443` (listener stubbed, no real bind) | enumerate | url `https://host.example.ts.net` |
| E24 | Loopback bind suppresses advertisement | decision-table | L1 | automated | listener bound `127.0.0.1`, advertisable cert | enumerate; mint payload | no TLS endpoint; payload lacks URL; gate `bind-reachable` unmet |
| E25 | Non-advertisable / wildcard not enumerated | decision-table | L1 | automated | certs `a.test` (`advertise:false`), `*.b.test` (`advertise:true`) | enumerate | neither appears in endpoints or payload |
| E26 | TLS status disclosure | decision-table | L1 | automated | held cert with `lastError` of 501 chars | `/api/health` as non-local unauthenticated vs genuinely local | non-local: `tls` keys exactly `enabled,bound`; local: detail present, `lastError.length === 500` |
| E27 | Certificate names pass host admission (host gate + same-origin) | decision-table | L1 | automated | `hostGate.mode:"enforce"`, held cert `host.example.ts.net` | request with `Host: host.example.ts.net:8443`; WS upgrade with `Origin: https://host.example.ts.net:8443`; repeat after the name is pruned | admitted / upgrade accepted while held (with `allowedHosts: []`); refused after prune and after `tls.enabled:false`; a `*.example.com` cert does not admit `dash.example.com` |
| E28 | `tlsListenerNames` fail-empty | fault-injection (abort) | L1 | automated | cert store accessor throws | `GET /api/health` on main listener | 200; one warning logged; name not admitted |
| E29 | Gateway TLS panel — gates and hints | state | L1 | automated | client component fed status with `https-certs` and `bind-reachable` unmet + tailscale IPv4 `100.83.0.1` | render | both hints visible; "Use 100.83.0.1" action present; note "connect using the certificate name" present |
| E30 | Gateway TLS panel — one-click host keeps sibling keys | state | L1 | automated | panel with stored `tls:{enabled:true,port:9443,sources:[…]}` | click "Use 100.83.0.1" | PUT body `tls` = stored block with only `host:"100.83.0.1"` changed |
| E31 | `domain` endpoint kind label | EP | L1 | automated | endpoints list containing `{kind:"domain",url:"https://dash.example.com:8443",tls:true}` | render GatewayEndpoints | row labelled "Domain" |
| E32 | Operator-triggered issuance | decision-table | L1 | automated | source `tailscale` with next attempt +160 min; a running issuance; unknown id `nope`; `tls.enabled:false` | `POST /api/tls/issue` | 202 + `obtain()` starts at t≈0; while running: 202, `obtain` count stays 1; unknown → 404; known source + name absent from its list → 404; disabled → 409; no `name` → obtain for missing + failed names only, valid one untouched |
| E33 | Tailscale absent / logged out → `tailscale-running` gate | EP | L1 | automated | runner: `status --json` `BackendState:"NeedsLogin"`; then binary missing | reconcile | gate `{id:"tailscale-running",ok:false}` with hint; runner never invoked with `cert` |
| E34 | Status: next retry time + source details | state | L1 | automated | `obtain` rejects once (fake timers); `Self.TailscaleIPs:["100.83.0.1","fd7a::1"]`; no cert held | local `GET /api/health` | name entry `nextAttemptAt` = failure + 5 min; `tls.sources[0].details.ipv4 === "100.83.0.1"`; no runner call during the read |
| E35 | Gateway section — status mapping | state | L1 | automated | the 8 status fixtures of `mockups/tls.html` (`S.*`) incl. unread status | render `GatewayTlsSection` | pill words Checking… / Off / Setup needed / Getting certificate… / On / On, renewal failing / Failed / Stopped, each with an icon; never "Off" before the first read; unknown running stage → "Working…" |
| E36 | Gateway section — Renew now | state-transition | L1 | automated | ready status; then `stage:"requesting"` | click Renew now | `POST /api/tls/issue {sourceId:"tailscale",name}`; button disabled "Working…" while requesting |
| E37 | Gateway section — port rejected at the field | EP | L1 | automated | PUT answers 400 naming `tls.port` | edit Port to 8000, Apply | input `aria-invalid="true"`; `role=alert` reason linked by `aria-describedby`; one PUT only |
| E38 | Accessible at — kind labels + tokens | EP | L1 | automated | endpoints of kinds local, lan, mesh, magicdns, public, domain | render `GatewayEndpoints`; run `scripts/theme-token-guard.mjs` | labels Local / LAN / Mesh / MagicDNS / Public / Domain on the neutral chip at ≥ 11 px; no hex or `rgba(` in the file; guard: no new violation |
| E39 | Mismatched cert/key pair not served | fault-injection (abort) | L1 | automated | stored cert A + key B for `a.test` (crash between renames) | manager start (load) | `a.test` handshake fails; one warning; `obtain("a.test")` called once |
| E40 | Source unable to list names → no prune | state-transition | L1 | automated | held `host.example.ts.net`; source `names()` → `null` | reconcile | handshake still succeeds; files present; nothing pruned |
| E41 | Backoff survives restart | BVA | L1 | automated | 4 failures; persisted `nextAttemptAt` +80 min | new manager start, fake clock | no attempt before +80 min; attempt at +80 min |
| E42 | Pluggable source types + id rules | decision-table | L1 | automated | test-registered type `fake` (validate rejects `{x:1}`); unregistered `foo`; ids `Bad_Id`, duplicate, omitted for tailscale | `PUT /api/config` | `fake` → 200 + its `create` used; `{x:1}` → 400 with the type's message; `foo` / `Bad_Id` / duplicate → 400; tailscale id defaults to `tailscale` |
| E43 | Exact + wildcard overlap is not a conflict | EP | L1 | automated | `s1` → `dash.example.com`; `s2` → `*.example.com` | reconcile; handshakes | both issued; no `name-conflict`; `dash.example.com` → `s1` cert; `x.example.com` → wildcard |
| E44 | Tailnet HTTPS detection shared by source and funnel gate | decision-table | L1 | automated | status JSON with `Self.CapMap` and `CertDomains` = `null`, `[]`, `["host.example.ts.net"]`, key missing | `tailnetHttpsEnabled`, `checkFunnelGates`, source readiness | `null`/`[]` → `https-certs` unmet in both; non-empty → ok in both; key missing → old heuristic |
| E45 | Host-gate list shows TLS-listener names | EP | L1 | automated | held `host.example.ts.net` | `GET /api/host-gate`; render Security tab | `admitted` has `{host:"host.example.ts.net",source:"tls-listener"}`; row pill `TLS certificate`, Gateway link, no remove control |
| E46 | Unmet gate prevents the attempt | decision-table | L1 | automated | source-wide gate unmet; then gate scoped to `a.test` only | due tick; `POST /api/tls/issue` | no `obtain()` for gated names; `failures` unchanged; `b.test` obtained; reconcile calls `readiness({force:true})` then `onReconciled()` once |
| E47 | Hung attempt abandoned | state-transition | L1 | automated | `obtain` never settles; `attemptTimeoutMs: 1000`; fake timers | advance 1000 ms; trigger; resolve the first promise | first attempt failed `timed out`; new `obtain()` started (not joined); late cert never served; no file written for the stale attempt id |
| E48 | Invalid stored source skipped | EP | L1 | automated | hand-edited config `[{type:"foo"},{type:"tailscale"}]` | server start | gate `invalid-source` naming entry 0; tailscale source runs; main `/api/health` 200 |
| E49 | Switch write failure reverts | state | L1 | automated | `PUT /api/config` answers 500 | toggle switch on | switch back off; inline `role=alert` error; one PUT |
| E50 | Source group registry fallback | EP | L1 | automated | status with sources `tailscale` and unregistered `fake` | render section | tailscale via its registered group; `fake` via generic rows (name, pill, Renew now) |
| E51 | Status lists waiting names | state | L1 | automated | names `[a.test,b.test]`; `a.test` held; `b.test` gated | local `/api/health` | both present; `b.test` without `notAfter`, stage `idle` |
| E52 | Section status converges without reload | state-convergence | L1 | automated | mounted section, status `stage:"requesting"`; next read returns a held cert; one slow read; fake timers | advance 5 s; advance 5 s with a read pending; click Renew now | pill "On" after the first tick (≤ 5 s); no overlapping read; immediate read after Renew now |

### Performance

None — no performance requirement (clarification answer).

### Frontend-quirk

Covered by E29–E31, E35–E38 and E49–E50, E52 (5 s poll convergence, clarified 2026-10-19: poll every 5 s while mounted) (component-level, deterministic props → DOM, fixtures shared with `mockups/tls.html`). Visual states approved on the mockup board (3 themes × 375/1440, `mockups/probe.js`: 0 contrast/size failures).

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | TLS listener failure is isolated — bind | fault-injection (abort) | L1 | automated | `tls.port` already held by another socket (EADDRINUSE) | server start | main `GET /api/health` 200; detailed `tls.bound:false` with error mentioning `EADDRINUSE` |
| X2 | Reconcile failure after config write | fault-injection (abort) | L1 | automated | reconcile throws on rebind | `PUT {tls:{port:<held port>}}` | PUT response 200; config file holds new port; status error set; main listener serving |
| X3 | No plaintext on the TLS port | EP | L1 | automated | — | raw `net` socket sends `GET /api/health HTTP/1.1\r\n\r\n` to TLS port | no bytes containing `HTTP/1.1 200`; socket closed by server within 2 s |
| X4 | Same routes over TLS | EP | L1 | automated | — | `GET /api/health` on main and TLS listener | identical top-level key set; equal `keepAliveTimeout`, `timeout`, `requestTimeout`; oversized header → same 431 body on both |
| X5 | Same guard over TLS | fault-injection (reject) | L1 | automated | caller from non-loopback, untrusted address (listener bound to host's non-loopback IPv4, client connects via it), `trustedNetworks: []` | `GET` a guarded route on both listeners | identical status code (403) and error body on both |
| X6 | WebSocket over wss parity | state-transition | L1 | automated | valid auth vs no auth | WS upgrade to the browser path on TLS listener | authed → `open`; unauthenticated → rejected with the same code as on the main listener |
| X7 | Shutdown closes the TLS listener | state-transition | L1 | automated | one idle keep-alive TLS socket open | `server.stop()` | socket receives `close` within 2 s; new connect refused |
| X8 | Tailscale CLI error surfaced + backoff | fault-injection (abort) | L1 | automated | runner exits 1 with stderr `"cert: version mismatch"` | obtain | `lastError` contains `version mismatch`; next attempt scheduled +5 min |
| X9 | Issue route authorization | fault-injection (reject) | L1 | automated | caller that `PUT /api/config` refuses (non-local, unauthenticated) | `POST /api/tls/issue {sourceId:"tailscale"}` | same refusal status as `PUT /api/config`; `obtain()` not called; `ROUTE_TIERS` has the route (completeness test passes) |
| X10 | Local-credential proof floor per transport | fault-injection (reject) | L1 | automated | proof minted for the main-port binding; proof minted before the TLS listener bound | request + WS upgrade over TLS | both rejected (`binding-mismatch` / `before-start`); proof for the TLS binding after bind accepted |
| X11 | Bind retried until address exists | fault-injection (abort) | L1 | automated | `tls.host` address absent (`EADDRNOTAVAIL` stubbed); fake timers | start; make address available; advance 1 min | `bindError` first; retries +1, +2, +4, +8, +15, +15 min while absent; bound after the address appears, no config change |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | Tailscale certificate source (real tailnet) | exploratory | — | manual-only | tailnet with HTTPS enabled; `tls.host` = Tailscale IPv4 | enable listener; pair phone via `https://<name>.ts.net:8443` | [judgment: real device — pairing completes, browser shows valid cert, `crypto.subtle` available] |

---

## Coverage summary

- Requirements covered: 14/14 (dashboard-tls-listener: 9 requirements; tunnel-provider: 1 modified; host-admission: 2 modified; settings-panel: 1 modified; shared-config: 1 modified — covered by E45 + E27)
- Scenarios by class: edge 52 · perf 0 · frontend (in edge) 11 · error 11
- Scenarios by level: L1 63 · L2 0 · L3 0
- Scenarios by disposition: automated 63 · manual-only 1

## New infra needed

- Committed test-CA + leaf PEM fixtures and their `gen.sh` (openssl) under `packages/server/src/tls/__tests__/fixtures/` — no new dependency.
