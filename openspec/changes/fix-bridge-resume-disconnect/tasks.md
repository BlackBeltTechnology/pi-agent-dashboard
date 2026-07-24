# Tasks

## 1. Reproduce — RED (systematic-debugging)

- [ ] 1.1 Author the reproduction test (test-plan #X1) at `packages/extension/src/__tests__/bridge-resume-disconnect.test.ts` using the pure model-mirror + fake-WS pattern — exemplar: see `packages/extension/src/__tests__/connection.test.ts` (fake WebSocket) and `bridge-shutdown-reset.test.ts` (handler model). Triple: inject the documented post-replacement `ctx.cwd` guarded-getter throw into the `handleSessionChange` path (input) · `session_shutdown(reason:"resume")` → `session_start(reason:"resume")` (trigger) · connection SHALL converge to `isConnected === true` AND session B registered (observable). Confirm it FAILS on current code (reproduces #393).

## 2. Instrument + identify — SPIKE (systematic-debugging, node-inspect-debugger)

- [ ] 2.1 Trace the real resume path: confirm the in-TUI `/resume` routes through `agent-session-runtime.js` `switchSession` (`teardownCurrent("resume")` awaited → `createRuntime` emits `session_start`) — candidate #3. If it routes elsewhere, record the actual path.
- [ ] 2.2 Pin the exact point recovery is lost: does `handleSessionChange(ctx)` (`bridge.ts:2022`) throw before `connection.connect()` (`bridge.ts:2374`)? Instrument the throw SITE (`session-sync.ts` `_handleSessionChange`: `extractFirstMessage` / `getCurrentModelString` / `replaySessionEntries` / `gatherGitInfo` / `getCommands`; `startGitPollTimer(ctx)` → `ctx.cwd`) — NOT `safe()` (it only logs; the throw's control-flow does the skip).
- [ ] 2.3 Record the confirmed mechanism in `design.md` (§Fix). If it differs from the leading hypothesis, update test-plan #X1's `input`/`fault` to the confirmed condition (observable unchanged).

## 3. Fix the identified cause (surgical)

- [ ] 3.1 Implement the minimal fix for the mechanism confirmed in §2, satisfying the outcome contract (resume ends live + re-registered). Do NOT prescribe an approach before §2 concludes.
- [ ] 3.2 Confirm the reproduction test (1.1 / #X1) now PASSES.

## Tests (folded from test-plan.md — automated rows)

- [ ] T-F1 (test-plan #F1) resume ends live+registered — L1, exemplar `connection.test.ts`. bridge+live fake-WS, session A registered (input) · `session_shutdown(reason:"resume")` awaited to completion → `session_start(reason:"resume")` for B (trigger) · converges to `isConnected===true` AND `session_register(B)` delivered on the post-resume socket (observable).
- [ ] T-F2 (test-plan #F2) new ends live+registered — L1. as F1 · `session_shutdown/start(reason:"new")` (trigger) · `isConnected===true` AND new session registered (observable).
- [ ] T-F3 (test-plan #F3) fork ends live+registered — L1. as F1 · `session_shutdown/start(reason:"fork")` (trigger) · `isConnected===true` AND forked session registered (observable).
- [ ] T-F4 (test-plan #F4) reload ends connected — L1. live connection (input) · `session_shutdown(reason:"reload")` → reload re-init (`state.cleanup` → `connect()`) (trigger) · converges to `isConnected===true` AND re-registered (observable).
- [ ] T-E1 (test-plan #E1) quit tears down, cleanup ran — L1. live connection, timers armed (input) · `session_shutdown(reason:"quit")` (trigger) · `session_unregister` sent, all timers cleared, `subagentFrameBuffer.reset()` + `cleanupAttachmentsForSession` called; socket teardown permitted, not asserted (observable).
- [ ] T-X2 (test-plan #X2) cleanup runs regardless of reason under a later throw — L1. replacement reason with a later `session_start` step throwing (input) · `session_shutdown(reason ∈ {resume,new,fork})` (trigger) · unregister sent + all timers stopped + buffer reset + attachments cleaned even when a subsequent step throws (observable).

## Manual (deferred post-merge by ship-change)

- [ ] M1 (test-plan: manual-only) Real in-TUI resume keeps the dashboard connected: `pi-dashboard start` + a live `pi` TUI session shown active → `/resume` or session-selector switch in the TUI → session stays connected in BOTH the TUI indicator AND the browser; no refresh / `/reload` / fresh process needed. (True #393 repro.)

## Discipline checkpoints

- [ ] D1 `systematic-debugging` — RED repro (#X1) established and FAILING before any fix (§1); GREEN after (§3.2). No fix authored before §2 records the confirmed mechanism.
- [ ] D2 `doubt-driven-review` — once §2 pins the cause and §3 drafts the fix, cross-examine the fix's causal claim against the reproduction evidence before it stands.

## Validate

- [ ] V1 `openspec validate fix-bridge-resume-disconnect --strict` passes.
- [ ] V2 `npm test` green (extension bridge + connection suites).
- [ ] V3 M1 manual repro passes (resume in a real TUI keeps the dashboard connected).
