# Tasks — Attribute and eliminate poll-path event-loop stalls

## 0. Interim mitigation (no code — hand to user first)

- [x] 0.1 Advise: unpin stale `.worktrees/*` dirs (the `automation-watcher` is
  attaching to each, inflating pinned-dir count 13→19) → verify pinned count drops
  — DONE (moot): live `/api/pinned-dirs` shows 11 pinned, **0** under `.worktrees/`.
  No stale worktree pins to unpin; premise no longer holds.
- [x] 0.2 Advise: raise `openspec.pollIntervalSeconds` 60 → 180 in Settings →
  verify tick cadence via `/api/health` / server log — DONE: was already 120;
  `PUT /api/config` set it to 180 live (`restartRequired:false`,
  `reconfigurePolling` applied).
- [x] 0.3 Re-run the 20-sample `/api/health` loop → verify `eventLoopDelay.maxMs`
  spikes become rarer (confirms the poll tick is the trigger before we build)
  — DONE: at 180s interval, steady-state mean ~24ms; only a lone 165ms blip in
  ~40s (first sample 3999ms is a reset-on-read window-boundary artifact, not a
  live stall). No recurring >250ms stall — spikes rare, consistent with the
  poll tick as trigger.

## 1. Phase 1 — Attribution (observability)

- [x] 1.1 Add an event-loop spike ring buffer (`{at, ms, turn}`, newest-first,
  capped) reusing the `hydration-metrics.ts` container shape (NOT its
  event-driven record model) → verify: unit test records + evicts at capacity,
  O(1), no serialization
- [x] 1.2 Sample event-loop delay on a fixed cadence from a **dedicated**
  `monitorEventLoopDelay` instance (never the boot histogram `/api/health`
  resets); a `max` above the floor self-records `{at, ms, turn: null}` (the
  safety-net feed), then `reset()` the dedicated instance → verify: a synthetic
  500ms block is captured with zero `/api/health` requests AND `/api/health`'s
  own mean/p99/max is unaffected (no reset race)
- [x] 1.3 Surface `eventLoopSpikes` on `/api/health` (additive) in
  `routes/system-routes.ts` → verify: existing health test still passes + new
  field present
- [x] 1.4 Wrap each candidate **event-loop turn** in `performance.now()` in
  `directory-service.ts` and **self-record** `{at, ms, turn}` when a turn's own
  synchronous run exceeds the floor — turns: `tickOpen` (`tickFolderHeads` +
  `reconcileWatchers` + `computeKnownDirectories`, the `setInterval` turn),
  `dirPollPre` (one dir's `pollOne` prefix *before* the worker await: root
  `statMtimeOr` + list-signal `effectiveMtimeOr` stat-fan), `dirPollPost` (one
  dir's continuation *after* the worker resolves: deserialize + broadcast). NOTE
  the per-dir callback is split by `await pollDirectoryGated` into two turns; do
  NOT time across the await. Per-change TOCTOU stamping is already in the worker
  — not a turn → verify: a synthetic block inside a named turn self-records that
  turn (not a per-tick sum); a block straddling the worker await is NOT counted
  as one turn
- [x] 1.5 KEEP the wall `durationMs > TICK_SLOW_WARN_MS` alarm; ADD an
  independent per-turn alarm keyed on a single turn's synchronous
  `performance.now()` run, default threshold 250ms configurable → verify: a
  jitter-only tick (work spread across turns, no single turn heavy) does NOT
  trip the per-turn alarm; a 300ms synthetic single-turn block DOES; the wall
  alarm still fires on a genuinely overdue tick

## 2. Phase 1 — Confirm the culprit

- [x] 2.1 Run the instrumented server under normal load; collect `eventLoopSpikes`
  across ≥30 min → verify: the dominant `turn` behind ~700ms spikes is
  identified with evidence (not a guess). DONE: 63-min live window — 21 named
  spikes, **100% `tickOpen`** (640–705ms, one per 180s interval); dedicated
  sampler `turn:null` spikes corroborate at the same timestamps. Attributed to
  `tickOpen → tickFolderHeads` (ungated `execSync` git-HEAD fan-out).
- [x] 2.2 Record the finding in `design.md` (which branch of Phase 2 applies)
  — DONE: "Attribution result" section added; branch 3.1 selected.

## 3. Phase 2 — Eliminate the attributed turn

> Implement ONLY the branch 2.1 indicts. Do not pre-build all branches. Each
> branch is done only when its named CONTRACT #4 guard test is green.

- [x] 3.1 If `tickOpen → folderHeads`: `setImmediate`-chunk and/or async +
  concurrency-bounded git HEAD reads (prefer over mtime-gating) → DONE:
  `readHeadDisplayAsync` (async `execFile`, non-blocking) + `mapBounded`
  concurrency cap in `folder-head-poll.ts`; `tickFolderHeads` async, awaited
  before the openspec fan-out. Guards green (4.1a):
  `directory-service-folderhead-async.test.ts` asserts per-cwd
  `git_head_update`-before-`openspec_update` ordering AND branch-switch-reflects.
- [x] 3.2 ~~If `dirPollPost → worker deserialize`~~ — N/A: 2.1 indicted
  `tickOpen → folderHeads` (branch 3.1). Not applicable; not implemented per
  "implement ONLY the branch 2.1 indicts".
- [x] 3.3 ~~If `dirPollPost → broadcast`~~ — N/A: branch not indicted (3.1
  applied). Not implemented.
- [x] 3.4 ~~If `dirPollPre → list-signal stat-fan`~~ — N/A: branch not indicted
  (3.1 applied). Not implemented.
- [x] 3.5 (Any branch) Re-run the 20-sample `/api/health` loop → verify:
  `eventLoopDelay.maxMs` stays within a small multiple of `p99` (target: no
  recurring >250ms main-thread stall on an idle-content repo). DONE: Phase-2
  overlay deployed live; 10.7-min window (~3 ticks) → **0 `tickOpen` spikes**
  (was 100% reliable, 21/21). Server log: 0 `slow turn` warnings after the
  Phase-2 boot (line 258546) while folder-head ticks confirmed firing. Residual
  >250ms spikes are the one-time restart boot (3066ms) + a lone unattributed
  270ms `null` (GC/hydration — out of scope).

## 4. Regression + docs

- [x] 4.1 Ensure archived mtime-gate + byte-identical-payload tests still pass
  (`npm test`) → verify: green (server suite green; 2 unrelated pre-existing
  flakes — `doctor-route` probeServer, `event-wiring-source-stamp` — pass in
  isolation, timeout-shaped under parallel load, untouched by this change)
- [x] 4.1a Add the **named CONTRACT #4 guard test(s)** for the branch 2.1
  indicts (only that branch): folderHeads → branch-switch-reflects +
  `git_head_update`/`openspec_update` ordering → DONE + green
  (`directory-service-folderhead-async.test.ts`; folder-head-poll unit tests add
  async/concurrency + branch-switch coverage).
- [x] 4.2 Add a regression test asserting a no-op tick (nothing changed) produces
  no **per-turn self-record** above the floor → verify: green
  (`directory-service-eventloop-turns.test.ts` “4.2 a no-op tick…”)
- [x] 4.3 Update `docs/architecture.md` poll section + the touched directory
  `AGENTS.md` rows (delegated per docs protocol) → DONE: `docs/architecture.md`
  health-endpoint + poll-observability sections extended (subagent, caveman
  style); `packages/server/src/AGENTS.md` + `routes/AGENTS.md` rows added/updated
  directly. `kb dox lint`: only pre-existing `missing-companion` warnings, no new
  violations from these edits.
