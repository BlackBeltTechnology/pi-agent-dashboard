# Test Plan — stop-discarding-known-session-state

Stage: proposal   Generated: 2026-09-14

**Gate — one open clarification (does not block implementation start).** The
host-pressure indicator's *thresholds* are unspecified: how many seconds of
out-of-band silence reads as "slow" vs "unresponsive". Proposed default, to be
confirmed: reuse the values the system already commits to — the bridge heartbeat
is 15 s and the watchdog force-closes at 60 s, so `> 2` missed beats (≈35 s) is
degraded and `≥ 60 s` is unresponsive. Inventing unrelated numbers would create a
requirement nobody agreed to; these at least align the UI with the transport's
own liveness verdict. **Scenarios F2/F3 below are written against the boundary,
not the number, so they survive a different choice.**

Levels: **L1** unit/component (vitest), **L2** server integration (vitest, real
handlers), **E2E** Playwright against the docker harness.

---

## Scenarios

### Edge-case — delivery verdict and outbox

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Browser send SHALL report a delivery verdict | equivalence partition (open) | L1 | automated | `useWebSocket` with socket `readyState === OPEN` | `send(msg)` | socket receives the serialized message; verdict indicates handed-to-socket |
| E2 | Browser send SHALL report a delivery verdict | equivalence partition (each non-open state) | L1 | automated | sockets in `CONNECTING`, `CLOSING`, `CLOSED` | `send(msg)` | verdict never indicates handed-to-socket for any of the three; nothing written |
| E3 | Browser send SHALL report a delivery verdict | decision-table (no socket instance) | L1 | automated | hook before first connect — `wsRef.current` is null | `send(msg)` | returns a rejection verdict; **does not throw** |
| E4 | The outbox SHALL hold only never-sent messages | state-transition (queue→flush) | L1 | automated | socket not open; one `send(msg)` returning queued | connection reopens | `msg` written to the new socket **exactly once**; outbox empty afterwards |
| **E5** | The outbox SHALL hold only never-sent messages | **state-transition (the duplicate trap)** | L1 | automated | `send_prompt` handed to an OPEN socket; socket then closes with **no ack received** | connection reopens | message **NOT** written again — 0 further writes. Guards the non-idempotent prompt path |
| E6 | The outbox SHALL hold only never-sent messages | BVA (at capacity) | L1 | automated | outbox at capacity N while socket closed | queue entry N+1 | oldest entry evicted; evicted caller's verdict never claims delivery; size stays N |
| E7 | Outbox entries SHALL expire before the pending-prompt deadline | BVA (just past expiry) | L1 | automated | `send_prompt` queued; clock advanced past outbox expiry and past the 30 s prompt deadline | connection reopens | expired entry **discarded, not flushed**; 0 writes — no late duplicate against the user's retype |
| E8 | Outbox entries SHALL expire before the pending-prompt deadline | BVA (just inside expiry) | L1 | automated | `send_prompt` queued; clock advanced to just under the expiry | connection reopens | entry flushed exactly once |

### Edge-case — death attribution

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| **E9** | Both terminal seams SHALL stamp the reason | **property / seam-coverage** | L2 | automated | each code path that transitions a session to `ended` (both `unregister` and the `update()`-based sites) | drive each terminal path | **every** resulting session carries a `closedReason`; a path yielding `ended` with no reason **fails the test**. This is the guard against a partially-labelled fleet |
| **E10** | Both terminal seams SHALL stamp the reason | **state-transition (illegal re-entry)** | L1 | automated | a session already `ended` carrying a specific involuntary reason | a further no-op `update()` that sets `status: "ended"` again | the original reason is **preserved**, not overwritten with `unknown`. Guards the D1 central-transition risk |
| E11 | Involuntary session death SHALL carry a reason | equivalence partition (spawn failure) | L2 | automated | reload/resume whose `spawnPiSession` returns failure | handler runs | reason identifies spawn failure; **not** reported as a clean exit |
| E12 | Involuntary session death SHALL carry a reason | equivalence partition (carrier loss) | L2 | automated | session whose bridge is gone | reconnect grace period expires | reason identifies carrier loss |
| E13 | Manual close is unchanged | regression | L2 | automated | user closes a session | `shutdown` / `force_kill` | reason remains exactly `"manual"` |
| E14 | Process-liveness classification SHALL NOT overclaim | decision-table (no pid) | L1 | automated | ending session with `pid` undefined | classification runs | reason is `unknown`; server does **not** claim the process is gone |
| **E15** | The reason SHALL persist through the documented overwrite trap | **fault-injection (the wipe trap)** | L2 | automated | session ends with a non-`manual` reason; a routine `session-to-meta` metadata write then occurs | server restarts and rescans from disk | reason still present. **Fails against the naive implementation** that sets `session.closedReason` and trusts the debounced save |
| E16 | An involuntary reason does not disqualify recovery | regression (predicate untouched) | L1 | automated | sessions bearing each new reason value | `isRecoveryCandidate` evaluated | classification identical to a session with no reason; only `"manual"` excludes |
| E17 | Cold-start reconstruction does not synthesize reasons | decision-table | L2 | automated | `.meta.json` files from before this change (no `closedReason`) | scanner/bootstrap reconstruct them | reason stays absent — history is **not** retro-labelled `unknown` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Host pressure SHALL be rendered from data already on the wire | decision-table (absent data) | L1 | automated | session row with **no** `processMetrics` | card renders | unknown/absent state shown — **never** a healthy state |
| **F2** | Freeze SHALL be signalled out-of-band | **boundary (silence, no heartbeat)** | L1 | automated | session row whose last frame timestamp is older than the unresponsive boundary, with **no new `processMetrics`** | card renders | indicator shows unresponsive **without** any heartbeat arriving. Written against the boundary, so a threshold change does not invalidate it |
| F3 | Recovered stalls are labelled as past, not present | boundary (large value, fresh beat) | L1 | automated | fresh heartbeat carrying a large `eventLoopMaxMs` | card renders | presented as a stall already recovered from; **not** as currently frozen |
| F4 | eventLoopMaxMs may be unavailable | decision-table | L1 | automated | `processMetrics` present but `eventLoopMaxMs` absent | card renders | indicator still functions from silence alone; no corroboration value rendered |
| **F5** | An undelivered user action SHALL be surfaced honestly | **state-transition (no waiting)** | L1 | automated | socket not open | user sends a prompt | bubble marked failed **immediately** — before the 30 s timer could fire; message attributes the **connection**, not the session |
| F6 | A known-undelivered prompt fails without waiting | regression (timer not armed) | L1 | automated | same as F5 | 30 s elapse | no second error; the safety timeout was never armed for that prompt |
| F7 | An ended session SHALL present its reason | equivalence partition | L1 | automated | ended session rows with each reason value incl. `unknown` | card renders | reason presented; `unknown` says so rather than implying a clean exit |
| F8 | Timeout message reserved for the unknown case | regression | L1 | automated | prompt genuinely transmitted then never answered | 30 s pass with no clearing event | the original "may not have been received" wording still appears — the honest-unknown path is unchanged |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Browser send SHALL report a delivery verdict | fault-injection (`ws.send` throws) | L1 | automated | socket reports `OPEN` but `send()` throws (closing race) | `send(msg)` | no exception escapes; verdict reports failure; message is **not** silently lost without a verdict |
| X2 | Prompt to an active session with no bridge connection | fault-injection (bridge gone) | L2 | automated | active session, `sendToSession` returns false | `send_prompt` handled | `emitCommandFeedback` reaches the browser; **not** a bare `console.error` |
| X3 | Prompt sent to ended session without session file | fault-injection (16 real sessions match this) | L2 | automated | ended session with `sessionFile: null` | `send_prompt` handled | feedback identifies "not resumable — no session file"; prompt not silently dropped |
| X4 | Spawn failure handling | fault-injection | L2 | automated | auto-resume whose spawn fails | `send_prompt` to ended session | `resuming` rolled back to false, registry entry consumed, **and** feedback carries the failure reason |

### End-to-end (rendered UI, docker harness)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| **Q1** | An undelivered user action SHALL be surfaced honestly | **incident reproduction** | E2E | automated | dashboard open on a session; dashboard WebSocket forcibly interrupted | user types a prompt during the reconnect window | an honest connection-failure indication appears promptly; the session is **not** blamed. This is the user-reported symptom |
| Q2 | Involuntary session death SHALL carry a reason | incident reproduction | E2E | automated | a session whose process is killed out-of-band | card transitions to ended | card shows a reason, not a bare `ended` |
| Q3 | Host pressure SHALL be rendered | smoke | E2E | automated | a healthy running session | card renders | a health indicator is present and reads healthy |

### Performance

| id | requirement | technique | level | disposition | note |
|----|-------------|-----------|-------|-------------|------|
| P1 | Both terminal seams SHALL stamp the reason | risk-based (hot path) | L1 | **manual/observational** | D1 option B adds a transition check to `update()`, used by **every** session mutation. No latency budget exists in the spec to assert against, so no threshold test is invented. The check must remain O(1) with no allocation on the non-transition path — verified by reading the diff, not by a timing assertion. |

_No throughput or payload scenario: this change adds **no** new transport. The
indicator renders bytes already on the wire, and the metrics ring — the only item
that would have added traffic — is cut._

---

## Known limitations, deliberately untested

- **Back-pressure false positive (design D4).** If a `session_updated` frame is
  dropped by the saturation defect this change does **not** fix, a stale row can
  render a healthy session as unresponsive. Accepted: it errs toward showing
  trouble. Untestable here without fixing the defect that causes it.
- **Pid recycling.** A recycled pid can make a dead process probe as alive. No
  test can distinguish this deterministically; the caveat is documented instead.
- **Post-mortem metrics history.** Explicitly cut. A dead session's pressure
  history remains unavailable; F1–F4 cover live sessions only.
