# Add server-side lifecycle controls for embedded/headless sessions (reuse, idle reaping, caps)

## Why

Machine-fronted sessions accumulate indefinitely. A production Linux/Bubblewrap/headless
deployment (based on v0.5.4) was observed holding **35 live embedded sessions** for only
**3 unique visitors** (16/15/3 each), the oldest ~9 h old — 35 `pi` processes, 35 RPC
keepers, 70 Bubblewrap wrappers, 143 processes in the service cgroup, ~6.7 GiB aggregate
RSS. The main server was ~337 MiB PSS; the cost is lifecycle **retention**, not a heap
leak. (Issue #383.)

The dashboard has every primitive to fix this but never wires them into a policy:

- **Session reuse is client-local.** In the embed surface, the visitor→session map lives
  only in browser `localStorage`. Cleared storage, a second browser context, or two racing
  tabs each spawn another session. The server persists no idempotency key.
- **No per-session idle reaper.** The only sweep is `headless-pid-registry.ts`'s 7-day
  `MAX_ORPHAN_AGE_MS`, which reaps **cross-restart orphans** — a live, connected-but-unused
  session is never an orphan, so it is never reclaimed.
- **No active-session caps.** Nothing bounds sessions per visitor or globally.
- **Browser disconnect does not reclaim.** Disconnect drops subscriptions but deliberately
  leaves the headless session alive (the "pi survives dashboard restart" durability
  invariant) — correct for interactive coding, wrong for a closed embed widget.

The gap is **classification + policy**, not machinery. Verified enabling facts (current
code, pi 0.80.10 pinned, floor 0.78.0):

- **Graceful kill** exists: `headlessPidRegistry.killBySessionId` runs the SIGTERM→2 s→
  SIGKILL ladder (`fix-keeper-kill-escalation`).
- **Graceful quiesce-then-exit** exists: the `stop_after_turn` latch (pi 0.72+) finishes
  the current turn, then calls `ctx.shutdown()` at `turn_end`.
- **An authoritative "at rest" signal** exists and is already version-normalized: the
  bridge (`agent-settled.ts`, `adopt-pi-074-080-features`) forwards **exactly one
  `agent_settled` per run on every supported pi** — native ≥ 0.80.4, synthesized after
  `agent_end` on 0.78.0–0.80.3. So a reaper can gate on `agent_settled` **at the current
  0.78.0 floor with no `piVersion` branch and no floor bump.**
- **Busy signals** exist across the server: `session.status` / `currentTool`,
  `pendingUiRequests` + `pendingPromptBusRequests` maps (unanswered `ask_user`),
  `pendingQueues.followUp` (mirror of pi's in-memory queue), `terminalManager.list()`
  (cwd-keyed), `process-classifier` (session→pid map; the pid-child-tree + CPU walk needed
  for the "no live child" check is a NEW bounded probe this change adds), active browser
  subscriptions, and `lastActivityAt`.
- **Concurrency convergence** exists as a pattern: `pendingDashboardSpawns` +
  `pendingResumeRegistry` (cwd-keyed, `record`/`consume`/expiry) already converge
  spawn/resume intents; the whole `pending*Registry` family is the template for an acquire
  gate re-keyed to a visitor identity.
- **Resume is lossless for quiescent sessions.** On 0.80.10, resume tears down the runtime
  and rebuilds **only** from the append-only session-file entries; the in-memory
  `followUp`/`steering` queue and any in-flight `ask_user` promise do **not** survive. A
  fully-quiescent session therefore loses nothing on a runtime kill; a busy one can.

## What Changes

Add a shared, provenance-scoped **session lifecycle layer** in the dashboard server that
governs machine-fronted sessions without touching interactive coding-session semantics.
**Off by default** — zero behavior change on upgrade until an operator opts in.

- **Provenance discriminator (prerequisite).** Extend the session record with a reusable
  lifecycle marker so a machine-fronted session is distinguishable from a human coding
  session. Add `source:"embed"` to `SessionSource` and an orthogonal
  `lifecyclePolicy?: "ephemeral" | "durable"` (default `durable` — every existing session
  keeps today's forever-durability). Any front — the embed widget, `add-chat-gateway`,
  automation/flows — can mark its spawns `ephemeral`. Reaping and caps act **only** on
  `ephemeral` sessions. The marker is **persisted to `.meta.json` and restored on cold
  start** (a restart must not reclassify `ephemeral` → `durable`). This change also **wires
  the existing qualifying producers** — the dashboard embed acquire path and
  automation/flow-triggered spawns set `ephemeral` — so the reaper/caps have real work and
  #383 is end-to-end testable; the chat gateway self-wires when it lands.

- **Idempotent, server-side acquire.** A `visitor-session-registry` keyed by
  `identityKey = (visitorId | channelId | trigger) + canonical cwd + agent/profile
  identity` over a **realpath-resolved, case-normalized (canonical) cwd** so
  symlinks/worktrees/case-variants collapse to one key. `acquire(identityKey)` atomically:
  (a) returns an existing live compatible session; (b) resumes the most recent compatible
  ended session when policy permits; or (c) validates the cwd against a server-side allowlist
  and spawns exactly one. Concurrent acquires for one key **coalesce onto a single in-flight
  result held until `session_register` arrives** (the whole spawn→register window, resume
  included — a `key → Promise<Session>` map, not the one-consumer `pending*Registry` clone).
  The server owns the key across resume's **fresh-sessionId renumbering**; browser
  `localStorage` becomes a stale-tolerant hint, never the source of truth.

- **Idle reaper with a quiescence gate.** A periodic sweep reaps an `ephemeral` session
  only when it is provably **at rest** — a union predicate over the existing signals:
  the server-captured `agent_settled` is the latest terminal signal (not mid-run),
  `currentTool === null`, no pending `ask_user` in the maps, `pendingQueues.followUp`/
  `steering` empty, no live child in the pi pid tree, no live terminal PTY in the session's
  cwd, no active browser subscription, not within a post-spawn/resume grace window, and
  `lastActivityAt` age > the configured idle timeout. A quiescent reap is lossless by
  construction. Three gears:
  1. **quiescent + idle + unwatched** → `killBySessionId` now;
  2. **mid-turn but idle-trending + unwatched** → `stop_after_turn` (finish the turn, clean
     `ctx.shutdown()`), then end;
  3. **phantom** (wedged: past a hard ceiling ≫ any real turn, pid tree at ~0 CPU via a new
     liveness probe, no live child, no watcher, **no pending `ask_user`, empty queues**) →
     force reap with a distinct reason — the escape hatch that clears the reported
     35-session symptom without ever killing a session merely blocked on human input.
  Reaping marks the runtime session ended, **preserves the session history**, and leaves it
  resumable by a later `acquire`.

- **Active-session caps.** Configurable `maxActiveEmbedSessionsPerVisitor` and
  `maxActiveEmbedSessionsGlobal`, scoped to `ephemeral` sessions. On limit, reclaim the
  oldest **safely idle** (quiescent) session first; if every candidate is busy, return a
  structured capacity error instead of terminating active work. The **global cap is the hard
  security bound** (an untrusted visitor can spoof `visitorId`/`cwd`, so the per-visitor cap
  is fairness for trusted identities only). Interactive/`durable` sessions are never counted
  or reclaimed.

- **Observability.** Expose active/idle embedded counts, reaped count + reason
  (`idle` / `stop-after-turn` / `phantom`), capacity-rejection count, acquire reuse
  hit/miss, and per-session last-activity — via `/api/health` and/or a JWT-gated
  diagnostics endpoint, matching the existing model-proxy diagnostics pattern.

- **Optional host→iframe lease heartbeat (additive).** The embed host MAY send a periodic
  `visibility`/lease beat to sharpen last-activity accuracy. Server-side activity signals +
  caps remain authoritative — the host page cannot be trusted to send a final close event.

**No pi floor bump.** Every signal the mechanism needs is at or below the 0.78.0 floor
(`hasPendingMessages` @ 0.32, `streamingBehavior` @ 0.77, graceful `session_shutdown`
≤ 0.68) or already bridge-normalized (`agent_settled`). Raising the floor would only delete
the `agent-settled.ts` synth shim — a cleanup, not a capability — at the cost of dropping
0.78.0–0.80.3 users. Out of scope.

## Capabilities

### Added Capabilities

- `embed-session-lifecycle`: a provenance-scoped server-side lifecycle control plane for
  machine-fronted (`ephemeral`) sessions — idempotent visitor-keyed acquire/reuse, an
  idle reaper gated on a lossless quiescence predicate with a phantom-liveness escape
  hatch, per-visitor + global active-session caps with graceful reclaim, and diagnostic
  counters — leaving interactive `durable` coding sessions at their existing forever
  semantics.

## Impact

- **Off by default; additive.** With the feature disabled (default) and no `ephemeral`
  spawns, nothing reaps, caps, or reuses — runtime behavior is unchanged. (The one always-on
  addition is a passive `lastSettledAt` capture in `event-wiring.ts`; it only feeds the
  disabled reaper and changes no observable behavior.)
- **Scoped by provenance.** Reaping and caps touch only `lifecyclePolicy:"ephemeral"`
  sessions. A human's `dashboard`/`tui` coding session is never reaped or counted — the
  durability invariant is preserved.
- **New server code:** a `visitor-session-registry` (acquire + promise-coalescing identity
  map + cwd allowlist), a `lastSettledAt` capture in `event-wiring.ts`, an idle reaper loop
  + quiescence predicate aggregator, a bounded phantom liveness probe (CPU + pid-child walk),
  a caps admission gate, and diagnostic counters. Reuses `killBySessionId` and the
  `stop_after_turn` path; extends `process-classifier` (adds the liveness probe) and the
  `pending*Registry` idiom (into a waiter-coalescing map).
- **Shared type change (additive):** `SessionSource` gains `"embed"`; `DashboardSession`
  gains `lifecyclePolicy?`. Absent ⇒ `durable`; older bridges/persisted metas need no
  migration.
- **New config (all default-inert):** enable flag, idle timeout, hard ceiling,
  `maxActiveEmbedSessionsPerVisitor`, `maxActiveEmbedSessionsGlobal`, under
  `~/.pi/dashboard/config.json`.
- **Security surface:** an untrusted embed visitor can cause a spawn and controls
  `visitorId`/`cwd`. The **global cap** is the hard blast-radius bound (the per-visitor cap
  is spoofable → fairness-only); a **server-side cwd allowlist** bounds spawn locations;
  provenance keeps reaping off `durable` sessions; the reaper reclaims idle load. No bridge
  or pi protocol change.
- **No pi upgrade / no floor bump.** Buildable entirely at the current 0.78.0 floor.

## Discipline Skills

- `security-hardening` — an untrusted embed/visitor drives session spawns that run code.
  Threat-model the acquire path (identity spoofing, cross-visitor reuse), the caps as a
  DoS bound, and the reaper's kill authority; ensure a visitor cannot reuse or reap
  another visitor's session.
- `performance-optimization` — the whole change is a resource-reclamation path with a
  measured regression (6.7 GiB / 35 idle procs). Establish the before/after resource
  baseline; verify reaping + caps actually bound aggregate RSS and process count.
- `observability-instrumentation` — the acquire/reap/cap decisions must be diagnosable
  ("why did my embed spawn a second pi", "why was my session reaped"); the counters and
  per-decision reasons are a first-class deliverable, not an afterthought.
