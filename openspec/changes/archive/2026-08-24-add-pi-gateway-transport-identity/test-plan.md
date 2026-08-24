# Test Plan — add-pi-gateway-transport-identity

Stage: design   Generated: 2026-08-14

Values resolved at the clarification gate (previously unfillable slots):

| slot | value |
|---|---|
| provisional registration TTL / move handshake budget | **30s** |
| promotion detection | **on-demand + 60s poll** |
| registration-vs-transfer observable | **ordering invariant (L1) + 1s wall-clock (L2)** |
| unauthenticated TCP deprecation horizon | **unresolved — see Known open risks** |

Scenario emphasis follows the defect record: the areas that produced B1–B6 —
rendezvous identity, lock ownership, socket bind serialization and the move
handshake — carry the densest adversarial coverage, because fixes there have
already failed review twice.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | socket path fallback (D15) | BVA | L1 | automated | configDir yielding socket path of 103 / 104 / 105 bytes on macOS | resolve local endpoint | ≤104 → socket path returned; 105 → loopback fallback returned AND diagnostic names the length limit, not `EINVAL` |
| E2 | per-instance path (D2) | EP | L1 | automated | piPort 9999 and 9594, same HOME | resolve socket path for each | two distinct paths, both under the same config dir |
| E3 | instance id survives restart (D14/B1) | state-transition | L1 | automated | instance on piPort 9999, id file written | stop, start again on 9999 | `instanceId` identical to the pre-restart value |
| E4 | instance id distinguishes instances | EP | L1 | automated | instances on 9999 and 9594 | read each `instanceId` | values differ |
| E5 | id file permissions | BVA | L1 | automated | fresh HOME | create instance id file | file mode `0600`, containing dir `0700` |
| E6 | health field naming (B1 regression) | decision-table | L1 | automated | running instance | `GET /api/health`, then run `isLockHolderResponsive` | health exposes `instanceId` (not `identity`); the probe reads the SAME field and returns `alive-match`, never falling through to the PID branch |
| E7 | endpoint precedence (D3) | decision-table | L1 | automated | one row per reachable combination of `PI_DASHBOARD_SOCKET`, `PI_DASHBOARD_URL`, pinned identity, record, paired remote, mDNS candidate | resolve endpoint | the highest-precedence present source wins in every row; mDNS never wins any row |
| E8 | mDNS may not override (D3) | decision-table | L1 | automated | pinned `PI_DASHBOARD_URL` + a reachable mDNS candidate advertising a different host | resolve endpoint | pinned endpoint chosen; candidate recorded as suggestion only |
| E9 | absent record ≠ discovery (D2) | state-transition | L1 | automated | no rendezvous record for current HOME | resolve endpoint | reports "no local dashboard available"; no discovered candidate substituted |
| E10 | unreadable ≠ absent (B2) | decision-table | L1 | automated | record file present, unreadable (mode `000`) | resolve / attempt takeover | takeover refused; condition reported distinctly from "absent" |
| E11 | partial record (D15) | BVA | L1 | automated | record truncated mid-JSON | resolve endpoint | treated as absent; never partially trusted |
| E12 | stickiness (D4) | decision-table | L1 | automated | bridge registered with X; candidate Y with verifying identity; rows over {pinned, failed} | attempt re-target | re-target only when unpinned AND failed AND identity verifies; all other rows keep X |
| E13 | bridge serves only own session (D12) | EP | L1 | automated | bridge owning session A | transcript request naming session B | refused; no data for B returned |
| E14 | no path on the wire (D12) | EP | L1 | automated | request carrying `../../etc/passwd` as a path field | bridge receives it | refused; no filesystem read attempted |
| E15 | origin namespacing (D12) | EP | L1 | automated | two hosts each with a session at cwd `/Users/robson/Project/x` | both registered with one dashboard | sessions remain distinct; each attributable to its originating device |
| E16 | Windows loopback pin (D6) | decision-table | L1 | automated | `--host 0.0.0.0` on Windows | start bridge listener | listener bound to `127.0.0.1` only |
| E17 | POSIX binds no bridge TCP port | EP | L2 | automated | default `pi-dashboard` start on macOS/Linux | inspect listening sockets | no TCP listener on the gateway port at all |
| E18 | socket ownership (D5) | BVA | L1 | automated | bound gateway socket | stat socket and dir | socket `0600`, dir `0700` |
| E19 | `ws+unix` client dial (B-defect 2 regression) | EP | L1 | automated | `ConnectionManager` constructed per the change | dial `ws+unix://<path>:/` | connection opens; a build that falls back to `globalThis.WebSocket` fails this test |
| E20 | provisional TTL boundary (D11) | BVA | L1 | automated | provisional registration opened | commit at 29s / at 31s | 29s → commit accepted; 31s → provisional already discarded, commit refused |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | registration not blocked (ordering) | invariant | L1 | automated | remote join with a 44 MB transcript pending | register-ack timestamp < transfer-complete timestamp | single run |
| P2 | registration not blocked (wall clock) | tail-latency | L2 | automated | remote join, 44 MB transcript | prompt accepted within **1s** of register-ack | 20 runs, p95 |
| P3 | remote-join at p99 transcript size | tail-latency | L2 | automated | remote join, ~4 MB transcript | register-to-usable p95 recorded as a baseline | 20 runs |
| P4 | socket transport parity | timed unit | L1 | automated | 1000 messages through the send ring over UDS vs TCP | UDS p95 not worse than TCP p95 by >20% | single run |
| P5 | promotion poll churn | soak | L2 | automated | 3 attach-mode instances, 60s poll, owner alive throughout | zero spurious promotions; lock acquisitions bounded by poll count | 10 min |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | move renders as moved (D11) | state-transition | L3 | automated | session live on origin dashboard | complete a move to target | origin card converges to *moved*, never *crashed*/dead |
| F2 | gateway transport surfaced (D10 / `address()`) | state-convergence | L3 | automated | dashboard running on a UDS listener | open settings | gateway endpoint displayed; not blank — guards `address()` returning a string for UDS |
| F3 | ended remote session hides resume (D13) | state-transition | L3 | automated | remote session whose bridge has ended | view the session | resume is not presented as an available action |
| F4 | origin converges without reload (D11) | state-convergence | L3 | automated | origin dashboard open in a browser | move completes | origin view reaches *moved* with no manual reload |
| F5 | session origin displayed (D12) | state-convergence | L3 | automated | session originating on another host | view session list | originating device shown |
| F6 | pre-attach history renders (D12) | state-convergence | L3 | automated | remote session with entries predating the bridge attach | open transcript | pre-attach entries present in the rendered transcript |
| F7 | `where` reports endpoint/identity/pinned (D11) | state-transition | L2 | automated | bridge registered with an instance | run `/dashboard where` | prints current endpoint, instance id, and pinned status |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | live socket never unlinked (B3) | fault-injection | L1 | automated | socket path already bound by a live listener | second instance starts | startup aborts with a conflict naming the path; incumbent stays bound; its bridges undisturbed |
| X2 | concurrent bind serialized (B3) | race | L1 | automated | two instances race to bind one path | simultaneous start | exactly one binds; the other aborts with a conflict; no live socket file removed |
| X3 | indeterminate probe fails closed (B3) | fault-injection | L1 | automated | live listener with a saturated backlog returning `ECONNREFUSED` | probe before unlink | path NOT removed; startup aborts |
| X4 | takeover is acquire-then-verify (B2) | race | L1 | automated | two starters both observe the same dead holder | simultaneous takeover | exactly one owner results; neither deletes the other's live lock or fresh record |
| X5 | crashed owner is recovered (B2) | fault-injection (abort) | L2 | automated | record owner killed with SIGKILL, one attach instance alive | wait | survivor promotes within **60s**; an unpinned bridge then resolves to the survivor, not the dead endpoint |
| X6 | clean shutdown keeps a default (B2) | state-transition | L2 | automated | owner stops cleanly, one attach instance alive | shutdown completes | survivor promotes; HOME still has a resolvable default |
| X7 | move refusal spares the origin (B4) | fault-injection | L1 | automated | target refuses the provisional registration (different-pid branch) | attempt move | origin remains registered and serving; origin's `intentionalClose` never set |
| X8 | move commit never arrives (B4) | fault-injection (delay) | L1 | automated | target accepts provisional, then goes silent | wait past 30s | provisional discarded; origin never stopped owning the send ring; no message lost or duplicated |
| X9 | provisional does not claim routing (B4) | invariant | L1 | automated | live bridge on session A; provisional registration for A | provisional registers | `connections.get(A)` still maps to the origin socket; origin's sends still delivered |
| X10 | provisional is not an enumeration oracle (B4) | fault-injection | L1 | automated | provisional registrations for one existing and one non-existent sessionId | compare refusals | responses indistinguishable to the caller, or ownership proof required before either answers |
| X11 | revoked device locked out (D7) | fault-injection | L1 | automated | paired bridge device revoked | attempt ticket mint and register | ticket refused and registration refused, with a distinct reason |
| X12 | impostor at the expected address (D8) | fault-injection | L1 | automated | server at the pinned address cannot answer the nonce challenge | remote bridge connects | registration refused with a fingerprint-mismatch reason |
| X13 | ticket misuse (D7) | decision-table | L1 | automated | tickets that are reused / expired / wrong-scope | present on upgrade | each refused, and the three reasons are distinguishable in logs |
| X14 | tokenless loopback (D6) | fault-injection | L1 | automated | Windows bridge connects with no `X-Pi-Local-Token` | upgrade | refused, distinctly from a wrong-token refusal |
| X15 | wrong token (D6) | fault-injection | L1 | automated | Windows bridge presents an incorrect token | upgrade | refused; reason distinguishable from "missing" |
| X16 | stale record, foreign listener (D14) | fault-injection | L1 | automated | record names a port now held by an unrelated process | bridge dials it | refused with an **identity mismatch**, not a generic connection failure; a valid local token does not bypass it |
| X17 | filesystem without UDS support (D15) | fault-injection | L2 | automated | HOME on a filesystem where socket bind fails | start dashboard | falls back to loopback + token; log names the actual cause; never falls back to discovery |
| X18 | transfer interrupted mid-flight (D12) | fault-injection (abort) | L1 | automated | bridge dies during transcript transfer | inspect stored transcript | partial data is not presented as complete; the gap is detectable |
| X19 | resume refused for ended remote session (D13) | state-transition | L1 | automated | remote session whose bridge has ended | `POST /api/session/:id/resume` | refused with an explanation naming host unreachability; a local session is unaffected |
| X20 | unauthenticated gateway registration (D7) | fault-injection | L1 | automated | unauthenticated peer on the TCP gateway | attempt `session_register` for an arbitrary sessionId | refused — the inversion of the hole this change closes |

### Manual-only

| id | requirement | technique | level | disposition | surface | human action | expected observable |
|----|-------------|-----------|-------|-------------|---------|--------------|---------------------|
| M1 | Windows credential readability (D6, task 5.5) | platform verification | — | manual-only | `~/.pi/dashboard/local/token`, `identity.key`, `paired-devices.json` on a real Windows host | log in as a second standard OS user and attempt to read each file | [judgment: requires a second Windows account; not available in CI. `chmod` is a documented no-op on Windows, so this guarantee rests on inherited NTFS ACLs and must be observed, not asserted] |

---

## Coverage summary

- Requirements covered: 18/18
- Scenarios by class: edge 20 · perf 5 · frontend 7 · error 20 · manual 1
- Scenarios by level: L1 38 · L2 8 · L3 6 · — 1
- Scenarios by disposition: automated 52 · manual-only 1

## New infra needed

- **None new in kind.** All three existing tiers are reused: vitest `__tests__`,
  `qa/tests/*.sh|*.ps1`, and Playwright `tests/e2e/*.spec.ts` against the docker
  harness (port read from `.pi-test-harness.json` `dashboardPort`, never
  hardcoded).
- Two harness capabilities must be *extended*, not created: a Windows arm under
  `qa/tests/windows-*.ps1` for E16/X14/X15, and a multi-instance fixture able to
  start two dashboards under one HOME on different gateway ports (X1–X6).

## Known open risks

- **No deprecation horizon for the unauthenticated TCP bridge path** (task 8.5).
  Deferred at the clarification gate. There is therefore no scenario asserting
  the fallback ever closes, and nothing prevents the "temporary" compatibility
  path from becoming permanent. Revisit before the change archives.
- **Three mechanisms remain unproven in code** — lockfile acquire-then-verify
  (X2/X4), provisional registration (X7–X10), promotion detection (X5/X6).
  Their scenarios are written as falsification attempts precisely because the
  designs there have already failed adversarial review twice.
