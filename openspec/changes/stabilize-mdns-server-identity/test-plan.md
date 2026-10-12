# Test Plan — stabilize-mdns-server-identity

Stage: design   Generated: 2026-10-11

No clarifications outstanding: every Triple is filled from `specs/**` and `design.md` (60 s sweep, 3 missed sweeps, 10 min suggestion TTL, 60 s per-`(fp, port)` challenge rate, 3 s DNS + 2 s HTTP probe budget, 3 publish attempts 5 s apart, 4 KiB challenge body cap).

Operator fixtures: "operator" = a request carrying a valid local token / login session from a **non-loopback** peer (loopback is genuinely-local and therefore operator — `pairing-routes.ts:95-125`); "non-operator" = peer `192.168.16.50` admitted only by `trustedNetworks: ["192.168.16.0/24"]`, or a paired-device bearer.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | mdns: Advertised hostname is owned by the dashboard (valid DNS label) | BVA | L1 | automated | fingerprint `sha256:AAAA…`, ports 1, 8000, 65535 | derive names | instance `pi-dashboard-<12 hex>-<port>`, host `….local`; first label matches `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`, length ≤ 63 for port 65535 |
| E2 | mdns: Two servers on one machine do not collide | EP | L1 | automated | same fingerprint, ports 8000 and 8001 | derive names | the two instance names and hostnames differ |
| E3 | mdns: Names are stable across restarts and renames | state-transition | L1 | automated | same fingerprint + port; stubbed `os.hostname()` returns `mac-1.local` then `mac-2.local` | advertise twice | both registered packets have identical instance name and SRV target |
| E4 | mdns: Operating-system hostname is not contested | EP | L1 | automated | stubbed `os.hostname()` = `Roberts-MacBook-Pro-8559.local` | advertise, inspect registered packet | no `A`/`AAAA` record name and no SRV target equals `Roberts-MacBook-Pro-8559` or `….local` |
| E5 | mdns: Advertised addresses are limited to served interfaces | decision-table | L1 | automated | interfaces {en0 `192.168.16.31` + `fe80::1`, utun3 `100.83.1.2`, docker0 `172.17.0.1`, lo0 `127.0.0.1`}; bindHost ∈ {`192.168.16.31`, `0.0.0.0`, `::`, `dash.local`→[`192.168.16.31`,`10.9.9.9`], `nohost.invalid` (lookup fails), `127.0.0.1`} | resolve + advertise | respectively [`192.168.16.31`]; [`192.168.16.31`,`100.83.1.2`]; same; [`192.168.16.31`]; no advert + log; no advert |
| E6 | mdns: Server mDNS advertisement (TXT) | decision-table | L1 | automated | version `0.9.0`; `dashboardName` set to `Studio` / unset with hostname `home-imac-75340.local` | advertise | TXT `version=0.9.0`, `fp=<fingerprint>`, `pid`, `piPort`; `name=Studio` / `name=home-imac-75340` |
| E7 | mdns: mDNS service browsing (local host literal) | EP | L1 | automated | local peer addresses [`fe80::1`,`192.168.1.5`]; IPv6-only local peer [`2001:db8::5`] | `serviceToServer` | `host` = `192.168.1.5`; `host` = `2001:db8::5` and `formatHostPort` gives `[2001:db8::5]:8000` |
| E8 | design D4 `formatHostPort` / `normalizeHostKey` | EP | L1 | automated | `Home.LOCAL.`, `home.local`, `[::1]`, `::1`, `192.168.1.5` | normalize / format with port 8000 | first two keys equal; `[::1]`/`::1` keys equal; formatted `home.local:8000`, `[::1]:8000`, `192.168.1.5:8000` |
| E9 | mdns: Two servers sharing an identity are two peers | state-transition | L1 | automated | fake browser emits `up` for fp F port 8000 and port 8001, then `down` for 8000 | continuous browse | peer map holds 2 entries, then only the 8001 peer; one `server-down` |
| E10 | mdns: Older server without identity fields | EP | L1 | automated | TXT `{version,pid,piPort}` without `fp` | `serviceToServer` | result has no `fingerprint` key; other fields as before |
| E11 | known-servers: Known servers persisted in config | decision-table | L1 | automated | raw `knownServers` [{fp `sha256:x`}, {fp `md5:y`}, {fp 42}, two entries with same `(sha256:z, 8000)`] | `parseKnownServers` | fp kept on first; field dropped on 2nd/3rd (entries kept); duplicate collapsed to the first |
| E12 | known-servers: Fingerprint survives reload and rewrite | state-transition | L1 | automated | config with entry pinned `sha256:x` | add another entry, remove it, reload | pinned entry still carries `sha256:x` |
| E13 | known-servers: REST API to add a known server (operator decision table) | decision-table | L1 | automated | operator; prover stub per row: new entry proves F; new entry fails; existing pinned F fails; hint F proves G (new); `(F,8000)` holder elsewhere still proves F; holder dead; target pinned F proves G | `POST /api/known-servers` | F pinned; no fp; F kept; G pinned, hint not stored; `409 already_known`, no write; holder host updated + `{updated:true}`, label replaced only for non-empty label, `addedAt` unchanged; `409 identity_changed {expected:F, proven:G}`, no write |
| E14 | known-servers: Non-operator add/remove/accept/probe refused | decision-table | L1 | automated | non-operator fixtures (trusted-network peer; paired-device bearer) | POST, DELETE, accept-move, probe | each refused (401/403), prover and fetch stubs called 0 times, `knownServers` byte-identical |
| E15 | known-servers: List states whether the caller may manage | EP | L1 | automated | non-operator / operator | `GET /api/known-servers` | `canManage:false` / `canManage:true`; entries identical in both |
| E16 | known-servers: Server-side reachability probe (mapping) | decision-table | L1 | automated | lookup ENOTFOUND; lookup NXDOMAIN after 2.5 s; lookup hangs > 3 s; ECONNREFUSED; HTTP hangs > 2 s; 200 `{ok:true}`; 302 to `http://169.254.169.254/`; 404; 200 `text/html` | probe a persisted entry | `name-not-resolved`; `name-not-resolved`; `timeout`; `refused`; `timeout`; `reachable`; `error` + redirect target never requested; `error`; `error` |
| E17 | known-servers: Unknown target refused | EP | L1 | automated | `{host:"10.0.0.1",port:22}` not in `knownServers` | operator probe | refused; fetch and lookup stubs called 0 times |
| E18 | known-servers: Concurrent probes of one entry collapse | EP | L1 | automated | entry `home.local:8000`; probes for `Home.local`, `home.local.` while one in flight | 3 concurrent probes | one outbound lookup/fetch; all three get the same result |
| E19 | known-servers: Unpinned reachable entry is backfilled | decision-table | L1 | automated | unpinned `192.168.16.220:8000` proving F; second case: another entry `(F, 8000)` at dead `home-imac-75112.local` | probe reports reachable | entry gains F; second case: verified entry kept with F, stale one removed, log names `home-imac-75112.local` |
| E20 | known-servers: Advertisement alone pins nothing | EP | L1 | automated | unpinned entry `192.168.16.220:8000`; prover stub fails | fake browser `up` with TXT fp F at that address | `knownServers` unchanged (no fingerprint) |
| E21 | known-servers: Verified move suggestion (decision table) | decision-table | L1 | automated | entry pinned F at `home-imac-75112.local:8000`; server iface `192.168.16.0/24`; rows: stored proves F; stored fails + peer `192.168.16.220` proves F; peer fails; entry unpinned; peer only `10.9.9.9`; peer `127.0.0.1`/`fe80::5`/`0.0.0.0`/`224.0.0.1` | `up` for peer fp F port 8000 | none; suggestion `movedTo {host:peer host, port:8000}` + `move-suggested` log; none; none; no challenge sent + skip log; no challenge sent |
| E22 | known-servers: suggestion rate + lifecycle | state-transition | L1 | automated | suggestion recorded at t0 (fake clock) | second `up` at t0+30 s; stored proves at t1; peer `down`; t0+10 min without re-verify; new unit instance (restart) | no second challenge before t0+60 s; withdrawn (+ log) in each of the next three cases; restart → no suggestion, config unchanged |
| E23 | known-servers: Operator accepts a move suggestion | decision-table | L1 | automated | suggestion for F; rows: both re-verifications hold; suggested now fails; stored proves again | operator accept-move | host/port updated, label/fp/`addedAt` unchanged, log `moved fp=<16 chars, no sha256: prefix> old -> new`; refused + unchanged; refused + unchanged |
| E24 | server-selector: Cross-origin CORS-blocked probe is distinct from Unreachable | decision-table | L1 | automated | known entry `home-imac-75340.local:8000`; browser fetch rejects; server probe ∈ {reachable, name-not-resolved, name-not-resolved+`movedTo`, refused, timeout, error, refused-by-guard}; separate row: fetch 403 `network_not_allowed` | open dropdown | CORS/network hint (`data-cors-blocked`); "Name not found"; "Moved to …" + Update (calls accept-move); "Unreachable" ×4; "Network not allowed"; every non-available row has `aria-disabled` |
| E25 | known-servers: Settings panel network discovery section | decision-table | L1 | automated | known entry `(F, 8000)` at `old.local`; discovered peers: fp F at `new.local:8000`; fp-less at `old.local:8000`; fp G with name `Studio` | scan, click Add, confirm | "Already added"; "Already added"; label input prefilled `Studio`, POST body carries `fingerprint:G`; `{updated:true}` response shows "updated existing entry" |
| E26 | known-servers: Settings panel known servers section | EP | L1 | automated | list `canManage:false` / `canManage:true` with an entry carrying `movedTo` | render Servers section | no add/remove/Update controls / controls present, `movedTo` address shown with Update |
| E27 | mdns: Copy of this server's identity on another machine is listed | decision-table | L1 | automated | own fp F port 8000; peers: (F, 8000, isLocal) ; (F, 8000, remote); fp-less local port 8000 | server `peerServers` on `up` | excluded; listed; excluded (legacy rule) |
| E28 | mdns: Advertised fingerprint matches the identity challenge | EP | L1 | automated | temp identity file; server routes via `fastify.inject` | advertise (captured TXT) then `proveServerIdentity` against the inject base | TXT `fp` === proven fingerprint |
| E29 | known-servers: REST API for on-demand mDNS scan + selfServer | EP | L1 | automated | peerServers with fp/name; own identity | `POST /api/discover-servers`; browser connect | response rows carry `fingerprint`,`name`; `servers_discovered.self` carries own `fingerprint`,`name` |
| E30 | bridge-extension (unchanged) adoption with literal host | EP | L1 | automated | discovered local server, derived hostname, addresses [`192.168.1.5`]; IPv6-only [`2001:db8::5`] | `firstVerifiedLocal` with stubbed `isDashboardRunning` | adopted host `192.168.1.5`; probe URL `http://[2001:db8::5]:8000/api/health` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | known-servers: probe budget (design D7) | tail-latency (bound) | L1 | automated | probe target whose lookup resolves at 2.9 s and HTTP hangs | response time ≤ 5.2 s (3 s DNS + 2 s HTTP + 0.2 s slack), fake timers | single call |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | mdns: Silently vanished peer is removed | state-transition | L1 | automated | peer P listed; injected sweep browse omits P | sweeps 1, 2, 3, then P reappears in sweep 4 | P still listed after sweeps 1–2; exactly one `server-down` after sweep 3; `server-up` on sweep 4 |
| F2 | mdns: Updated advertisement refreshes the peer | state-transition | L1 | automated | peer P with addresses [`192.168.1.5`] | sweep returns P with [`192.168.1.9`]; separately a `txt-update` adding `fp` | one update event, peer addresses/host updated, no down/up; peer gains `fingerprint` |
| F3 | mdns: Address change is re-advertised | state-transition | L1 | automated | advertised set [`192.168.16.31`] | sweep re-resolves [`192.168.16.40`]; next sweep same set | unpublish then publish with [`192.168.16.40`]; no republish on the unchanged sweep |
| F4 | server-selector: probes once per open (existing invariant) | state-transition | L1 | automated | 2 known entries, one failing in browser | open, close, reopen dropdown; keep closed 60 s | per open: 2 browser fetches + 1 server probe; closed: 0 calls |
| F5 | server-selector: Stale hostname is named as such (rendered) | state-transition | L3 | automated | harness with known server `stale-zz9-unresolvable.local:8000` seeded via operator API (`x-pi-local-token`) | open the header server dropdown in an operator browser context | entry text "Name not found", entry `aria-disabled="true"`, no `data-cors-blocked` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | design D5 `proveServerIdentity` | fault-injection (abort/delay) | L1 | automated | challenge endpoint returns 500; hangs; 302; 5 KiB body; body fp ≠ key; bad signature | `proveServerIdentity(base,{timeoutMs:2000})` | refused in each; hang refused within 2.1 s; redirect never followed; two calls send different nonces |
| X2 | mdns: records override fail-closed (design D2) | fault-injection | L1 | automated | publish seam returns a service with `published = true` | advertise | service unpublished, verdict "not advertising", log line |
| X3 | mdns: Name conflict at startup is retried | fault-injection | L1 | automated | `published` stays false (attempts 1–3); second fixture succeeds on attempt 2 | advertise with fake timers | 3 publish attempts 5 s apart then warning naming instance + `identity.key`; second fixture: 2 attempts, no warning |
| X4 | mdns: Teardown withdraws the advertised records | fault-injection | L1 | automated | advertised with overridden addresses | `stopAdvertising()` | goodbye packet (TTL 0) contains derived names and the overridden addresses only |
| X5 | design D6 serialized write queue | fault-injection (delay) | L1 | automated | add challenge resolves after a DELETE of the same entry; same for accept-move and backfill | interleave via deferred promises | deleted entry never recreated; final config equals the DELETE result |
| X6 | known-servers: add challenge outside the queue | fault-injection (delay) | L1 | automated | add challenge hangs | concurrent DELETE of another entry | DELETE completes before the add resolves; add responds within 2.1 s storing no fingerprint |
| X7 | known-servers: Fingerprint survives reload (malformed input) | fault-injection | L1 | automated | `knownServers` entry with `fingerprint: "sha256:"`, `{}`, `null` | load config | entries kept, fingerprint field dropped, no throw |
| X8 | mdns: mixed-version LAN | fault-injection | L1 | automated | old-format peer (OS-name instance, no fp) and new peer (fp) from the same machine; old stops without goodbye | sweeps | two peers listed; old removed after 3 missed sweeps; new unaffected |

### Manual-only

| id | requirement | technique | level | disposition | surface | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------|---------|---------------------|
| M1 | mdns: Operating-system hostname is not contested (real mDNSResponder) | hardware | — | manual-only | two Macs on one LAN running this change | sleep/wake both, wait 1 h | `scutil --get LocalHostName` unchanged; no new `multicast conflict` lines for host records [judgment: real multicast + OS responder, not reproducible in CI] |
| M2 | known-servers: move suggestion end-to-end | hardware | — | manual-only | iMac entry pinned in Electron | rename the iMac's Bonjour name | selector shows "Moved to … — Update"; Update restores switching [judgment: needs two physical machines] |
| M3 | mdns: advert visible to OS tooling | hardware | — | manual-only | local run | `dns-sd -B _pi-dashboard._tcp` + `dns-sd -L` | instance `pi-dashboard-<12 hex>-8000` with `fp` in TXT [judgment: OS tool output] |

---

## Coverage summary

- Requirements covered: 17/17 (mdns-discovery 5, known-servers 11, server-selector 1)
- Scenarios by class: edge 30 · perf 1 · frontend 5 · error 8 · manual 3
- Scenarios by level: L1 43 · L2 0 · L3 1
- Scenarios by disposition: automated 44 · manual-only 3

## New infra needed

- none (fake bonjour browser/publish seams and an injectable sweep scheduler are part of the implementation tasks; the L3 row reuses the docker harness and `tests/e2e/helpers/bridge-credential.ts`).
