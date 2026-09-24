# Test Plan — harden-ios-safari-memory-and-ws-diagnostics

Stage: design   Generated: 2026-09-23

No clarifications needed: every Triple resolves from the delta specs and design (30 s interval, 2 unanswered pings, 60 s window, 256 keys, 900 KB gz cap, marker `mdiZodiacAquarius`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | client-build-config: @mdi/js dedicated chunk, out of entry | graph invariant | L1 | automated | production `dist/` | walk `index.html` entry + `modulepreload` + transitive static `import"./x.js"` | no chunk in the landing graph contains `mdiZodiacAquarius`; ≥1 emitted chunk outside it does; gz `index` ≤ 900 KB |
| E2 | client-build-config: No @mdi/js dynamic-import warning | log assertion | L1 | automated | `npm run build` log | build completes | zero lines matching `dynamic import will not move module` + `@mdi/js` |
| E3 | client-build-config: Icon-by-key resolves arbitrary keys | EP | L1 | automated | keys `mdiRefresh` (valid), `mdiTotallyMadeUpName` (unknown), `"refresh"` (bad prefix), `""`, `null` | `loadMdiIconSet()` then `resolveMdiIconSync(key)` | valid → non-empty SVG path string; the other four → `null`, no throw |
| E4 | client-build-config: key-resolved icon renders nothing until loaded | state-transition | L1 | automated | `ActionList` action with `icon:"mdiRefresh"`; icon set not yet loaded | first render, then load resolves | first render: no `<svg>` and no placeholder element in the action; after resolve: `<svg>` with the `mdiRefresh` path |
| E5 | same, per surface | state-transition | L1 | automated | `StatusPill` with `icon:"mdiCheck"` | mount → load resolves | no svg → svg with `mdiCheck` path |
| E6 | same + extension-ui-system unknown key | EP | L1 | automated | `GenericExtensionDialog` module `icon:"mdiCheck"`, action `icon:"mdiTotallyMadeUpName"` | mount → load resolves | module header shows the `mdiCheck` svg; action button has no svg and no error |
| E7 | same, footer segments (hook per segment) | EP | L1 | automated | 3 footer-segment decorators: `mdiCheck`, unknown key, no icon | mount → load resolves | segment 1 has svg, segments 2–3 have none; each segment still renders its text; no React hooks-order warning |
| E8 | Browser close line: code/reason/lifetime/frames/cause | EP | L1 | automated | browser ws connects, sends 3 frames, closes with `1000` / `"bye"` | server `close` | exactly one line: `code=1000 reason="bye" lifetime=<n>s frames=3 cause=peer` with the `[browser-gw] browser client disconnected (remaining:` prefix |
| E9 | Close reason cannot break the line | BVA (hostile input) | L1 | automated | close reason `a"b\nc` (≤123 bytes) | client closes | the line contains no raw newline; reason appears JSON-escaped `"a\"b\nc"` |
| E10 | Keepalive: one missed ping tolerated | state-transition | L1 | automated | fake timers, `browserPingIntervalMs=1000`; client suppresses the pong for tick 1 only | advance 4 ticks | socket still open; no `cause=keepalive` line |
| E11 | Keepalive: responsive client stays | state-transition | L1 | automated | fake timers; client auto-pongs | advance 10 ticks | socket open; ≥10 pings observed client-side |
| E12 | Rejection logger: header names only, no values | EP | L1 | automated | 403, scope `browser`, peer `127.0.0.1`, headers `x-forwarded-for: 203.0.113.9`, `cookie: sid=SECRET` | `log(...)` | line contains `status=403 scope=browser peer=127.0.0.1 fwd=x-forwarded-for ticket=absent`; does not contain `203.0.113.9` or `SECRET` |
| E13 | Rejection logger: ticket presence, never value | EP | L1 | automated | 401 with ticket `tkt-abcdef123` | `log(...)` | line contains `ticket=present`; does not contain `tkt-abcdef123` |
| E14 | Rejection logger: rate limit window | BVA | L1 | automated | injected clock; same key rejected 20× at t=0..59 s, then once at t=60 s | `log(...)` ×21 | exactly 2 lines total; the second carries `suppressed=19` |
| E15 | Rejection logger: state bounded | BVA | L1 | automated | 1000 distinct peers, one rejection each | `log(...)` ×1000 | tracked keys ≤ 256 |
| E16 | Upgrade wiring: forwarded /ws rejected 403 is logged once | decision table | L1 | automated | real server, no auth secret; upgrade `/ws` from loopback with `X-Forwarded-For` | WS upgrade | response 403; exactly one `[ws-upgrade] rejected status=403 scope=browser` line with `fwd=x-forwarded-for` |
| E17 | Upgrade wiring: auth-secret 401 logged | decision table | L1 | automated | server with auth secret; upgrade `/ws` with no cookie | WS upgrade | 401 and one `[ws-upgrade] rejected status=401` line |
| E18 | Upgrade wiring: bridge-scope 400 logged, ticket not consumed | decision table | L1 | automated | upgrade to the bridge path on the dashboard port with a valid single-use ticket | WS upgrade | 400, one `status=400` line with `ticket=present`; the same ticket is still consumable afterwards |
| E19 | Already-logged rejections not double-logged | decision table | L1 | automated | upgrade refused by the host gate (bad `Host`) and one refused by the cross-origin `[ws-gate]` | WS upgrade | each produces its existing `[host-gate]` / `[ws-gate]` line and zero `[ws-upgrade]` lines |
| E20 | mobile-resilience: running tool group collapsed on mobile | decision table | L1 | automated | `ToolBurstGroup` with a running member, `toolGroupDefaultCollapsed:false`, `MobileProvider` + `matchMedia` → mobile | render | body not mounted; live header (running indicator, count) visible |
| E21 | same: tap expands on mobile | state-transition | L1 | automated | E20 state | click header, then member completes | body mounted and stays mounted after the running→done flip |
| E22 | same: desktop unchanged | decision table | L1 | automated | as E20 but desktop | render | body auto-mounted while running (existing behaviour) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | client-build-config: cold landing excludes full icon set | threshold | L3 | automated | cold load of `/` on the docker harness (derived port from `.pi-test-harness.json`), no extension-UI icon on screen | zero requests to any chunk containing the full icon set (identified by filename from the build manifest step or content probe); total JS bytes requested on landing strictly below the pre-change baseline recorded in tasks | until `networkidle` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | client-build-config: icon set loads once | convergence | L1 | automated | 5 components resolving different keys mount in the same tick | load resolves | the dynamic import runs exactly once (spy count 1); all 5 icons render |
| F2 | client-build-config: lazy icon works in real browser | convergence | L3 | automated | harness session with an extension footer segment/decorator carrying an MDI icon key (reuse the extension-ui fixture if one exists; otherwise the flows plugin StatusPill) | open the session | the icon `<svg>` appears; exactly one request for the lazy icon chunk |
| F3 | iOS Safari no longer reloads on cold open / streaming | observational | — | manual-only | iPhone Safari via tunnel, large (≥2 MB) transcript | cold-open the session, stream one turn, background and foreground the tab | [judgment: no spontaneous full-page reload; server log shows `cause=keepalive`/`cause=peer` lines as expected; reported on #712] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | client-build-config (design D1): icon chunk import fails | fault-injection (abort) | L1 | automated | mocked dynamic import rejects once, then succeeds | `useMdiIconByKey("mdiCheck")` mounts; a second mount after the failure | first: renders nothing, no unhandled rejection; second mount: import retried and icon renders |
| X2 | Keepalive: unresponsive client terminated | fault-injection (abort) | L1 | automated | fake timers, interval 1000; client never pongs (pong handler removed) | advance 3 ticks | socket closed by the server on tick 3 (not 2); exactly one disconnect line with `cause=keepalive code=1006` |
| X3 | Close line: abrupt peer drop | fault-injection (abort) | L1 | automated | client socket's underlying TCP destroyed (`ws._socket.destroy()`) | — | one line `code=1006 reason="" … cause=peer` |
| X4 | Close line: stalled byte-ceiling terminate | fault-injection (delay) | L1 | automated | existing stalled-socket fixture (pending bytes over the ceiling) | flush attempt | one disconnect line with `cause=stalled` |
| X5 | Keepalive timer cleared on server close | state-transition | L1 | automated | gateway with 1 client; fake timers | terminate clients, `wss.close()`, then advance 5 ticks | zero pings after close; no pending interval (`vi.getTimerCount()` back to baseline) |

---

## Coverage summary

- Requirements covered: 7/7 (browser-ws-diagnostics ×3, client-build-config ×1, mobile-resilience ×1, plus design D1 failure path and the #712 outcome)
- Scenarios by class: edge 22 · perf 1 · frontend 3 · error 5
- Scenarios by level: L1 28 · L2 0 · L3 2
- Scenarios by disposition: automated 30 · manual-only 1

## New infra needed

- none. L1 reuses the vitest server/client suites; L3 reuses the docker harness with `tests/e2e/lazy-feature-bootstrap.spec.ts` as the network-recording exemplar.
