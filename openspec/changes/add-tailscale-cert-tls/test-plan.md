# Test Plan — add-tailscale-cert-tls

Stage: design   Generated: 2026-09-28

Clarifications resolved before writing (hard gate): backoff 5 min doubling → cap 6 h; tailnet-HTTPS-disabled re-check every 15 min; TLS covered by L1 vitest integration (real `https` listener on an ephemeral port + injected fake `CertSource`), real tailscale = manual; no performance budget (performance class intentionally empty).

Test certs for L1: committed fixture PEMs (a test CA + leaf certs for `host.example.ts.net`, `*.example.com`, `a.test`, `b.test`, `x.test`; long validity) generated once by a checked-in `openssl` script — Node's `crypto` can parse but not mint X.509. Clients trust the test CA via `ca:`; validity-dependent tests use a fake clock relative to the fixture's `validFrom`/`validTo`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Optional native TLS listener — disabled by default | decision-table | L1 | automated | config with no `tls` block; second config `tls.enabled:false`, `port:8443` | server start | TCP connect to `127.0.0.1:8443` refused in both; `/api/health.tls` = `{enabled:false,bound:false}` |
| E2 | Enabled without usable sources | decision-table | L1 | automated | `tls:{enabled:true,sources:[]}` | reconcile | port not bound; detailed status gates contain `{id:"no-sources",ok:false}` |
| E3 | Unknown source type / duplicate id rejected | EP | L1 | automated | `PUT /api/config` with `sources:[{type:"foo"}]`; then `sources:[{type:"tailscale"},{type:"tailscale"}]` | PUT | HTTP 400, body names `sources[0].type` / duplicate id `tailscale`; config file bytes unchanged |
| E4 | Port validation (D7) | BVA | L1 | automated | `tls.port` ∈ {0, 1, 65535, 65536, = `port`, = `piPort`}; then stored `tls.port:9443` + PUT `port:9443` | PUT | 0/65536/collisions → 400 naming the field; 1 and 65535 → 200; changing main `port` onto stored `tls.port` → 400 |
| E5 | Partial config write preserves sibling keys | state | L1 | automated | stored `tls:{enabled:false,port:9443,sources:[{type:"tailscale"}]}` | `PUT {tls:{enabled:true}}` | stored `tls` = `{enabled:true,port:9443,sources:[{type:"tailscale"}]}` |
| E6 | Certificate selection per SNI name | EP | L1 | automated | store holds `host.example.ts.net` and `*.example.com` | TLS connects with servername `host.example.ts.net`, `dash.example.com`, `a.b.example.com`, `example.com`, `other.test`, and via IP (no SNI) | first two succeed with matching cert subject; the other four fail the handshake (client `error` event, no HTTP response) |
| E7 | Renewal threshold at 1/3 validity | BVA | L1 | automated | cert with 90 d validity; fake clock at 60.1 d elapsed (29.9 d left) and 59.9 d elapsed (30.1 d left) | manager tick | `obtain()` called exactly once — only in the < 1/3 case |
| E8 | Renewal without restart (hot swap) | state-transition | L1 | automated | listener serving cert A; one keep-alive socket open | store swaps to cert B | new connection's peer cert fingerprint = B; existing socket still usable; `process.pid` unchanged |
| E9 | Settings change forces re-issue; legacy meta adopted | decision-table | L1 | automated | held fresh cert with `meta.fingerprint:"f1"`; (a) source fingerprint → `"f2"`; (b) meta without `fingerprint` | reconcile | (a) `obtain()` called once; (b) `obtain()` not called and meta now has `fingerprint:"f1"` |
| E10 | Removed name is pruned | state-transition | L1 | automated | fake source returns `[a.test,b.test]`, both held | source now returns `[a.test]`; reconcile | handshake for `b.test` fails; `b.test` absent from `/api/tunnel/endpoints`; its files under `tls/<sourceId>/` deleted |
| E11 | Name conflict | decision-table | L1 | automated | sources `s1`,`s2` both return `x.test` | reconcile | only `s1.obtain` called; `s2` status gate `{id:"name-conflict",name:"x.test",ok:false}` |
| E12 | Single-flight issuance | state-transition | L1 | automated | scheduled `obtain("x.test")` pending (deferred promise) | `trigger("s1","x.test")` | `obtain` call count stays 1; both awaiters resolve with the same result |
| E13 | Backoff schedule | BVA | L1 | automated | `obtain` always rejects; fake timers | advance time | attempt start offsets 0, +5, +10, +20, +40, +80, +160, +320, +360, +360 min (cap 6 h) |
| E14 | Source-imposed retry delay | BVA | L1 | automated | first failure `RetryAfterError(60 min)` | advance 59 min, then 1 more | no attempt at 59 min; attempt at 60 min |
| E15 | Private key storage | EP | L1 | automated | successful obtain | write | key file mode `0o600`; written via tmp + rename (no partial file observed by a concurrent reader stub) |
| E16 | Keys never exposed | EP | L1 | automated | held cert with known PEM key | `GET /api/config`, `GET /api/health` as local caller | neither body contains `PRIVATE KEY` nor any 40-char slice of the key PEM |
| E17 | Source removal deletes its keys | state-transition | L1 | automated | source `s1` with files + `onRemoved` spy | remove `s1` from config; reconcile | `tls/s1/` does not exist; `onRemoved` called once |
| E18 | Tailscale source — MagicDNS normalisation | EP | L1 | automated | fake runner: `status --json` `Self.DNSName:"host.example.ts.net."` | `names()` + `obtain()` | name `host.example.ts.net` (no trailing dot); `cert` argv ends with `host.example.ts.net` |
| E19 | Tailscale source — HTTPS not enabled | state-transition | L1 | automated | fake status reporting HTTPS certs disabled | obtain; then `tls` config change | `https-certs` gate unmet with admin-console hint; `RetryAfterError` 15 min; config change re-checks immediately (runner called again at t≈0) |
| E20 | Tailscale source — slow issuance | BVA | L1 | automated | fake runner resolving after 30 s; second after 121 s (fake timers) | obtain | 30 s → success; 121 s → timeout error (runner timeout 120 s), not 4 s |
| E21 | Tailscale absent | EP | L1 | automated | runner reports binary missing | reconcile | source not-ready gate; main listener `GET /api/health` 200 |
| E22 | TLS endpoint enumerated and paired | decision-table | L1 | automated | listener bound `0.0.0.0:8443`, advertisable `magicdns` cert `host.example.ts.net` | `GET /api/tunnel/endpoints`; mint pairing payload | endpoints include `{kind:"magicdns",url:"https://host.example.ts.net:8443",tls:true}`; payload `urls[]` includes it |
| E23 | Port 443 omitted | BVA | L1 | automated | same as E22 with `port:443` (listener stubbed, no real bind) | enumerate | url `https://host.example.ts.net` |
| E24 | Loopback bind suppresses advertisement | decision-table | L1 | automated | listener bound `127.0.0.1`, advertisable cert | enumerate; mint payload | no TLS endpoint; payload lacks URL; gate `bind-reachable` unmet |
| E25 | Non-advertisable / wildcard not enumerated | decision-table | L1 | automated | certs `a.test` (`advertise:false`), `*.b.test` (`advertise:true`) | enumerate | neither appears in endpoints or payload |
| E26 | TLS status disclosure | decision-table | L1 | automated | held cert with `lastError` of 501 chars | `/api/health` as non-local unauthenticated vs genuinely local | non-local: `tls` keys exactly `enabled,bound`; local: detail present, `lastError.length === 500` |
| E27 | Certificate names pass host admission (host gate + same-origin) | decision-table | L1 | automated | `hostGate.mode:"enforce"`, held cert `host.example.ts.net` | request with `Host: host.example.ts.net:8443`; WS upgrade with `Origin: https://host.example.ts.net:8443`; repeat after the name is pruned | admitted / upgrade accepted while held; refused after prune |
| E28 | `tlsListenerNames` fail-empty | fault-injection (abort) | L1 | automated | cert store accessor throws | `GET /api/health` on main listener | 200; one warning logged; name not admitted |
| E29 | Gateway TLS panel — gates and hints | state | L1 | automated | client component fed status with `https-certs` and `bind-reachable` unmet + tailscale IPv4 `100.83.0.1` | render | both hints visible; "Use 100.83.0.1" action present; note "connect using the certificate name" present |
| E30 | Gateway TLS panel — one-click host keeps sibling keys | state | L1 | automated | panel with stored `tls:{enabled:true,port:9443,sources:[…]}` | click "Use 100.83.0.1" | PUT body `tls` = stored block with only `host:"100.83.0.1"` changed |
| E31 | `domain` endpoint kind label | EP | L1 | automated | endpoints list containing `{kind:"domain",url:"https://dash.example.com:8443",tls:true}` | render GatewayEndpoints | row labelled "Domain" |

### Performance

None — no performance requirement (clarification answer).

### Frontend-quirk

Covered by E29–E31 (component-level, deterministic props → DOM); no async convergence surface introduced.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | TLS listener failure is isolated — bind | fault-injection (abort) | L1 | automated | `tls.port` already held by another socket (EADDRINUSE) | server start | main `GET /api/health` 200; detailed `tls.bound:false` with error mentioning `EADDRINUSE` |
| X2 | Reconcile failure after config write | fault-injection (abort) | L1 | automated | reconcile throws on rebind | `PUT {tls:{port:<held port>}}` | PUT response 200; config file holds new port; status error set; main listener serving |
| X3 | No plaintext on the TLS port | EP | L1 | automated | — | raw `net` socket sends `GET /api/health HTTP/1.1\r\n\r\n` to TLS port | no bytes containing `HTTP/1.1 200`; socket closed by server within 2 s |
| X4 | Same routes over TLS | EP | L1 | automated | — | `GET /api/health` on main and TLS listener | identical top-level key set |
| X5 | Same guard over TLS | fault-injection (reject) | L1 | automated | caller from non-loopback, untrusted address (listener bound to host's non-loopback IPv4, client connects via it), `trustedNetworks: []` | `GET` a guarded route on both listeners | identical status code (403) and error body on both |
| X6 | WebSocket over wss parity | state-transition | L1 | automated | valid auth vs no auth | WS upgrade to the browser path on TLS listener | authed → `open`; unauthenticated → rejected with the same code as on the main listener |
| X7 | Shutdown closes the TLS listener | state-transition | L1 | automated | one idle keep-alive TLS socket open | `server.stop()` | socket receives `close` within 2 s; new connect refused |
| X8 | Tailscale CLI error surfaced + backoff | fault-injection (abort) | L1 | automated | runner exits 1 with stderr `"cert: version mismatch"` | obtain | `lastError` contains `version mismatch`; next attempt scheduled +5 min |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | Tailscale certificate source (real tailnet) | exploratory | — | manual-only | tailnet with HTTPS enabled; `tls.host` = Tailscale IPv4 | enable listener; pair phone via `https://<name>.ts.net:8443` | [judgment: real device — pairing completes, browser shows valid cert, `crypto.subtle` available] |

---

## Coverage summary

- Requirements covered: 8/8 (dashboard-tls-listener: 7 requirements; tunnel-provider: 1 modified)
- Scenarios by class: edge 31 · perf 0 · frontend (in edge) 3 · error 8
- Scenarios by level: L1 39 · L2 0 · L3 0
- Scenarios by disposition: automated 39 · manual-only 1

## New infra needed

- Committed test-CA + leaf PEM fixtures and their `gen.sh` (openssl) under `packages/server/src/tls/__tests__/fixtures/` — no new dependency.
