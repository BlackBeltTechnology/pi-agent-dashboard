# Test Plan — harden-peer-address-identity

Stage: design   Generated: 2026-10-22

No clarifications are outstanding. Every Triple is filled from `specs/**` and `design.md`: 5 s selection deadline, ordered batches of 12, at most 8 literals per hostname, at most 8 pairing alternatives, at most 4 move-suggestion challenges, 60 s / focus / resume re-verification, and `409 self_address`.

Fixtures:
- **F** is the pinned fingerprint.
- **L** is this machine's own local fingerprint (proven via `proveLocal`).
- **P** is any other fingerprint.
- **Interfaces:** `en0 192.168.16.220/24`, `bridge102 192.168.64.1/24`, `utun4 100.83.251.119/32`.
- **Remote advert for F:** host `pi-dashboard-31f4-8000.local`, addresses `[192.168.64.1, 172.16.184.1, 192.168.16.203]`.
- **Electron L1 tests** use the fake rig in `packages/electron/src/lib/__tests__/server-windows.test.ts` (`provenBy`, fake sessions and windows), plus new injected `lookup` and `interfaces` ports.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | esw: Foreign identity proofs are classified | decision-table | L1 | automated | proven ∈ {F, L, P, invalid-sig}; localFp ∈ {L, unresolved, none(remote mode)} | `classifyProof` | F→`ok` (all localFp); L+L→`self`; P+L→`foreign`; invalid→`foreign`; any non-F with unresolved→`unverified`; L with none→`foreign` |
| E2 | esw: Proof and use are bound to the same address | EP | L1 | automated | stored ref `http://pi-dashboard-31f4-8000.local:8000`; lookup → [`192.168.64.1` (proves L), `192.168.16.203` (proves F)] | `sw.open(F)` | `/api/device-session` fetched only at `http://192.168.16.203:8000`; window loaded `http://192.168.16.203:8000/`; keyring host healed to the literal; zero fetches to the hostname origin |
| E3 | esw: Proof and use bound (resolution cap) | BVA | L1 | automated | lookup returns 7, 8, 9 literals for one name | build candidates | 7 → 7 probed; 8 → 8; 9 → exactly 8 probed (the 9th never challenged) |
| E4 | esw: https keeps its name | EP | L1 | automated | stored ref `https://studio.example:443` | `sw.open(F)` | lookup port not called for it; challenge and window use `https://studio.example` |
| E5 | esw: Candidates ordered by locality | EP+BVA | L1 | automated | interfaces above; literals [`10.9.9.9`, `172.16.184.1`, `192.168.64.1`, `192.168.16.203`, `fe80::5%en0`] | `orderByLocality` | order: `192.168.16.203` (on-link, /24 from netmask) before off-link `10.9.9.9`/`172.16.184.1`; own `192.168.64.1` last; `%en0` stripped; nothing dropped (length 5) |
| E6 | esw: IPv6 prefix from netmask, not fixed /64 | BVA | L1 | automated | interface `2001:db8:0:1::5/56`; literals `2001:db8:0:ff::1` (inside /56, outside /64) and `2001:db8:1::1` | `orderByLocality` | `2001:db8:0:ff::1` classed on-link; `2001:db8:1::1` off-link |
| E7 | esw: ordered batches of 12 | BVA | L1 | automated | advert with 13 off-link literals then on-link `192.168.16.203` (proves F); all others unreachable within 50 ms | `pickHost` (fake timers) | a second batch runs; F opens at `192.168.16.203` within 5 s; with 0 literals before it, it is in batch 1 |
| E8 | esw: Locality flag never hides the pinned server | EP | L1 | automated | advert fp F with `isLocal: true` (overlap); advert fp L | `advertsFor(F)`, `advertsFor(L)` | F advert returned; L advert excluded |
| E9 | mdns: browsing locality veto | decision-table | L1 | automated | ownFingerprint ∈ {L, undefined}; advert fp ∈ {L, P, none}; addresses overlap local ∈ {yes, no} | `isLocalService` | fp P + overlap + own L → `false`; fp L + no overlap → `false` (clone listed); fp L + overlap → `true`; own undefined → old heuristic (overlap ⇒ true) |
| E10 | mdns: virtual-bridge exclusion | EP | L1 | automated | interfaces en0, utun3, docker0, bridge102 `192.168.64.1`, vmnet1, vboxnet0 | `resolveAdvertisedAddresses("0.0.0.0")` | `[192.168.16.31, 100.83.1.2]` (already in the working tree) |
| E11 | known-servers: self_address on add | decision-table | L1 | automated | caller ∈ {operator, non-operator}; target proves ∈ {own fp, F (pinned), G}; entry ∈ {new, pinned F} | `POST /api/known-servers` | operator + own → `409 self_address`, list unchanged; non-operator → guard refusal, 0 challenges sent; pinned F + G (not own) → `409 identity_changed` |
| E12 | known-servers: backfill skips self | EP | L1 | automated | unpinned entry whose challenge proves own fp | backfill | entry still has no `fingerprint` |
| E13 | known-servers: move suggestion walks addresses | EP+BVA | L1 | automated | pinned F; stored address fails; advert lists [`192.168.64.1` (proves own), `192.168.16.203` (proves F)]; second case: 5 eligible addresses, F only at the 5th | move selector | case 1: suggestion `192.168.16.203`; case 2: no suggestion and exactly 4 challenges sent |
| E14 | lkp + esw: knock target reaches this machine | EP | L1 | automated | advert F, alternatives [`192.168.64.1` (proves L), `192.168.16.203` (proves F)] | `startPairing` | no mismatch state; `/api/pair/request` posted only to `192.168.16.203`; saved keyring host = `192.168.16.203` |
| E15 | lkp: pairing hostname resolved to literals | EP | L1 | automated | primary ref `pi-dashboard-31f4-8000.local`; lookup returns `192.168.16.203` on call 1 and `192.168.64.1` on later calls | `startPairing` through approval | knock and every poll go to `192.168.16.203`; lookup called once |
| E16 | lkp: pairing alternatives exhausted / foreign | decision-table | L1 | automated | alternatives all ∈ {L, unreachable}; another run with one proving P | `startPairing` | first: `unreachable`, no knock; second: `mismatch`, no knock |
| E17 | G1–G3 invariants over generated layouts | property (seeded generator, 500 seeds) | L1 | automated | random interface tables (2–6 ifaces, shared bridge IPs, VPN /8 overlapping the LAN /24, IPv6-only variants) × random adverts (1–20 literals, F at a random index or absent, random L/P/unreachable answers) | `sw.open(F)` then 3 re-verifications | (G1) F proven somewhere before the deadline ⇒ window `live` at a literal that proved F, no mismatch; (G2) every `/api/device-session` request targets a literal that proved F in that selection; (G3) no mismatch when no candidate proved P/invalid; a mismatch whenever P answered and none proved F |

### Frontend-quirk (window state machine)

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | esw: re-selection (scheduled path) | state-transition | L1 | automated | window `live` at A; A now proves L; B proves F | advance 60 s | `about:blank` loaded, then `clearStorageData({storages:["cookies"]})` awaited, then the old window is closed and the new window loads `http://B/`; 0 notices; log `host moved` |
| F2 | esw: re-selection (focus and resume triggers) | state-transition | L1 | automated | same as F1 | emit `focus` after 60 s; call resume cb | same outcome as F1 for each trigger |
| F3 | esw: re-selection (credential path) | state-transition | L1 | automated | window at A; `/api/` response 401; A proves P; nothing proves F | 401 event | no `/api/device-session` to A; state `blanked`; one notice "identity mismatch"; timers stopped (no prove calls during the next 600 s) |
| F4 | esw: transport failure re-selects | state-transition | L1 | automated | window at A; A unreachable; B proves F | advance 60 s | page not blanked before the move; new window loads B; with B also unreachable: page stays, title contains "not reachable", retry at the next trigger |
| F5 | esw: only self or nothing answers | state-transition | L1 | automated | A proves L; every other candidate unreachable | advance 60 s, then 60 s again with B now proving F | first: state `parked`, blank, "not reachable", 0 notices, timers alive; second: window replaced at B |
| F6 | esw: parked window reopened by user | state-transition (illegal→legal edge) | L1 | automated | window `parked` | `sw.open(F)` | `focusExisting` does not focus it; the window is replaced and re-verified from scratch |
| F7 | esw: same-origin pick is a no-op | state-transition | L1 | automated | window `live` at A; A transport-fails once; `pickHost` picks A | advance 60 s | no window replacement, no cookie clear, title cleared after the next good proof |
| F8 | esw: own fingerprint not yet known | state-transition | L1 | automated | localFp unresolved; A proves L (unknown yet) | advance 60 s | no notice, no mismatch log, retry; after `resolveLocalFp()` → next trigger classifies `self` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | esw: cookie removal failure loads nothing | fault-injection (abort) | L1 | automated | `clearStorageData` rejects | re-verification with A proving L and B proving F | no `loadURL` to any origin this cycle; error logged; state `parked`; next trigger retries and succeeds when the fake recovers |
| X2 | esw: lookup stalls | fault-injection (delay) | L1 | automated | lookup for the `.local` name resolves after 6 s; stored literal B proves F | `sw.open(F)` | opens at B within 5 s; the hostname counts as unreachable |
| X3 | esw: lookup throws | fault-injection (abort) | L1 | automated | lookup rejects `ENOTFOUND` | `sw.open(F)` with no other candidate | `unreachable` result, no mismatch, no exchange |
| X4 | esw: exchange refused after a move | fault-injection | L1 | automated | A proves L; B proves F; exchange at B → 401 | re-verification | keyring entry marked needs-pairing; re-pair offer shown; no window loads B |
| X5 | esw: observability without secrets | invariant | L1 | automated | runs of E2, F1, F3, E14 | collect logs | lines `candidate skipped … reason=self`, `foreign proof …`, `host moved …` present; none contain the bearer, a cookie value or a code |
| X6 | cross-machine: two dashboards sharing a bridge IP | fault-injection (environment) | L3 | automated | two harness containers A and B on a shared multicast network, each with a dummy interface `bridge0` = `192.168.64.1/24` | both servers advertise; A's operator adds `192.168.64.1:8000`; A lists `/api/servers/discover` | neither advert lists `192.168.64.1`; A sees B with `isLocal:false`; the add returns `409 self_address` and A's `knownServers` is unchanged |
| X7 | cross-machine: real Macs | manual check | — | manual-only | iMac + MacBook 2 (both with `bridge102 192.168.64.1`) running the built Electron app | pair the MacBook from the iMac, leave the window open 10 min, toggle Wi-Fi once | window stays authenticated (or moves) with no "identity mismatch" in `$TMPDIR/pi-dashboard-electron.log` [judgment: real hardware network stack] |

---

## Coverage summary

- **Requirements covered:** 13/13. The electron-server-windows delta has 8 (2 modified + 6 added); lan-knock-pairing 1; known-servers 3; mdns-discovery 2.
- **By class:** edge 17 · frontend-quirk 8 · error 7 · perf 0 (latency is bounded by the existing 5 s deadline and asserted in E7 and X2).
- **By level:** L1 30 · L3 1 · manual 1.
- **By disposition:** automated 31 · manual-only 1.

## New infra needed

- **Two-container mDNS harness (X6):** a compose overlay `docker/compose.test.peer.yml`, modelled on the sidecar pattern in `docker/compose.test.acme.yml`. It needs:
  - a second dashboard service on a user-defined bridge network with multicast enabled;
  - `cap_add: NET_ADMIN`, so the entrypoint can `ip link add bridge0 type dummy && ip addr add 192.168.64.1/24 dev bridge0` in both containers;
  - port attach recorded in `.pi-test-harness.json` (`peerDashboardPort`).

  The spec lives at `tests/e2e/peer-shared-bridge.spec.ts`; its exemplar is `tests/e2e/known-server-stale-name.spec.ts`.
