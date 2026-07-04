# Attribute and eliminate intermittent event-loop stalls in the poll path

## Why

Users report the dashboard "sometimes seems stuck" — chatlog loading and other
interactions freeze for a fraction of a second, intermittently. Live measurement
against a running production server (`/api/health`) reproduced a concrete signal:

```
eventLoopDelay:  meanMs=20.8   p99Ms=21.3   maxMs=731     ← lone ~700ms spike
recentHydration: wallMs=232    fileBytes=74463            ← unchanged across the stall
```

A 20-sample poll loop caught the transient in the act:

```
elMax=21ms → 180ms → 711ms → 22ms   (p99 stayed 21ms the whole time)
```

Findings, in order of what they rule out:

1. **Not session hydration.** The `hydration` sample did not change during the
   711ms spike — no chatlog was being loaded when the event loop blocked.
   Hydration is already timed + worker-offloadable (`server-session-hydration`).
2. **Not the client.** This is server-side `monitorEventLoopDelay` — the Node
   main thread itself blocked. Every connected WebSocket client freezes for that
   window at once, which is exactly the "server seems stuck" symptom: during the
   block the server cannot flush WS frames, so an in-flight chatlog replay waits.
3. **The `p99≈21ms` / `max≈711ms` shape is a single synchronous operation**, not
   sustained load — a lone main-thread burst, recurring (731ms, then 711ms).

The existing OpenSpec poll optimizations do **not** cover this:

- mtime-gate, spawn-concurrency cap, jitter, and worker-offload of derivation +
  serialization already shipped (archived: `optimize-openspec-poll-burst`,
  `fix-openspec-mtime-gate-blind-spots`, `fix-openspec-mtime-gate-toctou`, and
  the `server-openspec-polling` "derivation runs off the main event loop" req).
- But several things still run **on the main thread**, by that spec's own
  wording — across many distinct event-loop turns: in the `setInterval` turn
  (`tickOpen`), `tickFolderHeads()` (git HEAD reads, **ungated, every tick**),
  `reconcileWatchers`, `computeKnownDirectories`. Then each dir's `setTimeout`
  callback is itself **split by the `await` into two turns**: `dirPollPre`
  (root + list-signal `stat`-fan, before the worker) and `dirPollPost`
  (worker-response **deserialization** + broadcast, after it resolves). None of
  these sum into one synchronous block — the per-change TOCTOU stamping is
  already off-thread in the worker.
- And the existing `TICK_SLOW_WARN_MS = 5000` threshold is effectively **dead**:
  `jitterSeconds` defaults to 5, so a tick's `durationMs` sits at ~4.6s by
  design (it waits out the jitter stagger). The 5s warning fires on benign jitter
  and is blind to the real ~700ms sub-second stalls. Server log confirms: 1,704
  "slow tick" warnings, 9,327 of 9,533 ticks in the 4–6s bucket — almost all
  jitter, not work.

So the true defect is a **sub-5s, unattributed, main-thread stall on the poll
path** that no existing metric records and no existing optimization targets.

## What Changes

Measure-first. We do not yet have byte-level attribution of which synchronous
segment (`tickFolderHeads` git reads vs. broadcast fan-out vs. gate `stat`s vs.
V8 GC) produces the ~700ms burst, so the change is two-phase within one proposal:

**Phase 1 — Attribute (observability):**

- Retain sub-threshold event-loop spikes: a rolling in-memory ring buffer of the
  worst event-loop-delay samples (including sub-5s ones), fed by a **dedicated**
  `monitorEventLoopDelay` instance (not the boot histogram `/api/health`
  reads-and-resets — avoids a reset race), surfaced additively on `/api/health`,
  so a ~700ms stall is recorded even when nobody is polling at the instant it
  happens. Reuses the `hydration-metrics.ts` ring **container** (the sampler
  timer itself is new wiring, but a few lines on an existing surface, not a
  subsystem). **This is the safety-net signal; the per-turn self-records below
  are the authoritative attribution.**
- Attribute the burst to a named **event-loop turn**, not a per-tick segment
  sum. Each instrumented turn (`tickOpen`, per-dir `dirPollPre`, per-dir
  `dirPollPost`) times its own synchronous run with `performance.now()` and,
  when it exceeds a floor, **self-records** `{at, ms, turn}` — no correlating a
  timer sampler to a turn. The dedicated ELD histogram sampler (below) is a
  separate safety-net feed recording `turn: null` for stalls no instrumented
  turn owns. This turns "something blocks 700ms" into "`dirPollPost` deserialize
  blocked 700ms" — and a `turn: null` spike with no matching self-record proves
  the burst is uninstrumented (GC / hydration), not a poll turn.
- Fix the misleading alarm without losing coverage: **keep** the wall
  `durationMs` warning (still catches a genuinely overdue tick) and **add** a
  per-turn warning that fires when any single instrumented turn's synchronous
  time exceeds a threshold (default 250ms). Jitter (spread across turns) does
  not trip the per-turn alarm; a single-turn 700ms burst does.

**Phase 2 — Eliminate (fix the attributed turn):**

- Move the identified synchronous turn off the main loop or yield it. Leading
  candidates: `tickFolderHeads()` (ungated `execSync` git HEAD reads, `tickOpen`
  turn) and the worker-response deserialization (`dirPollPost` turn). Options in
  `design.md`: `setImmediate`-chunk / async-bounded git reads; return the
  pre-serialized string instead of re-materializing worker `data` on the main
  thread.
- Each Phase-2 branch is gated by a named **CONTRACT #4 guard test** —
  archived mtime-gate / TOCTOU, byte-identical-payload, and the `{pending:true}`
  emit must not regress. Known risk vectors (mtime-gating suppressing a
  same-mtime branch switch, async reordering `git_head_update` vs
  `openspec_update`, `broadcast` coalescing breaking byte-identity) are
  enumerated per-branch in `design.md`.

Out of scope: client-side rendering, session-hydration internals (already
covered), and re-litigating the shipped mtime-gate / jitter / worker design.

## Impact

- Affected specs: `server-session-hydration` (ADDED: sub-threshold stall
  retention buffer + dedicated ELD safety-net sampler, no `/api/health` reset
  race), `server-openspec-polling` (ADDED: the poll path self-attributes its
  per-turn synchronous cost; per-turn main-thread work must not block the event
  loop; a per-turn synchronous-time alarm added alongside the retained wall
  `durationMs` alarm).
- Affected code: `packages/server/src/directory-service.ts` (per-turn timing,
  `tickOpen`/`dirPollPre`/`dirPollPost` self-records, `tickFolderHeads` offload,
  per-turn alarm),
  `packages/server/src/server.ts` + `packages/server/src/routes/system-routes.ts`
  (dedicated ELD sampler + spike retention on `/api/health`), a new sibling
  ring-buffer for event-loop spikes reusing the `hydration-metrics.ts` container
  shape.
- No protocol break; `/api/health` additions are additive.
