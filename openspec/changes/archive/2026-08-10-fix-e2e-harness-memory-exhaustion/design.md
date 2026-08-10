## Context

The browser-E2E harness is one long-lived Docker container shared by all 87 specs, capped at 4 GiB (`docker/compose.yml:72`, `MEM_LIMIT:-4g`; the test overlay never overrides it). Each dashboard-spawned pi session is a separate OS process costing 150–280 MB RSS. Measured on a live harness mid-run: **41 resident `pi` processes**, `memory.current` at **99.95 %** of the cap, `memory.events max=1130`, `pids.current=401`, while the `pi-state` tmpfs — the intuitive suspect, sized 2 GB — sat at **19 MB**.

`tests/e2e` spawns from **138 call sites across 62 of 87 specs**; exactly one spec ends a session it created (`notify-channel.spec.ts:108`, force-kill over a throwaway browser socket — an assertion need, not cleanup), and the five specs with `afterEach`/`afterAll` hooks all restore config/git/plugin state, never a session. So the container crosses its ceiling after roughly `(4096 − 630 server − overhead) / 125 ≈ 27` concurrent sessions (as few as 12 at the 280 MB end of the observed range), the cgroup thrashes in reclaim, `/api/health` starts timing out against the 30 s/5-retry healthcheck, the daemon eventually dies, PID 1's grace loop expires, and every remaining spec fails in ~400 ms against a dead port.

Two properties of that failure make it expensive out of proportion to its cause: it is **silent** (the cascade is indistinguishable from mass product regression, which is how #433 sat undiagnosed) and it **taints triage** (the 10 red specs in #433 cannot be judged against a harness that dies).

Machinery this design consumes rather than builds:

- `handleShutdown` (`packages/server/src/browser-handlers/session-action-handler.ts:625`), reached by the browser-protocol `{type:"shutdown", sessionId}` message: writes `setLiveness({live:false, closedReason:"manual"})`, SIGTERMs the headless pi (→ 2 s → SIGKILL via `headlessPidRegistry.killBySessionId`), unregisters, broadcasts `session_removed`.
- `BusClient` (`packages/bus-client`, already used by `tests/e2e/bus-client-goal-plugin-action.spec.ts`): a typed headless Node WS client whose `connect()` resolves on `sessions_snapshot`, exposing `read.sessions()`, `send()`, `await()` and `close()`. It has **no reconnect and no observable connection state**; `send()` throws `bus client not connected` once the socket is gone. Both facts constrain D1 and D4 below.
- `tests/e2e/helpers/index.ts` (`spawnFreshGitSession`, `ensureGitSession`), imported by every spawning spec.

**Verified constraint that shaped D1:** the REST route `POST /api/session/:id/shutdown` (`packages/server/src/session/session-api.ts:107`) is a *parallel implementation* of the same action that **omits the `setLiveness` write**. `isRecoveryCandidate` (`packages/shared/src/session-meta.ts:193`) gates on `closedReason !== "manual"`, so REST-closed sessions remain cold-start recovery candidates and are restored by the boot scan into `GET /api/sessions`. Reaping over REST would therefore pollute the very session list this design's delta snapshot and count budget read.

## Goals / Non-Goals

**Goals:**

- A full 87-spec run completes without the container crossing its memory cap or its daemon dying.
- Live-session footprint is **bounded by construction**: what a spec spawns, that spec releases.
- A dead harness is reported **by name**, once, and never as a wall of phantom spec failures.
- A reap regression fails at the point of breach with actionable output, not as a collapse 40 specs later.

**Non-Goals:**

- Triaging the 10 red specs (#433 part 1) or deciding the CI trigger (#433 part 2) — deferred until this lands; triage against a dying harness is worthless.
- Raising `MEM_LIMIT`. The Docker VM has 8 GB total and one harness already claims 4 GiB; unbounded growth against a larger cap fails identically, later.
- Reducing per-session RSS, or capping concurrent sessions in production. This is a test-lifecycle defect; production behaviour stays untouched.
- **Fixing the REST/WS shutdown divergence.** Real production defect, filed separately; this change routes around it.
- Raising `playwright.config.ts`'s `globalTimeout: 15 * 60_000`. The acceptance run overrides it on the CLI; unattended `npm run test:e2e` still cannot finish the suite after this change.

## Decisions

### D1 — Reap over the browser WS bus, not REST

Teardown sends `{type:"shutdown", sessionId}` over the browser WebSocket via `BusClient`, and enumerates with `client.read.sessions()`.

*Why:* it is the path the UI itself uses, and the only one that records `closedReason:"manual"`. The REST route omits that write (verified above), which would leave every reaped session a recovery candidate — restored into `GET /api/sessions` on the next cold start, polluting the delta snapshot and tripping the count budget with ghosts. Choosing REST would have reproduced, through a different door, exactly the bookkeeping failure D1 originally rejected `force_kill` for.

*Client lifecycle — connect per test, close in teardown.* `BusClient` cannot reconnect, and `faux-ask.spec.ts:101` restarts the daemon mid-suite, which drops every open socket. A worker-scoped client would be permanently dead from that spec onward and every later reap would throw. A per-test client costs one handshake plus the `sessions_snapshot` round-trip and is immune to the restart.

*Ack semantics.* `handleShutdown` broadcasts `session_removed` as its **last** step, after `killBySessionId` has completed the SIGTERM→2 s→SIGKILL ladder. So the ack means the process is actually gone — it is worth awaiting, and a fire-and-forget send would instead let dying sessions appear in the next test's pre-snapshot and become permanent phantoms in the delta. Reap latency is contained by issuing the shutdowns for multiple sessions **concurrently** (the gateway processes browser messages concurrently, not serially), not by skipping the ack.

*Rejected:* `abort` (interrupts the turn, leaves the process resident — frees nothing); REST `/api/session/:id/shutdown` (above); driving the session card's shutdown control (couples cleanup to the surface under test, and dies whenever a toast covers the card — the interception class that already breaks `change-summary-table.spec.ts`). `force_kill` is **not** rejected for bookkeeping reasons — it also writes `closedReason:"manual"` (`session-action-handler.ts:779`) — but for being the ungraceful path: it closes the bridge socket before the process can settle, where `shutdown` tells the session to stop first and only then escalates.

### D2 — One auto-fixture, adopted by an import swap, enforced by a guard test

`tests/e2e/fixtures.ts` re-exports a `test` extended with an `auto: true` fixture that reaps after each test. Specs change one line: `from "@playwright/test"` → `from "./fixtures.js"`. A guard test fails any `tests/e2e/*.spec.ts` that imports `test` from `@playwright/test` directly.

*Why:* the accumulation is a *default*, so the fix must be one too. Opt-in cleanup decays the moment someone writes spec #88 — which is how 138 spawn sites accrued zero session-cleanup sites.

*Not a pure one-line swap:* 14+ specs also import `type Page`, `type Locator`, `type APIRequestContext`, `type WebSocket` from the same statement. `fixtures.ts` must re-export every one, or those files fail to compile while the guard still passes. The conversion is mechanical but must be type-checked, not eyeballed.

*Ordering with existing hooks:* Playwright runs `afterEach` hooks **before** test-scoped fixture teardown, so the three specs with `afterEach` state-restoration still observe a live session. `afterAll` runs **after** fixture teardown, so an `afterAll` hook sees an already-reaped session; the two specs using `afterAll` (`plugin-settings-pages`, `oauth-redirect-base`) restore plugin/config state and do not need a live session, but this ordering must be verified per hook during conversion rather than assumed.

*Rejected:* per-file `afterEach` (87 hand-written blocks, 87 chances to drift, nothing binds #88); a Playwright `teardown` project (runs once at the end — cleans up after the damage, does not bound the *peak*); a server-side live-session cap (changes production to work around a test defect).

### D3 — Reap the delta, never "kill everything"

The fixture snapshots session ids before the test body and shuts down only ids that appeared during it.

*Why:* no allowlist, no opt-out. The `PI_E2E_INDEPENDENT_SESSION` session (launched by `test-entrypoint.sh:568`, consumed by `faux-ask.spec.ts` to prove reconnect-after-restart) predates every test, so it is never in a delta. A blanket reap would kill its subject.

*Holes this leaves, and what covers them:*
- **In-flight registration** — a session whose spawn was issued before the snapshot but registers after it is absent from the delta and becomes "pre-existing" for every later test: a permanent leak. Mitigated by re-reading the session list after a short settle before computing the delta, and caught by D5 when it slips through.
- **Late-registering harness sessions** — the `PI_E2E_INDEPENDENT_SESSION` pi is launched at container boot but registers asynchronously. If it registers *during* the first test rather than before it, the delta would reap it and break `faux-ask.spec.ts` #F6 much later, with no obvious link back. Guarded by having global-setup wait for the expected harness-owned sessions to be present before the first test runs, so they are always in the first snapshot.
- **`beforeAll`/module-scope spawns** — outside every per-test delta by construction. The guard test checks the import line only and cannot see them; D5 is the backstop.
- Both holes make D5 load-bearing rather than decorative — it is the only mechanism that sees what the delta misses.

*Consequence, accepted:* `ensureGitSession` reuses a warm card when present; after reaping that card usually will not exist, so it falls through to pin-and-spawn. Correctness is unaffected (the helper handles an empty container) but per-spec wall time rises. That is the point: a session outliving its spec is the leak.

### D4 — Harness death: latch after repeated failure, then skip

Before each test body the fixture probes harness liveness with an explicit `GET /api/health` request — **not** the bus client's connection state, which is neither observable on `BusClient` nor diagnostic (a TCP socket stays open through the very memory thrash this must detect). The probe must fail **N consecutive times** (N ≥ 2, with a generous timeout) before the latch arms; once armed, the current test fails with an unmistakable `HARNESS DOWN` message and every subsequent test calls `testInfo.skip()`.

*Why N consecutive, not one:* the measured pre-death state is a container **thrashing at its memory ceiling**, where `/api/health` times out while the daemon is still alive and would recover once reaping relieves pressure. A single-probe latch would declare the harness dead over a slow one and skip the rest of the run — converting a performance symptom into a false global verdict.

*Why fail-then-skip:* a genuinely dead container never recovers within a run, so the remaining ~70 executions carry zero information and actively mislead — they are what made #433 read as mass regression.

*Known imprecision, stated rather than hidden:* the test that is *running* when the daemon dies fails on its own assertions, since its probe already passed. So the honest guarantee is "at most one additional failure after the death, then skips", not "exactly one failure" — the spec is written to that weaker, achievable claim.

*Interactions made explicit:* the probe runs **before** the latch check, so under CI `retries: 1` the retry of a harness-down test fails again rather than reporting as a skip. The latch is module state shared across spec files by the single worker — which silently depends on `workers: 1` + `fullyParallel: false`; that dependency is recorded in the fixture so a future worker bump does not resurrect the cascade unnoticed.

*Reap must not mask the real failure.* When the daemon dies mid-test, the teardown reap's `connect()`/`send()` will throw `bus client not connected`. The fixture swallows reap errors unconditionally and reports them as diagnostics, never as the test's failure — otherwise the delta spec's own "the reported failure SHALL remain the original assertion failure" breaks under exactly the condition D4 exists for.

*Rejected:* `--maxFailures`. It cannot distinguish a dead harness from a genuinely failing suite, and #433's whole cost was that failure to distinguish.

### D5 — Budget the post-reap leak set

After reaping, the fixture asserts the live-session count stays at or below a declared budget, reporting the offending session ids and cwds on breach.

*What this is and is not:* the `≈21` figure derives the **peak concurrent sessions before the cap**; the budget guards the **residual set after reaping**. They are different quantities, and conflating them would overstate the guarantee. The budget is a **tripwire on residue** — it catches the delta's blind spots (in-flight registration, `beforeAll` spawns, agent-spawned children that never register as dashboard sessions) at the spec that caused them. The memory *bound* itself is verified by the acceptance run's `memory.current`, not by the count.

*Why count in-band:* it is readable over the bus the fixture already holds, needs no `docker exec` from the test process, and can attribute a breach to a spec. A cgroup read would be more direct but does neither.

*Starting value 8*, against a ceiling of ~27 at the measured ~125 MB average and ~12 at the 280 MB worst case — so the tripwire fires before the cap under either.

### D6 — Leave the memory cap and the container config alone

No change to `MEM_LIMIT`, the healthcheck cadence, or the PID-1 supervisor loop.

*Why:* the supervisor's restart-grace behaviour is correct and load-bearing — `faux-ask.spec.ts:101` calls `POST /api/restart` mid-suite (the only spec that does; `oauth-redirect-base.spec.ts` documents at line 24 that it deliberately does **not**), and without the grace window that restart would kill the harness. The cap is not the bug; the unbounded consumer is. Changing both at once would make it impossible to tell which fixed the run.

## Risks / Trade-offs

- **Reap time is charged to the 60 s per-test timeout.** Fixture teardown counts against `timeout: 60_000`, and each `shutdown` awaits a 2 s SIGTERM→SIGKILL ladder. A spec that already runs near the limit and holds 2–3 sessions can be pushed over — a new flake class. → Issue the shutdowns concurrently (the gateway does not serialise browser messages), keep awaiting `session_removed` because it is the post-kill ack, and measure teardown cost in the chunk run before the full run.
- **Wall-clock regression from lost session reuse (D3).** → Measure a chunk before/after; if reuse proves load-bearing for a subset, the answer is a scoped fixture that keeps one session per *file*, not a return to unbounded retention.
- **Reap races an in-flight turn**, producing `session_removed` while the page still holds the card → new flakes. → Reap strictly after the test body, treat an already-gone session as success, ignore post-test page errors on a closing page.
- **The type re-export surface is a compile-time cliff** (D2): a missed `export type` breaks all 87 specs at once while the guard test still passes. → Type-check as part of the conversion task, not after it.
- **Reaping could mask a genuine server-side leak** — if the server retained per-session memory after shutdown, a clean count would hide it. → Acceptance is `memory.current` after a full run, not the session count, so a rising floor still surfaces.
- **The latch depends on single-worker module state** (D4). → Recorded in the fixture with the reason, so a `workers > 1` change surfaces it.

## Migration Plan

1. Land `tests/e2e/fixtures.ts` (bus-backed reap + liveness latch + budget) with unit coverage of the delta logic.
2. Convert the 87 specs' import line mechanically, re-exporting every type they consume; land the guard test in the same commit so the invariant is armed from the start. Type-check before running anything.
3. Prove the bound on a ~30-spec chunk, sampling `memory.current` and `pids.current` before and after — the numbers must stay flat run-over-run instead of climbing. Record teardown cost.
4. Acceptance: one full 87-spec run (with `globalTimeout` overridden on the CLI) reaching the final spec with the container still healthy and no unexplained `daemon restarted` line.
5. Rollback is a revert of two files plus the import lines; nothing outside `tests/e2e/` changes.

## Open Questions

- **Is 8 the right budget?** Chosen as a tripwire with headroom under either end of the RSS range, but the true peak residual across the suite is unmeasured. Step 3 reports the observed peak; if a spec legitimately exceeds 8, raise the budget to that peak + 2 rather than exempting the spec.
- **Do agent-spawned processes register as dashboard sessions?** If a flow step or subagent spawns a pi that never appears in `read.sessions()`, it is invisible to both the delta and the budget while still consuming RSS — in which case the budget requirement's promise to surface such sessions at their origin is unmet and a process-level probe is required instead. Step 3 answers it by comparing the resident process count with the session count; the delta spec already requires any persistent divergence to be recorded.
- **Should `ensureGitSession` be retired in favour of always-fresh spawning?** Reaping removes most of its reuse benefit, so the name may now mislead. Deferred: renaming touches every consumer and is not needed to bound memory.
- **Does the full run stay green once it can finish?** Unknown by construction — no one has completed one. Whatever it reports is the input to #433 part 1, which is why that triage is deliberately downstream.
