# Test Plan — warn-unreachable-trusted-networks

Stage: design   Generated: 2026-08-12

Clarifications C1–C4 were resolved at the HARD gate and folded into the specs
before this manifest was written; no `NEEDS CLARIFICATION` markers remain.

- **C1** → `GET /api/config` gains a top-level `reachability` object.
- **C2** → `console.warn` line prefixed `[bind-reachability]`, matching `[openspec-poll]` / `[hydration]`.
- **C3** → pushed as a `ServerToBrowserMessage`, mirroring `display_prefs_updated` (+ replay on connect).
- **C4** → reuse the Settings header's existing Restart affordance; no new notice component.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | predicate | BVA | L1 | automated | bind `127.0.0.1`, entries `["192.168.1.0/24"]` | predicate evaluated | returns `["192.168.1.0/24"]` |
| E2 | predicate | BVA | L1 | automated | bind `10.0.0.5`, entries `["192.168.1.0/24"]` | predicate evaluated | returns `["192.168.1.0/24"]` |
| E3 | predicate | BVA | L1 | automated | bind `192.168.1.42`, entries `["192.168.1.0/24"]` | predicate evaluated | returns `[]` |
| E4 | predicate | BVA | L1 | automated | bind `192.168.1.0`, entries `["192.168.1.0/24"]` (network address, lower boundary) | predicate evaluated | returns `[]` |
| E5 | predicate | BVA | L1 | automated | bind `192.168.1.255`, entries `["192.168.1.0/24"]` (broadcast, upper boundary) | predicate evaluated | returns `[]` |
| E6 | predicate | BVA | L1 | automated | bind `192.168.2.1`, entries `["192.168.1.0/24"]` (just outside upper) | predicate evaluated | returns `["192.168.1.0/24"]` |
| E7 | predicate | decision-table | L1 | automated | bind `0.0.0.0`, entries `["192.168.1.0/24","10.0.0.*","1.2.3.4"]` | predicate evaluated | returns `[]` for every entry |
| E8 | predicate | decision-table | L1 | automated | bind `10.0.0.5`, entry `127.0.0.1` | predicate evaluated | returns `[]` — loopback exemption precedes containment |
| E9 | predicate | EP | L1 | automated | bind `127.0.0.1`, entries `["127.0.0.1","127.0.0.2","127.0.0.*","127.0.0.0/8"]` | predicate evaluated | returns `[]` for all four |
| E10 | predicate | EP (invalid partition) | L1 | automated | bind `127.0.0.1`, entry `127.0.0.0/7` | predicate evaluated | returns `["127.0.0.0/7"]` — matches `126.x`, not loopback-only |
| E11 | predicate | decision-table | L1 | automated | bind `::`, entries `["192.168.1.0/24"]` | predicate evaluated | returns `[]` — non-IPv4 literal fails open |
| E12 | predicate | decision-table | L1 | automated | bind `myhost.local`, entries `["192.168.1.0/24"]` | predicate evaluated | returns `[]` — hostname fails open |
| E13 | predicate | EP | L1 | automated | bind `10.0.0.5`, entries `["10.0.*.*","192.168.1.*"]` | predicate evaluated | returns `["192.168.1.*"]` only |
| E14 | predicate | EP | L1 | automated | bind `127.0.0.1`, entries `[]` and `undefined` | predicate evaluated | returns `[]`, no throw |
| E15 | predicate | EP (invalid) | L1 | automated | entry `not-an-ip`, `999.1.1.1`, `10.0.0.0/33` | predicate evaluated | entries skipped, not reported unreachable, no throw |
| E16 | predicate union | decision-table | L1 | automated | `trustedNetworks:["192.168.1.0/24"]`, `auth.bypassHosts:["10.0.0.0/8"]`, bind `127.0.0.1` | predicate evaluated | both returned — union of the two sources |
| E17 | pendingEffectiveHost | decision-table | L1 | automated | draft edit `0.0.0.0`, saved `127.0.0.1`, resolved `127.0.0.1` | resolve input | returns `0.0.0.0` (draft wins) |
| E18 | pendingEffectiveHost | decision-table | L1 | automated | no draft, config `0.0.0.0`, no flag/env, resolved `127.0.0.1` | resolve input | returns `0.0.0.0` |
| E19 | pendingEffectiveHost | decision-table | L1 | automated | `--host 127.0.0.1`, config `bindHost 0.0.0.0` | resolve `pendingBindHost` | returns `127.0.0.1` — flag wins on next start too |
| E20 | pendingEffectiveHost | decision-table | L1 | automated | `PI_DASHBOARD_HOST=0.0.0.0`, config default `127.0.0.1` | resolve both values | both `0.0.0.0` — container case, no presence flag needed |
| E21 | interface suggestions | decision-table | L1 | automated | `utun4` `100.97.246.31`/`255.255.255.255` | derive suggestions | `pointToPoint:true`, no `100.97.246.31/32` offer, one `{value:"100.64.0.0/10", wide:true}` |
| E22 | interface suggestions | decision-table | L1 | automated | `en0` `192.168.10.123`/`255.255.255.0` | derive suggestions | one `{value:"192.168.10.0/24", wide:false}` |
| E23 | interface suggestions | decision-table | L1 | automated | `/32` at `203.0.113.7` (no well-known containing range) | derive suggestions | `pointToPoint:true`, `suggestions: []` |
| E24 | interface suggestions | EP | L1 | automated | `/32` at `172.20.0.5` and at `10.9.9.9` | derive suggestions | `172.20.0.0/16` and `10.0.0.0/8`, both `wide:true` |
| E25 | endpoint completeness | decision-table | L1 | automated | `en0` `192.168.10.123/24` + `en7` `192.168.10.224/24` | endpoint response built | two entries, both addresses present |
| E26 | dropdown dedupe | decision-table | L1 | automated | the two entries from E25 | dropdown rows derived | one row, value `192.168.10.0/24`, label of the first entry in response order |
| E27 | dropdown dedupe | decision-table | L1 | automated | two `/32` p2p interfaces, different addresses, both suggesting `100.64.0.0/10` | dropdown rows derived | one row `100.64.0.0/10` |
| E28 | label fallback | EP | L1 | automated | interface matching no well-known range | label derived | `label === name` |
| E29 | range table parity | decision-table | L1 | automated | address `100.97.246.31` | containing range derived from interface path AND block-event path | both yield `100.64.0.0/10` |
| E30 | computed field stripped | decision-table | L1 | automated | `PUT /api/config` body echoing `reachability` | write persisted | `reachability` absent from written config.json |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | advisory | state-convergence | L3 | automated | bind `127.0.0.1`, `auth.bypassHosts` `["192.168.1.0/24"]` | open Settings → Security | advisory visible, naming `127.0.0.1` and `192.168.1.0/24` |
| F2 | advisory | state-convergence | L3 | automated | bind `0.0.0.0`, same entries | open Settings → Security | advisory absent |
| F3 | advisory | state-transition | L3 | automated | bind `127.0.0.1`, no entries | add `192.168.1.0/24`, do NOT save | advisory converges to visible without a save or reload |
| F4 | advisory | state-transition | L3 | automated | advisory visible | activate "Listen on all interfaces" | advisory converges to absent; draft `bindHost` is `0.0.0.0`; config.json unchanged |
| F5 | remediation | state-transition | L3 | automated | advisory visible on Security | activate the inline control | Save Bar dirty chip names **Server**, not Security |
| F6 | remediation | decision-table | L3 | automated | advisory visible on Security | inspect the Security page | listen-interface picker NOT rendered there; navigation link to Server present |
| F7 | remediation | state-transition | L3 | automated | advisory visible | activate the navigation link | app is at `/settings/server`; unsaved Security edits still present |
| F8 | coexistence | decision-table | L3 | automated | bind `10.0.0.5`, entries `["192.168.1.0/24"]`, one recorded denial from `10.0.0.9` | open Settings → Security | BOTH advisory and block-event banner rendered; advisory above |
| F9 | placement | decision-table | L3 | automated | advisory condition holds | render Trusted Networks section | advisory sits between section description and entry list |
| F10 | restart signal | state-transition | L3 | automated | saved `bindHost` `0.0.0.0`, server not restarted | open Settings | header Restart affordance indicates pending restart |
| F11 | restart signal | state-convergence | L3 | automated | pending restart indicated | server restarts, `resolvedBindHost` becomes `0.0.0.0` | indication converges to cleared |
| F12 | WS push | state-convergence | L3 | automated | browser connected, `pendingBindHost` `127.0.0.1` | `pendingBindHost` becomes `0.0.0.0` server-side | client converges to the new value with no reload and no panel reopen |
| F13 | WS replay | state-transition | L3 | automated | `pendingBindHost` already `0.0.0.0` | a browser socket connects afterwards | receives current `reachability` on connect |
| F14 | dropdown | decision-table | L3 | automated | host with a Tailscale `/32` interface | open "+ Add Local Network" | row labelled as tailnet (not `utun4`), offering `100.64.0.0/10` marked wide; no `<self>/32` offer |
| F15 | dropdown | decision-table | L3 | automated | `/32` interface with no derivable range | open "+ Add Local Network" | row shown, non-selectable, with an explanation |
| F16 | picker unaffected | decision-table | L3 | automated | two NICs on one subnet | open Server → listen-interface picker, Specific interface | both addresses selectable |
| F17 | guard unchanged | decision-table | L3 | automated | advisory visible | issue a request that the guard would deny | still denied, same `network_not_allowed` shape as before |
| F18 | exposure warning intact | decision-table | L3 | automated | bind `0.0.0.0`, no providers and no trusted entries | open Server page | existing all-interfaces exposure warning still shown |
| F19 | advisory a11y | state-transition | L3 | automated | advisory absent, screen-reader semantics observed | add an unreachable entry | advisory is announced as a status message when it appears |
| F20 | advisory visual polish | visual/subjective | — | manual-only | Security page, both themes | human looks at advisory + block-event banner together | [judgment: amber ramp reads correctly in light and dark, banners do not fight] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | failure isolation | fault-injection (abort) | L1 | automated | reachability computation throws | `GET /api/config` served | response still 200; remaining config fields present; `reachability` omitted or null |
| X2 | topology disclosure | fault-injection (probe) | L1 | automated | reachability populated with `192.168.1.0/24` | `GET /api/health` served | body contains no `resolvedBindHost`, no `pendingBindHost`, no trusted-entry value |
| X3 | endpoint guard | fault-injection (remote caller) | L1 | automated | request from a non-loopback IP | `GET /api/network-interfaces` | 403 |
| X4 | interface enumeration | fault-injection (abort) | L1 | automated | `os.networkInterfaces()` throws | endpoint served | error surfaced without crashing the server |
| X5 | dropdown fetch | fault-injection (abort) | L3 | automated | `/api/network-interfaces` returns 500 | user opens "+ Add Local Network" | dropdown degrades without breaking the section; manual entry still usable |
| X6 | WS push | fault-injection (delay) | L3 | automated | browser socket dropped, then reconnects | `pendingBindHost` changed while disconnected | client converges to the current value after reconnect via replay |

### Process / startup

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| S1 | startup log | state-transition | L2 | automated | config bind `127.0.0.1`, `auth.bypassHosts` `["192.168.1.0/24"]` | server starts | exactly one `[bind-reachability]` warn line, containing `127.0.0.1` and `192.168.1.0/24` |
| S2 | startup log | state-transition | L2 | automated | bind `0.0.0.0`, same entries | server starts | no `[bind-reachability]` line |
| S3 | container default | decision-table | L2 | automated | `PI_DASHBOARD_HOST=0.0.0.0`, no `bindHost` in config.json, trusted entries present | server starts in the docker harness | no `[bind-reachability]` line; `reachability.unreachable` empty |

---

## Coverage summary

- Requirements covered: 8/8
- Scenarios by class: edge 30 · frontend 20 · error 6 · process 3
- Scenarios by level: L1 34 · L2 3 · L3 21 · manual-only 1
- Scenarios by disposition: automated 58 · manual-only 1
- Total: 59

## New infra needed

- **none.** L1 extends existing vitest suites; L2 extends `qa/tests/`; L3 extends
  `tests/e2e/` against the docker harness. S3 requires the harness to start with
  `PI_DASHBOARD_HOST` at its shipped default, which `docker/compose.yml:38`
  already provides — no override mechanism needs building.
