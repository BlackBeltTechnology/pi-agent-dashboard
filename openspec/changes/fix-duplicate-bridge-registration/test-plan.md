# Test Plan — fix-duplicate-bridge-registration

Stage: design   Generated: 2026-08-11

Constants pinned at the HARD gate (were spec gaps): **probe window = 5 s**,
**contention record expiry = 60 s**, **refusal log/health rate-limit = 1 per
session id per 5 s**. Existing constants for contrast: `WS_PING_INTERVAL` 60 s,
`HEARTBEAT_TIMEOUT` 180 s, `spawnRegisterTimeoutMs` 30 s (clamp 5–120 s).

Level key: L1 = vitest `packages/server/src/**/__tests__/*.test.ts` ·
L2 = `qa/tests/*.sh|.ps1` (process/CLI, no rendered-UI asserts) ·
L3 = Playwright `tests/e2e/*.spec.ts` (docker harness, port from
`.pi-test-harness.json#dashboardPort` — never hardcode `:18000`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | One live bridge per id | state-transition | L1 | automated | socket A registered for `S`, pongs on demand | socket B sends `session_register` for `S` | `connections.get(S) === A`; B closed; `sendToSession(S,…)` arrives on A only |
| E2 | One live bridge per id | state-transition (illegal edge) | L1 | automated | socket A owns `S`, live | socket B's **first** message is `event_forward` carrying `sessionId: S` (not a register) | B never becomes the routing entry for `S` |
| E3 | One live bridge per id | decision-table | L1 | automated | incumbent socket for `S` in `CLOSED` state | another socket registers `S` | newcomer accepted, becomes entry, not closed, **no probe issued** |
| E4 | One live bridge per id | decision-table | L1 | automated | socket A owns `S` | A re-registers `S` (same socket) | accepted, A remains entry, no probe issued |
| E5 | One live bridge per id | state-transition | L1 | automated | socket A owns `S1`; no socket holds `S2` | A registers `S2` | accepted; existing placeholder cleanup for `S1` applies unchanged |
| E6 | Two-factor probe | BVA (just inside) | L1 | automated | A owns `S`, pongs at t=4.9 s | B registers `S`, probe window 5 s | A keeps entry; A not terminated; B refused |
| E7 | Two-factor probe | BVA (just outside) + decision-table | L1 | automated | A owns `S`, never pongs, `_socket.writable === true` | B registers `S`, 5 s elapses | **A keeps entry**, A not terminated, B refused (busy ≠ dead) |
| E8 | Two-factor probe | BVA (just outside) + decision-table | L1 | automated | A owns `S`, never pongs, `_socket.writable === false` / destroyed | B registers `S`, 5 s elapses | A terminated, entry cleared, **B accepted** as entry for `S` |
| E9 | Two-factor probe | decision-table | L1 | automated | A owns `S`, live | B registers `S` with `isNew:true`, `registerReason:"resume"` | outcome identical to E6 — self-reported fields change nothing |
| E10 | Same-process reconnect | decision-table | L1 | automated | A owns `S`, gateway recorded `pid=4242` | B registers `S` reporting `pid=4242` | B becomes entry; **not** refused, not closed; no probe required |
| E11 | Same-process reconnect | decision-table | L1 | automated | A owns `S`, recorded `pid=4242`, A pongs | B registers `S` reporting `pid=9999` | resolved by probe alone → B refused |
| E12 | Same-process reconnect | state-transition | L1 | automated | entry for `S` held by auto-created placeholder (`source:"unknown"`, no pid) | a socket sends `session_register` for `S` | accepted and becomes entry — a placeholder is never a protected incumbent |
| E13 | Losing socket closed | state-transition | L1 | automated | B refused for `S` | inspect gateway state after refusal | B `CLOSED`; B present under **no** session id in the routing table |
| E14 | Losing socket closed | state-transition | L1 | automated | a socket accepted by `wss` but absent from the routing table | `stop()` | that socket is terminated (`wss.clients` walked, not `connections.values()`) |
| E15 | Identity-scoped cleanup | state-transition (illegal edge) | L1 | automated | A owns entry for `S`; a different socket previously referenced `S` | that other socket closes | entry for `S` still resolves to A |
| E16 | Identity-scoped cleanup | state-transition | L1 | automated | as E15 | that other socket closes | **no** disconnect signalled for `S`; `S`'s heartbeat + reconnect-grace timers unchanged |
| E17 | Identity-scoped cleanup | state-transition | L1 | automated | automation session `S` served by socket A; a different socket previously referenced `S` | that other socket closes | `S` neither unregistered nor finalized (automation run survives) |
| E18 | Identity-scoped cleanup | state-transition | L1 | automated | socket A owns entry for `S` | A closes | cleanup for `S` proceeds exactly as today for that session kind |
| E19 | Session id ↔ one live bridge | state-transition | L1 | automated | two sockets have claimed `S`, contention resolved | inspect routing | exactly one socket routable for `S`; the other closed |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Refused register has no side effects | fault-injection | L1 | automated | refused register carries `sessionFile: F` | B refused for `S` | incumbent session's `sessionFile` is still `F` (the register-time steal never runs) |
| X2 | Refused register has no side effects | fault-injection | L1 | automated | refused register carries a spawn token | B refused for `S` | spawn-register watchdog for that token **still armed** |
| X3 | Refused register has no side effects | fault-injection | L1 | automated | refused register | B refused for `S` | no session-registered event emitted; no ghost/placeholder cleanup ran |
| X4 | Refused register has no side effects | fault-injection | L1 | automated | refused register | B refused for `S` | incumbent's heartbeat + reconnect-grace timers unchanged (no `resetHeartbeat`) |
| X5 | Refused register has no side effects | fault-injection | L1 | automated | socket that does not own `S` | it sends `session_heartbeat` / `model_update` naming `S` | message dropped; incumbent's heartbeat timer and `processMetrics` unchanged |
| X6 | Refused register has no side effects | state-transition | L1 | automated | socket owns `S1`; a different live socket owns `S2` | it registers `S2` (id-change contention) | decision taken **before** `clearByToken/Pid/Cwd`; no pending spawn watchdog disarmed |
| X7 | Refusal is terminal | fault-injection | L1 | automated | B refused for `S` | observe the wire | rejection message naming `S` + reason sent **before** the close |
| X8 | Refusal is terminal | state-transition | L1 | automated | bridge receives a contention rejection for `S` | bridge's reconnect logic runs | no reconnect + re-register for `S`; reason surfaced, not silent |
| X9 | Refusal is terminal | fault-injection (old peer) | L1 | automated | a bridge that ignores the rejection | it re-registers `S` repeatedly for 30 s | refused each time by the same rule; log + health entry emitted **at most once per 5 s** for `S` |
| X10 | Refusal is terminal | fault-injection | L2 | automated | server-spawned duplicate refused for `S` | wait past `spawnRegisterTimeoutMs` | spawn reclaimed by its **server-minted token**; the duplicate pi is gone; incumbent's `.jsonl` has a single writer |
| X11 | Refusal is terminal | fault-injection | L1 | automated | spawn armed from a caller with **no** browser WebSocket (REST resume) | that spawn never registers | reclaim still performed (reclaim not conditional on a browser transport) |
| X12 | Resume (continue) | fault-injection | L1 | automated | session `A`'s `sessionFile` = `F`; a live bridge serves `F` under a **different** id `B` | `POST /api/session/A/resume` mode `continue` | refused with an error naming the already-live session; **no pi spawned** |
| X13 | Resume (continue) | fault-injection | L1 | automated | as X12 | the same resume via the **WebSocket** session-action path | identically refused (both guard sites) |
| X14 | Resume (continue) | decision-table | L1 | automated | `F` recorded against a session whose bridge is gone (zombie) | resume `A` continue | resume proceeds — existing zombie behaviour preserved |
| X15 | Resume (continue) | decision-table | L1 | automated | `F` served by a bridge that neither pongs nor has a writable socket | resume `A` continue | that bridge is not "live"; resume proceeds |
| X16 | Resume (continue) | decision-table | L1 | automated | `F` served by a bridge that does not pong but **is** writable (busy) | resume `A` continue | refused — consistent with E7's contention rule |
| X17 | Resume (continue) | decision-table | L1 | automated | a live session with `sessionFile: undefined` (placeholder) | any resume | that session causes no refusal |
| X18 | Resume (continue) | state-transition | L1 | automated | `F` served by a live bridge | **fork** the session | fork proceeds (new JSONL, new id) — guard does not apply |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Delivery not inferred from openness | state-convergence | L1 | automated | session `S` with a live contention record | `POST /api/session/S/prompt` | not a plain success; response names the bridge state **and** states the prompt *was* delivered (no retry hazard) |
| F2 | Delivery not inferred from openness | decision-table | L1 | automated | session with **no** live bridge | prompt | existing no-bridge failure, unchanged, distinguishable from F1 |
| F3 | Delivery not inferred from openness | decision-table | L1 | automated | session with exactly one live bridge, no record | prompt | plain success, as today |
| F4 | Contention record lifecycle | state-transition | L1 | automated | `S` has a live record; incumbent stays connected | refused spawn reclaimed, **or** 60 s expiry elapses | record cleared while incumbent still connected; next prompt reports success |
| F5 | Contention record lifecycle | state-transition | L1 | automated | `S` has a live record | incumbent disconnects — clean close **or** `terminate()` | record cleared (termination path must clear it too) |
| F6 | Contention observable | state-convergence | L3 | automated | dashboard open on the harness port from `.pi-test-harness.json#dashboardPort`; one refusal provoked | client polls `/api/health` | contended session id appears, then disappears after the 60 s expiry — converges, no stuck badge |
| F7 | Contention observable | state-transition | L1 | automated | ≥1 refusal recorded | `GET /api/health` | cumulative refusal count **and** currently contended id list present; `health-shape.test.ts` extended |
| F8 | Contention observable | state-transition | L1 | automated | a contended session ends or disconnects | `GET /api/health` | id no longer listed; **cumulative count unchanged** |

### Logging

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| L1a | Log refused duplicate | state-transition | L1 | automated | incumbent pid 37660, newcomer pid 17579 | refusal for `S` | one stderr line carrying `S` + both pids, **not** matching `[gateway] session registered: <id> cwd=<cwd>` |
| L2a | Log refused duplicate | BVA (missing value) | L1 | automated | incumbent or newcomer has `pid: undefined` | refusal | line still emitted, missing pid rendered as an explicit unknown placeholder (never omitted, never throws) |
| L3a | Log refused duplicate | decision-table | L1 | automated | ordinary accepted re-register (reconnect / `/reload` / id change) | register accepted | existing registration line logged; **no** contention line |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Two-factor probe | tail-latency | L1 | automated | 200 sequential **uncontended** registers | p95 added latency < 5 ms vs. pre-change baseline (fast path must not pay for the probe) | single run |
| P2 | Two-factor probe | threshold | L1 | automated | one contended register against a silent-but-writable incumbent | register resolves in ≥ 5 s and < 6 s — bounded, never hangs the connection handler | single run |
| P3 | Refusal is terminal | soak | L1 | automated | an old bridge looping refused registers for 5 min | refusal log lines ≤ 60 (1 per 5 s) **and** `/api/health` payload size flat | 5 min |

### Manual

| id | requirement | technique | level | disposition | surface | human action | expected judgment |
|----|-------------|-----------|-------|-------------|---------|--------------|-------------------|
| M1 | End-to-end incident reproduction | exploratory | — | manual-only | live dashboard + two real keepers | resume the same `.jsonl` from a second keeper, then prompt the original session | operator confirms: refusal logged with both pids, duplicate pi reclaimed, original session's transcript grows, exactly one `session registered` per id |

---

## Coverage summary

- Requirements covered: 12/12
- Scenarios by class: edge 19 · error 18 · frontend 8 · logging 3 · perf 3 · manual 1
- Scenarios by level: L1 47 · L2 1 · L3 1 · — 1
- Scenarios by disposition: automated 51 · manual-only 1

## New infra needed

- none. L1 extends `packages/server/src/__tests__/` (new
  `pi-gateway-duplicate-register.test.ts` plus edits to `health-shape.test.ts`);
  L2 extends `qa/tests/`; L3 extends `tests/e2e/` against the harness port from
  `.pi-test-harness.json`. No new harness or level.
