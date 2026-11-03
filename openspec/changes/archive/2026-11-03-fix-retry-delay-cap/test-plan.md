# Test Plan — fix-retry-delay-cap

Stage: design   Generated: 2026-11-03

No clarifications needed: every Triple fills from the spec deltas and design.md.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | bridge: Delay is capped at maxAgentDelayMs | BVA (above cap) | L1 | automated | tracker settings `{baseDelayMs:2700, maxRetries:11}`, no cap key | 10 error `agent_end`s | 10th waiting event `delayMs === 60000`, `nextAttemptAt === now+60000` (fake timers) |
| E2 | bridge: A configured cap is honored | BVA (below / at / above cap) | L1 | automated | `{baseDelayMs:2000, maxAgentDelayMs:5000, maxRetries:5}` | attempts 1..4 | `delayMs` = `[2000, 4000, 5000, 5000]` |
| E3 | bridge: A negative computed delay degrades | EP (invalid partition) | L1 | automated | `{baseDelayMs:2000, maxAgentDelayMs:-1}` | attempt 1 | `delayMs === 0`, `nextAttemptAt === undefined` |
| E4 | bridge: Unreadable settings degrade (pre-guard) | EP | L1 | automated | `{baseDelayMs:0}` plus an injected `delayFn` that returns `999` | attempt 1 | `delayMs === 0`; `delayFn` not called |
| E5 | bridge: cap 0 | BVA (min) | L1 | automated | `{baseDelayMs:2000, maxAgentDelayMs:0}` | attempt 3 | `delayMs === 0` |
| E6 | design D1 drift guard | parity grid | L1 | automated | grid base∈{1,2000,2700}, cap∈{0,5000,60000,undefined}, attempt∈{0,1,2,10,64,2000} | compare local `cappedDelay` vs pi-ai `retryDelayMs` (dynamic import) | every pair is strictly equal |
| E7 | bridge: Project settings override the global cap | decision table (global × project) | L1 | automated | temp home with global `maxAgentDelayMs:60000`, temp cwd with project `10000` | `readPiRetrySettings({home,cwd})` | `maxAgentDelayMs === 10000`; global-only → 60000; neither → 60000 |
| E8 | design D2 reader mirrors pi | EP | L1 | automated | global `retry.maxAgentDelayMs` ∈ {`"abc"`, `null`, `1.5`, `-1`} | `readPiRetrySettings` | `"abc"`/`null` → 60000; `1.5` → 1.5; `-1` → -1 |
| E9 | settings: Invalid delay cap is rejected | EP+BVA | L1 | automated | PUT body `maxAgentDelayMs` ∈ {-1, 1.5, "x"} | `PUT /api/pi-retry` (fastify inject) | 400, error field `maxAgentDelayMs`, file byte-identical, `reloadConnectedSessions` not called |
| E10 | settings: cap is editable + persisted | BVA (min valid) | L1 | automated | file with `retry.someFutureKnob:1`, `packages:[…]` | PUT valid policy with `maxAgentDelayMs:0`, then GET | file has `retry.maxAgentDelayMs:0`; `someFutureKnob` and `packages` deep-equal to before; GET returns 0 |
| E11 | settings: cap absent → default shown | EP | L1 | automated | settings file without `retry` | `GET /api/pi-retry` | `data.policy.maxAgentDelayMs === 60000` |
| E12 | settings: Preview applies the cap | BVA | L1 | automated | form 11 / 2700 / 60000 | render `RetrySettingsSection` | every preview step ≤ "60 s"; total equals sum of pinned capped vector (2.7+5.4+10.8+21.6+43.2+60×6 = 443.7 s) |
| E13 | settings: Clamping is disclosed | decision table (clamped?) | L1 | automated | form 11 / 2700 / 60000 | render | cap notice visible and names attempt 6 as the first capped attempt |
| E14 | settings: No clamping, no notice | decision table | L1 | automated | form 3 / 2000 / 60000 | render | cap notice absent |
| E15 | settings: tail step capped | BVA | L1 | automated | form 30 / 2000 / 60000 (> PREVIEW_STEPS) | render | tail "… → 60 s" (not hours) |
| E16 | settings: The agent delay cap is editable | EP | L1 | automated | loaded policy without the key | render, edit field to 5000, unified Save | control has accessible name + `ms` unit; save payload carries `maxAgentDelayMs:5000` |
| E17 | settings: Retry disabled → cap inactive | decision table | L1 | automated | `enabled:false` | render | cap control disabled alongside attempt/base controls |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | design D3 bounded preview | timed unit | L1 | automated | `computeSchedule(1_000_000_000, 2000, 60000)` | returns in < 50 ms with finite total = (Σ uncapped steps below cap) + remaining × 60000 | single call |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | bridge: emitted delay never outruns pi (end to end) | live state convergence | — | manual-only | real session, `baseDelayMs:2700`, `maxRetries:11`, provider returning 429 | let the chain reach attempt ≥ 7 | banner countdown never shows > 60 s, and the next attempt starts when the countdown reaches about 0 (needs a live rate-limited provider, no deterministic harness) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | design D1 guarded wrapper | fault-injection (throw) | L1 | automated | injected `delayFn` throws | attempt 3 with `{2000, 60000}` | `delayMs === 8000` (fallback); no throw escapes `observeAgentEnd` |
| X2 | design D1 guarded wrapper | fault-injection (bad value) | L1 | automated | injected `delayFn` returns `NaN` / `"5"` / `-5` | attempt 2 | `NaN` / `"5"` → fallback `4000`; `-5` → `0` |
| X3 | design D1 optional peer | fault-injection (abort) | L1 | automated | `import("@earendil-works/pi-ai")` mocked to reject | bridge activation | no unhandled rejection; tracker keeps fallback; waiting event for attempt 1 = 2000 |
| X4 | design D1 peer present | fault-injection (delay) | L1 | automated | import mocked to resolve with `{retryDelayMs: spy}` after a tick | activation, then attempt 1 | `setDelayFn` installed; spy called with `({baseDelayMs, maxAgentDelayMs}, 1)` |

---

## Coverage summary

- Requirements covered: 6/6 delta requirements (bridge: Synthesize retry lifecycle; settings: GLOBAL editor, Sessions tab, Validation, Delay curve; design D1–D4)
- Scenarios by class: edge 17 · perf 1 · frontend 1 · error 4
- Scenarios by level: L1 22 · L2 0 · L3 0
- Scenarios by disposition: automated 22 · manual-only 1

## New infra needed

- none (vitest fake timers, fastify inject, RTL already used by the sibling tests)
