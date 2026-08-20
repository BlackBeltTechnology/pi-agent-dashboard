# Test Plan — fix-spawn-correlation-ttl-coupling

Stage: design   Generated: 2026-06-12

All three clarification gaps (ORDERING_MARGIN_MS, drop-report bound, pending-ack
eviction) were resolved before this file was written. No open markers.

Fixed values this plan assumes: `RECOVERY_GRACE_MS = 60_000`,
`ORDERING_MARGIN_MS = 5_000`, timeout clamp `[5_000, 120_000]`, drop-report
bound `10 per session per 60_000 ms`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Token TTL derived (spawn-correlation) | BVA | L1 | automated | `spawnRegisterTimeoutMs = 30_000`, correlation recorded | read TTL used for the entry | TTL === 95_000 (30k+60k+5k), not 60_000 |
| E2 | Token TTL derived | BVA | L1 | automated | timeout at lower bound `5_000` | correlation recorded | TTL === 70_000; recovery window still 60_000, not shrunk |
| E3 | Token TTL derived | BVA | L1 | automated | timeout at upper bound `120_000` | correlation recorded | TTL === 185_000 |
| E4 | Token TTL derived | BVA | L1 | automated | timeout `90_000`, entry recorded at t=0 | probe consume at t=89_999 ms (fake timers) | resolves to the recorded `requestId` |
| E5 | Token TTL derived | BVA | L1 | automated | timeout `90_000`, entry recorded at t=0 | probe consume at t=155_001 ms | returns undefined (evicted by its own TTL) |
| E6 | No literal governs the TTL | static | L1 | automated | `pending-client-correlations.ts` source | assert no `60_000`/`DEFAULT_TTL_MS` governs entries | the module exposes no hardcoded governing TTL constant |
| E7 | One config read per spawn | decision-table | L1 | automated | armed from a read of `120_000`; config lowered to `30_000` before `record()` | record the correlation | TTL derived from `120_000` (185_000), not from `30_000` |
| E8 | One config read per spawn | decision-table | L1 | automated | armed from `30_000`; config raised to `120_000` before `record()` | record the correlation | TTL derived from `30_000` (95_000) — arm and TTL agree |
| E9 | All three recording paths | decision-table | L1 | automated | timeout `90_000`, correlation recorded on the resume/fork path and on the degrade path | consume at t+70s | both resolve; neither uses a 60_000 literal |
| E10 | Fork registry derives expiry | BVA | L1 | automated | timeout default `30_000`, fork entry recorded | consume at t+29_000 ms | entry still consumable (today's 30_000 makes this a coin-flip) |
| E11 | Fork registry derives expiry | BVA | L1 | automated | timeout `90_000`, fork entry recorded | consume at t+70_000 ms | entry still consumable |
| E12 | Attach registry keeps its bound | decision-table | L1 | automated | timeout raised to `120_000` | inspect the pending-attach expiry | unchanged at 60_000 — NOT widened |
| E13 | Resume-intent keeps its bound | decision-table | L1 | automated | timeout raised to `120_000` | inspect the pending-resume-intent expiry | unchanged at 60_000 — NOT widened |
| E14 | Correlation survives the fire | state-transition | L1 | automated | armed spawn with a recorded correlation | watchdog timer fires | correlation entry still present after the fire |
| E15 | Consumed exactly once | state-transition | L1 | automated | fired entry with token + correlation | `clearByToken` then the register broadcast path | watchdog does not consume; broadcast consumes; `session_added` carries `spawnRequestId` |
| E16 | `recentlyFired` single index | decision-table | L1 | automated | two same-cwd spawns, distinct tokens, both fire | `clearByToken` for the first | one recovery emitted; the second's entry intact |
| E17 | `recentlyFired` single index | decision-table | L1 | automated | fired entry that HAS a token | `clearByCwd` for its cwd | no recovery emitted; token entry survives |
| E18 | One fire → at most one recovery | state-transition | L1 | automated | fired entry reachable by token | `clearByToken` then `clearByCwd` | exactly one `spawn_register_recovered` |
| E19 | Recovered message shape | decision-table | L1 | automated | fired token-bearing entry with a recorded `requestId` | late `clearByToken` | emitted message has no `requestId` field |
| E20 | cwd normalization | decision-table | L1 | automated | arm with `/tmp/x` (symlinked to `/private/tmp/x`) | clear with `/private/tmp/x` | watchdog cancelled |
| E21 | cwd normalization fallback | decision-table | L1 | automated | arm with a non-existent path | clear with the identical raw string | watchdog cancelled; no throw |
| E22 | Tier-aware clear | decision-table | L1 | automated | spawns A and B armed for the same cwd, distinct tokens | A registers with its token | A cancelled; **B still armed** and still fires |
| E23 | Tier-aware clear | decision-table | L1 | automated | token-less tmux spawn armed by cwd | register with cwd only | cancelled via the cwd tier |
| E24 | `hidden` from the signal | decision-table | L1 | automated | `hasUI:false`, `source:"tui"`, `dashboardSpawned:true`, first register, no intent | register | stored `hidden === false` |
| E25 | `hidden` from the signal | decision-table | L1 | automated | `hasUI:false`, no `dashboardSpawned`, first register, no intent | register | stored `hidden === true` |
| E26 | `hidden` precedence | decision-table | L1 | automated | `hasUI:false`, no signal, `visibilityIntent:"visible"` | register | `hidden === false` (intent wins) |
| E27 | `hidden` precedence | decision-table | L1 | automated | prior record `hidden:true`, `registerReason:"reattach"`, `hasUI` undefined | register | `hidden` stays `true`; heuristic not consulted |
| E28 | Signal normalization | BVA | L1 | automated | `dashboardSpawned` arriving as `"yes"` / `1` / `{}` | register | coerced to a strict boolean; a non-`true` value does not un-hide |
| E29 | Signal plumbing | decision-table | L1 | automated | `session_register` carrying `dashboardSpawned:true` | gateway forwards to `register` | the value reaches `register` params (not `undefined`) |
| E30 | Prompt response fields | decision-table | L1 | automated | live bridge, contention record present | `POST /api/session/:id/prompt` | response has NO `delivered:true`; reports transmitted; contention warning retained |
| E31 | Prompt response fields | decision-table | L1 | automated | live bridge, no contention | same POST | reports transmitted; `success === true` |
| E32 | Prompt response fields | decision-table | L1 | automated | no OPEN socket for the id | same POST | not transmitted; `success === false`; HTTP 502 as today |
| E33 | Drop-report bound | BVA | L1 | automated | connected bridge, 100 drops inside one 60_000 ms window | flood the pump | at most 10 reports emitted; suppression conveyed when the channel permits |
| E34 | Pending-ack eviction | BVA | L1 | automated | timeout `30_000`; prompt transmitted, never acknowledged | advance fake timers past 95_000 ms | pending entry evicted |
| E35 | Pending-ack eviction | state-transition | L1 | automated | prompt pending acknowledgement | session unregisters | pending entry evicted immediately |
| E36 | Failure-log join key | decision-table | L1 | automated | token-bearing entry fires | inspect the appended `REGISTER_TIMEOUT` | entry includes that `spawnToken` |
| E37 | Recorded timeout is the effective one | BVA | L1 | automated | watchdog constructed with `30_000`, entry armed with `90_000` | entry fires | logged line AND persisted entry both name `90_000` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | cwd normalizer on arm/clear | threshold | L1 | automated | 1 000 arm+clear pairs | added wall-clock per pair p95 < 2 ms | single run |
| P2 | Drop-report bound under burst | tail-latency | L1 | automated | 10 000 inbound messages overflowing the queue | inbound dispatch p95 unchanged vs a no-report baseline (< 10 % regression) | single run |
| P3 | Correlation map growth | soak | L1 | automated | 5 000 spawns at timeout `120_000`, none registering | correlation map returns to 0 entries after TTL; RSS delta < 10 MB | 200 s (fake timers) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Late register auto-selects | state-transition | L3 | automated | dashboard spawn at `spawnRegisterTimeoutMs: 90_000` | bridge registers at t+70s (after 60 s, before the fire) | UI converges to the new session opened and the spawning placeholder cleared — the reported symptom, inverted |
| F2 | Register after the fire | state-transition | L3 | automated | spawn whose watchdog fired and whose reclaim missed | bridge registers inside the recovery window | banner clears AND the card appears; never one without the other |
| F3 | Dashboard headless visibility | state-transition | L3 | automated | dashboard-spawned session reporting `hasUI:false` | it registers | session is present in the sidebar, not filtered into Hidden |
| F4 | Genuine headless stays hidden | state-transition | L3 | automated | headless worker in the same cwd, no dashboard signal | it registers | remains in the Hidden tier; does not steal focus from a pending spawn |
| F5 | Concurrent same-cwd spawns | state-transition | L3 | automated | two dashboard spawns into one cwd | the first registers | the second's placeholder persists and still resolves on its own register |
| F6 | Delivery observable | state-transition | L3 | automated | prompt sent to a live bridge | bridge hands it to pi | the acknowledged state becomes observable on the session event stream, keyed to that prompt |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Recovery beyond TTL | fault-injection (delay) | L1 | automated | no clear at all | 60_001 ms after the fire | entry evicted; no recovery emitted |
| X2 | Recovery with dead ws | fault-injection (abort) | L1 | automated | `ws.readyState !== OPEN` | late clear inside the window | send skipped silently; entry deleted; no throw |
| X3 | Normalizer on a bad path | fault-injection (abort) | L1 | automated | `realpath` throws (EACCES, not just ENOENT) | arm and clear | falls back to the raw string; no throw |
| X4 | Ordering-margin boundary | fault-injection (delay) | L1 | automated | arm-before-record path (resume) | register in the final 1 ms of the recovery window | correlation still resolvable — no recovery emitted without `spawnRequestId` |
| X5 | Drop while disconnected | fault-injection (abort) | L1 | automated | socket down at drop time | reportable drop occurs | no report attempted; nothing queued for reconnect |
| X6 | Drop-report TOCTOU | fault-injection (abort) | L1 | automated | socket closes between the liveness check and the send | reportable drop | no report buffered for post-reconnect delivery |
| X7 | Mismatch report routing | fault-injection | L1 | automated | bridge reports a drop naming a session it does not own | report sent | reaches the server handler; NOT discarded by session-ownership routing |
| X8 | Drop record without capture | fault-injection | L2 | automated | `keeperLog.capturePiOutput=false` (default) | force a session-id-mismatch drop on a live bridge | the drop appears in `server.log` |
| X9 | Displaced-bridge ack | fault-injection | L1 | automated | ack arrives from a displaced connection | second bridge owns the id | prompt NOT marked delivered |
| X10 | Older bridge never acks | fault-injection (delay) | L1 | automated | bridge that sends no ack | prompt transmitted | stays transmitted forever; request does not fail; state still evicted (E34) |
| X11 | Reclaim killed the spawn | fault-injection (abort) | L1 | automated | fire-time reclaim succeeds | no register ever arrives | no recovery; the `REGISTER_TIMEOUT` entry has no recovery record |
| X12 | Fork placement on a late register | fault-injection (delay) | L3 | automated | fork at timeout `90_000` | forked bridge registers at t+70s | forked session placed after its parent, not appended at the tier end |

---

## Coverage summary

- Requirements covered: 16/16 (4 spec deltas — every `SHALL` block has ≥1 row)
- Scenarios by class: edge 37 · perf 3 · frontend 6 · error 12
- Scenarios by level: L1 47 · L2 1 · L3 7 · manual-only 0
- Scenarios by disposition: automated 58 · manual-only 0

## New infra needed

None. L1 rows extend existing `packages/server/src/__tests__/` vitest suites
(nearest exemplars: `pi-gateway-duplicate-register.test.ts`,
`session-api.test.ts`); L3 rows extend `tests/e2e/` against the docker harness
port from `.pi-test-harness.json`; X8 fits the existing `qa/tests/` CLI smoke
tier. `contention-resume-guard-api.test.ts` must be UPDATED (not added) — it
asserts the `delivered: true` that E30 removes.
