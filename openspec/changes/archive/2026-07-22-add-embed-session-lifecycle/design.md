## Context

A headless/embedded deployment accumulated 35 live sessions for 3 unique visitors (~6.7 GiB
aggregate RSS), because session reuse is browser-local and the server has no per-session
idle reaper or active-session cap (issue #383). The dashboard already ships every mechanical
primitive to fix this — a graceful kill ladder (`headlessPidRegistry.killBySessionId`), a
graceful quiesce-then-exit (`stop_after_turn` → `ctx.shutdown()`), a version-normalized "at
rest" event (`agent_settled`, guaranteed once-per-run on every supported pi by
`agent-settled.ts`), a `process-classifier` pid-tree probe, and a cwd-keyed spawn/resume
convergence pattern (`pendingDashboardSpawns` + `pendingResumeRegistry`). What is missing is
**classification** (nothing distinguishes a disposable embed session from a human coding
session) and **policy** (nothing wires the primitives into acquire/reap/cap loops).

Constraints: pi 0.80.10 is pinned, floor 0.78.0; on 0.80.10 resume rebuilds ONLY from the
append-only session file, so a fully-quiescent session is lossless to runtime-kill while a
busy one is not. The change must not alter interactive coding-session semantics (the "pi
survives disconnect/restart" durability invariant) and must be inert on upgrade.

## Goals / Non-Goals

**Goals:**
- Distinguish machine-fronted (`ephemeral`) sessions from interactive (`durable`) ones, and
  scope all reclamation to `ephemeral`.
- Idempotent, server-owned acquire keyed by a visitor identity so reopen/refresh/tabs/races
  converge on one session.
- A lossless idle reaper (quiescence-gated) plus a phantom escape hatch that clears wedged
  `streaming` sessions.
- Per-visitor + global caps with graceful reclaim, never terminating active work.
- Observability for every acquire/reap/cap decision.
- Ship entirely at the current 0.78.0 floor; no pi upgrade, no floor bump.

**Non-Goals:**
- No bridge or pi protocol change; no new pi feature adoption.
- No pi compatibility-floor bump (own change series; unnecessary here).
- Not building the embed widget or chat-gateway UI fronts. This change ships the shared
  server layer AND wires the existing qualifying spawn call-sites to opt in — the dashboard
  embed acquire path and automation/flow-triggered spawns set `lifecyclePolicy:"ephemeral"`
  so the reaper/caps have real producers and #383 is E2E-testable. The chat gateway sets the
  marker when it lands (out of scope here).
- No change to `durable` coding-session lifecycle.

## Decisions

**D1 — Provenance as an orthogonal `lifecyclePolicy`, not source-only; persisted.**
Add `source:"embed"` AND an orthogonal `lifecyclePolicy?: "ephemeral" | "durable"` (absent ⇒
durable). Alternative considered: overload `source` alone (e.g. reap anything sourced
`embed`). Rejected — chat-gateway and automation also spawn disposable sessions without being
"embed", and a future front shouldn't need a new `source` value to opt in. An orthogonal
policy flag lets any front mark disposability independently of its transport identity.
**The marker MUST round-trip through `.meta.json` and be restored by `session-scanner` on
cold start** — else a server restart reclassifies every `ephemeral` session as `durable`
(absent ⇒ durable) and they escape reaping forever, re-creating the reported cross-restart
accumulation. "Absent ⇒ durable" is safe for legacy data but MUST NOT be reachable via
marker loss on a known ephemeral session. **Cold-start settle seeding:** `lastSettledAt`
(D3) is a live event capture, not persisted, so a rehydrated ephemeral session has no settle
timestamp until its next run — the quiescence gate could not evaluate "at rest" and would
stall. On rehydration the last-settled timestamp is seeded from the session-file mtime
(mirroring the existing `lastActivityAt` cold-start seed in `session-scanner`), so a restored
quiescent session is immediately evaluable.

**D2 — Reap only quiescent sessions (lossless by construction), not busy sessions via soft
vetoes.** The reaper's predicate is a positive "at rest" union, not a best-effort blocklist
over event-derived signals. Rationale: on 0.80.10, resume reconstructs only the persisted
session file; the in-memory `followUp`/`steering` queue and any in-flight `ask_user` promise
die on kill. So the ONLY provably lossless reap target is a session with nothing in flight.
This collapses the soft/hard signal-trust problem — we require every signal clear rather than
gamble on any single one. Alternative considered: reap on `lastActivityAt` age with per-
signal vetoes. Rejected — under-counting any signal destroys live work.

**D3 — Gate "at rest" on the normalized `agent_settled`, not inferred `status`.** `status`
is derived from `agent_start`/`agent_end`; a missed `agent_end` leaves it stuck at
`streaming` forever — which is almost certainly the reported 35-session leak. The bridge
already guarantees exactly one `agent_settled` per run on every supported pi (native ≥ 0.80.4,
synthesized below). Keying on `agent_settled` needs no `piVersion` branch in the reaper.
Alternative: raise the floor to ≥ 0.80.4 for native-only. Rejected (see D7). **Correction to
the "reuse existing signals" framing:** the bridge *forwards* `agent_settled`, but the server
does NOT currently capture it — `event-wiring.ts` reduces only `agent_start`/`agent_end`/
`tool_execution_*`. This change adds a small, passive `lastSettledAt` capture in
`event-wiring.ts` (feeds only the disabled-by-default reaper; no runtime behavior change when
off). It is new server code, not a pre-existing readable field.

**D4 — Three-gear reaper.** (1) quiescent+idle+unwatched → `killBySessionId` now;
(2) streaming+unwatched+past-timeout → `stop_after_turn` (finish turn, clean shutdown);
(3) wedged → force reap, reason `"phantom"`. Gear 3 is the escape hatch that clears stuck
sessions gear 1 would never touch. Alternative: single hard-kill gear. Rejected — hard-kills
lose mid-turn work (gear 2) and a pure quiescence gate never fires on stuck-streaming (needs
gear 3). **Gear-3 safety correction:** the phantom predicate MUST additionally require no
pending `ask_user` AND empty `followUp`/`steering` queues — otherwise a session merely
blocked awaiting human input (~0 CPU, no children, `streaming`, closed-embed = no subscriber)
satisfies the naive predicate and its in-flight ask is destroyed. **Gear-2 safety
correction:** gear 2 MUST also require empty `followUp`/`steering` before choosing
`stop_after_turn` — a clean `ctx.shutdown()` at `turn_end` discards the in-memory queue, so a
streaming+idle session with queued work must be left to drain, not stopped. **Gear-3 kill
correction:** phantom reap MUST use the graceful `killBySessionId` ladder
(SIGTERM→grace→SIGKILL), not a bare SIGKILL, to bound the append-only session-file mid-write
window (Risk below). **Liveness-probe correction:** "~0 CPU / no live child of *this*
session" is NOT an existing passive signal — `process-classifier` carries no CPU field and
does not walk the pid child tree. This change adds a new bounded liveness probe (CPU +
child-tree walk) that serves BOTH the quiescence gate's child check (gear 1) AND phantom
detection (gear 3) — it is not phantom-only; gear 1's "no live child" condition depends on the
same probe.

**D5 — Server owns the identity→session mapping across resume's fresh-sessionId renumber.**
Resume mints a NEW sessionId, so `visitorId → sessionId` cannot be authoritative in the
browser. The server keeps `identityKey → current live sessionId` and re-points it on each
reap→resume cycle; `localStorage` is a stale-tolerant hint only. Alternative: trust the
browser map. Rejected — that IS the current bug (localStorage loss → duplicate spawn).

**D6 — Acquire uses a promise-coalescing map, inspired by (not identical to) the
`pending*Registry` pattern.** The existing `record`/`consume` registries hand an entry to
ONE consumer and delete it (`pendingDashboardSpawns` is a counter) — they de-dup *intents*
but do NOT fan one result out to N waiters. Acquire therefore needs a
`identityKey → Promise<Session>` coalescing map: the first acquire creates the in-flight
promise, concurrent acquires await it, and **the promise resolves only when the spawned/
resumed session's `session_register` arrives** (not when the spawn call returns). This closes
the spawn→register window in which a second acquire would otherwise see no live session and
start a second `pi` — including on the resume path, which mints a fresh sessionId. The
in-flight promise MUST carry a bounded timeout: a spawn that never emits `session_register`
(bridge bug, pi crash mid-register) would otherwise hang every coalesced waiter forever — on
timeout the promise rejects and the entry is cleared. Alternative: reuse `pending*Registry`
verbatim. Rejected — it doesn't converge waiters and doesn't span register.

**D7 — No pi floor bump.** Every needed signal is ≤ floor (`hasPendingMessages` @ 0.32,
`streamingBehavior` @ 0.77, graceful `session_shutdown` ≤ 0.68) or bridge-normalized
(`agent_settled`). A bump would only delete the `agent-settled.ts` synth shim (cleanup, not
capability) while dropping 0.78.0–0.80.3 users and violating the "floor series owns the
floor" separation. Recorded as spec requirement #9 so it can't silently regress.

**D8 — Off by default.** Enable flag + all thresholds default-inert. With the feature off and
no `ephemeral` spawns, behavior is byte-for-byte unchanged. Alternative: on with a
conservative default. Rejected for this change to guarantee a zero-surprise upgrade; an
operator opts in.

**D9 — Caps reclaim oldest-quiescent-first, else structured error.** At a cap, reclaim the
oldest safely-idle `ephemeral` session before spawning; if all candidates are busy, return a
structured capacity error rather than kill active work. Counts exclude `durable` sessions.
Reclaim awaits the graceful kill ladder (~2 s) — so acquire latency under cap pressure is
bounded by it; reclaim SHOULD run without holding unrelated acquires. Reaper and caps SHALL
coordinate via a "being-reclaimed" set so they never double-select the same candidate (which
would otherwise spuriously surface a capacity error after a benign double-kill).

**D10 — Canonical cwd in the identity key.** `identityKey` uses the realpath-resolved,
case-normalized cwd. Alternative: raw cwd string. Rejected — symlinks, worktrees, and
case-insensitive filesystems (macOS default) map one physical dir to many strings → distinct
keys → duplicate sessions for one visitor/cwd (violates the "≤ one session" guarantee).

**D11 — Global cap is the hard security bound; cwd is allowlisted.** An untrusted visitor
controls `visitorId` and `cwd`, so it can mint unlimited `identityKey`s and defeat the
per-visitor cap. Therefore: the GLOBAL cap is the adversarial bound; the per-visitor cap is
fairness for trusted identities only; and acquire validates cwd against a server-side
allowlist (reusing the chat-gateway `allowedRoots` pattern) before spawning. Alternative:
trust the per-visitor cap. Rejected — trivially spoofable.

**D12 — Post-spawn/resume grace window.** A freshly spawned or resuming session has no
activity events or subscriber yet (and resume seeds `lastActivityAt` from an old session-file
mtime), so it can satisfy the idle predicate and be reaped on arrival. Acquire-created and
`resuming` sessions SHALL be exempt from reaping until a grace window elapses or their first
activity event arrives. Alternative: no grace. Rejected — reaps a session before it starts.

## Risks / Trade-offs

- **Reaping a session a human still cares about** → Mitigation: the "no active subscription"
  clause + optional host lease heartbeat; `durable` sessions are entirely out of scope; reap
  is runtime-only and resumable, so worst case is a transparent resume, not lost history.
- **Phantom valve force-kills a genuinely long single turn** → Mitigation: hard ceiling set
  far above any real turn AND pid-tree-CPU/child checks AND no-watcher; a real long turn keeps
  `currentTool` set and a live child, failing the phantom predicate.
- **Terminal/child-process scoping** → terminals are cwd-keyed (weak veto — survive the pi
  kill); pi-spawned children are pid-tree (strong veto — die with pi). Conflating them either
  over-protects a shared cwd or kills a running dev server. Mitigation: scope the veto by
  ownership, not by cwd.
- **`ephemeral` mislabeling a coding session** → Mitigation: default is `durable`; only a
  front that explicitly sets `ephemeral` opts in; caps/reap never touch `durable`.
- **Acquire identity spoofing (untrusted visitor)** → Mitigation: the GLOBAL cap is the hard
  bound (D11); cwd is allowlisted; a visitor must not reuse or reap another visitor's
  session. Full threat-model in `security-hardening`.
- **Whole-server idle-timer coupling** → `idle-timer.ts` shuts the entire server down when
  `piGateway.connectionCount() === 0` past `shutdownIdleSeconds` (if `autoShutdown` on).
  Aggressive ephemeral reaping drops connection count faster and can accelerate a
  whole-server shutdown that orphans durable sessions. → Mitigation: reaping ephemeral
  sessions MUST NOT trigger auto-shutdown while any durable session or live connection
  exists; verify the interaction explicitly.
- **Phantom SIGKILL mid-write corrupts the session file** → gear 3 force-kills a wedged
  session that may be mid-flush to the append-only session file, risking a partial trailing
  entry that breaks resume (pi's loader throws on a non-empty unparseable file). → Mitigation:
  verify `loadEntriesFromFile` tolerates a trailing partial line (JSONL loaders usually skip
  it); if not, prefer SIGTERM-with-grace even in gear 3, and treat a corrupt-file resume as a
  handled error, not a crash.

## Migration Plan

Additive and default-inert — no data migration. `SessionSource` gains `"embed"`;
`DashboardSession` gains optional `lifecyclePolicy` (absent ⇒ durable); older bridges and
persisted `.meta.json` load unchanged. New config keys (enable flag, idle timeout, hard
ceiling, `maxActiveEmbedSessionsPerVisitor`, `maxActiveEmbedSessionsGlobal`) default to
disabled/inert under `~/.pi/dashboard/config.json`. Rollback: set the enable flag false (or
downgrade) — the marker field is ignored and every session reverts to durable semantics.

## Open Questions

- **Heartbeat in v1 or deferred?** Is "no active browser subscription" a sufficient presence
  signal for v1, or is the host→iframe lease heartbeat needed immediately for accuracy?
- **followUp on resume — forbid (v1) vs persist-and-replay (v2)?** v1 forbids reaping while
  `followUp` is non-empty. Should a later change persist the queue across resume so even that
  reaps safely?
- **Caps reclaim fairness** — strictly oldest-quiescent, or bias toward the visitor over their
  own quota before touching global?
- **Where do lifecycle counters live** — `/api/health` inline vs a dedicated JWT-gated
  diagnostics endpoint (matching model-proxy diagnostics)?
