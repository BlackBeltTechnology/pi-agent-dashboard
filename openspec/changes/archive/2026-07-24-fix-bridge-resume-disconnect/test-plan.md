# Test Plan — fix-bridge-resume-disconnect

Stage: proposal   Generated: 2026-07-24

Standalone scenario catalog for the outcome contract in
`specs/bridge-extension/spec.md` (Requirement: *Bridge WebSocket survives session
replacement*). Spike-first change: X1 is the RED reproduction; its **input
mechanism is hypothesis-derived** (leading hypothesis — a throw in
`handleSessionChange` skips `connect()`) and is re-confirmed by the spike
(tasks §2) before the fix lands. All automated rows use the repo's **pure
model-mirror** L1 pattern (mirror the `session_shutdown`/`session_start` handler
logic + real `ConnectionManager` with a fake WebSocket — cf.
`connection.test.ts`, `bridge-shutdown-reset.test.ts`).

---

## Scenarios

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | resume ends live+registered | state-transition + async-convergence | L1 | automated | bridge with a live `ConnectionManager` (fake WS OPEN), session A registered | `session_shutdown(reason:"resume")` awaited to completion (incl. 100 ms + `disconnect()`) → `session_start(reason:"resume")` for session B | converges to `connection.isConnected === true` AND a `session_register` frame for B was delivered on the post-resume socket (poll within a settle window; not read synchronously at handler return) |
| F2 | new ends live+registered | state-transition | L1 | automated | as F1 | `session_shutdown(reason:"new")` → `session_start(reason:"new")` | converges to `isConnected === true` AND `session_register` for the new session delivered |
| F3 | fork ends live+registered | state-transition | L1 | automated | as F1 | `session_shutdown(reason:"fork")` → `session_start(reason:"fork")` | converges to `isConnected === true` AND `session_register` for the forked session delivered |
| F4 | reload ends connected | state-transition | L1 | automated | bridge with a live connection | `session_shutdown(reason:"reload")` → reload re-init path (`state.cleanup` → init `connection.connect()`) | converges to `isConnected === true` AND the session re-registered |

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | quit tears down, cleanup ran | state-transition | L1 | automated | bridge with a live connection, timers armed | `session_shutdown(reason:"quit")` | `session_unregister` sent; metrics/heartbeat/git-poll timers cleared; `subagentFrameBuffer.reset()` + `cleanupAttachmentsForSession` called. (Socket teardown is permitted — `MAY` — so NOT asserted either way.) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | resume survives a mid-path throw (RED repro of #393) | fault-injection (throw) | L1 | automated | resume path where a `handleSessionChange` dependency throws — inject the documented post-replacement `ctx.cwd` guarded-getter throw (leading hypothesis; spike §2 confirms the real site) | `session_shutdown(reason:"resume")` → `session_start(reason:"resume")` with the injected throw | connection SHALL still converge to `isConnected === true` AND session B registered. **Fails on current code (reproduces #393); passes after the fix.** |
| X2 | cleanup runs regardless of reason | state-transition (invariant) | L1 | automated | replacement reason where a later `session_start` step throws | `session_shutdown(reason ∈ {resume,new,fork})` | `session_unregister` sent, all timers stopped, `subagentFrameBuffer.reset()` + `cleanupAttachmentsForSession` invoked — even when a subsequent step throws |

### Manual

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | real in-TUI resume keeps the dashboard connected | real-world integration | — | manual-only | `pi-dashboard start` + a live `pi` TUI session shown active in the dashboard | `/resume` or the session-selector switch inside the pi TUI | session stays connected in BOTH the TUI connection indicator AND the browser; no browser refresh, `/reload`, or fresh `pi` process needed. (True #393 repro; not L1/L3-automatable — terminal-driven in-process resume.) |

---

## Coverage summary

- Requirements covered: 1/1 (all 5 spec scenarios + the RED repro)
- Scenarios by class: edge 1 · perf 0 · frontend 4 · error 2 · manual 1
- Scenarios by level: L1 6 · L2 0 · L3 0 · manual-only 1
- Scenarios by disposition: automated 6 · manual-only 1

## New infra needed

- none — L1 model-mirror + fake-WS pattern already exists (`connection.test.ts`,
  `bridge-shutdown-reset.test.ts`).

## Notes / spike dependencies

- **X1 input is hypothesis-derived.** If spike §2 finds a different mechanism
  than the `handleSessionChange` throw, update X1's `input`/`fault` to the
  confirmed condition before authoring the test — the observable (connection
  ends live) is unchanged.
- **Path fidelity (candidate #3).** The L1 model mirrors the `switchSession`
  await-ordering. Spike §2 MUST confirm the in-TUI resume actually routes through
  `switchSession`/`newSession`/`fork`; M1 is the backstop that the L1 model
  reflects the real bug.
