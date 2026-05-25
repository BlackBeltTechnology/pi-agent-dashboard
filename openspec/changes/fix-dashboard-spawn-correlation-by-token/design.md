## Context

The dashboard server currently tracks "I just kicked off a spawn for this cwd" via a simple counter map:

```ts
// server.ts:482
const pendingDashboardSpawns = new Map<string, number>();
```

Every spawn-issuing handler (`handleSpawnSession`, `handleResumeSession`, `handleHeadlessReload`, ...) bumps `pendingDashboardSpawns.get(cwd) ?? 0` by 1. When `event-wiring.ts` receives a `session_register`, it decrements the counter for the registering session's cwd and, if the counter was positive, stamps the session `source: "dashboard"` and persists that into `.meta.json`.

This is the only place in the server that still uses cwd-only matching. Every other correlation path (`headlessPidRegistry.linkByToken/linkByPid/linkSession`, `pendingForkRegistry.consumeFork`, `pendingClientCorrelations.consume`) already moved to **token-keyed** identity under the existing `spawn-correlation` capability. The source-tag write path was simply missed during that migration.

The defect manifests as: launch `pi` from a terminal in cwd X, while a recent dashboard "Spawn" for cwd X still has a positive counter → the CLI register decrements the counter and gets tagged `dashboard`. The icon renders as the headless robot, and the `.meta.json` sidecar persists the wrong tag across restarts.

A bridge-side defensive guard (in `source-detector.ts`) already prevents the wrong tag from being **read** when a TUI is attached. This change addresses the **write** side so the bad data is never produced.

## Goals / Non-Goals

**Goals:**
- The `source: "dashboard"` stamp SHALL be applied iff there is a strong identity match (token or PID) between an incoming `session_register` and a still-pending dashboard spawn.
- Preserve legacy-bridge support: a bridge that sends neither `spawnToken` nor `pid` SHALL still be matchable via cwd-FIFO, but every such fallback SHALL be logged (parallel to the existing fallback log in `headlessPidRegistry.linkSession`).
- One-shot cleanup of existing wrong `.meta.json` sidecars, so users who already hit the bug recover without manual file surgery.
- No protocol change. `session_register` already carries both `spawnToken` (since the spawn-correlation change) and `pid`.

**Non-Goals:**
- Re-architecting `pendingDashboardSpawns` into a fully timed registry with TTLs (the existing counter is process-lifetime and that's acceptable — dashboard restarts clear it).
- Touching the bridge-side `source-detector.ts` (already corrected and tested in the prior fix).
- Changing how `source` is *displayed* in the UI (icon mapping in `session-status-visuals.ts` is correct; only the data feeding it is wrong).
- Merging `pendingDashboardSpawns` into `headlessPidRegistry`. They have different lifecycles (the headless registry persists across restart via JSON sidecar; pending-spawns are in-memory only and tied to live browser intents). Sharing types is fine; sharing storage is out of scope.

## Decisions

### Decision 1: Replace the `Map<cwd, count>` with a list of token-keyed entries

**Choice:** Introduce a typed registry in `packages/server/src/pending-dashboard-spawns.ts`:

```ts
interface PendingSpawn {
  token: string;        // spawnToken, primary key
  cwd: string;          // secondary key for legacy fallback
  pid?: number;         // optional, set if the spawner captured the child PID
  createdAt: number;    // epoch ms — informational, used for fallback FIFO ordering
}

class PendingDashboardSpawns {
  add(entry: PendingSpawn): void;
  consumeByToken(token: string): PendingSpawn | undefined;
  consumeByPid(pid: number): PendingSpawn | undefined;
  consumeByCwd(cwd: string): PendingSpawn | undefined;   // FIFO, last-resort
  size(): number;                                         // for tests
}
```

`event-wiring.ts` consumes in order:
1. `msg.spawnToken` → `consumeByToken`
2. `msg.pid` → `consumeByPid`
3. `msg.cwd` → `consumeByCwd` (logged as fallback)

Only when one of these returns a non-undefined entry does the server stamp `source: "dashboard"` and write the `.meta.json` sidecar.

**Alternatives considered:**
- **Extend `headlessPidRegistry`** with a "is this spawn a dashboard origin" flag. Rejected: that registry's job is sessionId↔pid mapping for headless processes; non-headless dashboard spawns (tmux, wt) also need source-tagging, so the scope doesn't fit.
- **Keep the counter and additionally check the token before stamping.** Rejected: the counter would still drift when a CLI register in the same cwd "spends" a token-less match. A list-of-entries model with explicit consume operations cleanly removes the right entry.

### Decision 2: Spawn-issuing handlers register a `PendingSpawn`, not bump a counter

**Choice:** Every call site that currently does `pendingDashboardSpawns.set(cwd, (get(cwd) ?? 0) + 1)` SHALL instead build a `PendingSpawn` with the same `spawnToken` it already mints for `headlessPidRegistry.add(...)` / `pendingForkRegistry.recordFork(...)`, and call `pendingDashboardSpawns.add(entry)`.

Call sites (per grep):
- `session-action-handler.ts:242` (resume)
- `session-action-handler.ts:327` (fork)
- `session-action-handler.ts:379` (spawn-new)
- `session-action-handler.ts:450` (attach-spawn)

Each of these already has the `spawnToken` in scope (or can mint it once and pass through the existing `spawnPiSession` invocation that needs it for `headlessPidRegistry`). Refactor is purely mechanical.

### Decision 3: `.meta.json` write is gated by the same identity match

**Choice:** Move the `writeSessionMeta(..., { source: "dashboard" })` call inside the success branch of the new matcher. If only the cwd-FIFO fallback fired, the server SHALL emit a log line **and** still stamp `source: "dashboard"` for backward-compat — BUT this is configurable via a `STRICT_SPAWN_CORRELATION` env flag (default off, on in tests). Once we observe in production logs that cwd-FIFO never legitimately triggers (one full release cycle), we flip the default.

**Rationale:** the only known caller that *doesn't* propagate `spawnToken` today is a pre-spawn-correlation-token bridge (any pi extension version older than the rollout). Refusing the stamp on a cwd-only match would regress those users until they update. The flag lets us drive the migration with telemetry, not guesses.

### Decision 4: One-shot `.meta.json` cleanup utility

**Choice:** Ship `scripts/repair-meta-source.mjs` (Node, no deps). It scans every `*.meta.json` under `~/.pi/agent/sessions/`. For each file with `source: "dashboard"`:
- Read the corresponding `*.jsonl` head — if the first turn shows TUI markers (e.g. `hasUI: true` in the first state-sync entry), remove the `source` field.
- Otherwise, leave it.

The script is idempotent and prints `kept N / cleaned M / errors E`. Documented in `docs/faq.md` under "Why does my CLI session show the headless icon?".

**Alternatives considered:**
- **Auto-repair on server startup.** Rejected: mutating user data on every startup is risky; an explicit one-shot script is auditable and skippable.
- **No cleanup; rely on the bridge guard.** Rejected: the bridge guard fixes the *display*, but the `.meta.json` still contains stale data that other tools (or future code) might consume.

## Risks / Trade-offs

[Risk: a real dashboard-spawned session has neither `spawnToken` nor `pid` in its register (pre-token bridge)] → cwd-FIFO fallback still works; logged so we can quantify exposure. Flag flip waits for "fallback log silent for one release cycle".

[Risk: registry grows unbounded if spawns never produce a register (process crashed before bridge connected)] → `PendingDashboardSpawns` SHALL drop entries older than 60s via a periodic sweeper (same TTL as `pendingClientCorrelations`). Lost entry = no source stamp for that crash recovery — acceptable.

[Risk: refactor introduces a regression in dashboard-spawn source-tagging] → existing `__tests__/event-wiring*.test.ts` covers the happy path; this change adds explicit token-match, pid-match, cwd-fallback, and CLI-no-match cases. CI gate.

[Trade-off: introduces a small new module instead of a one-line patch] → justified because the cwd-only matcher hides three independent concerns (queue insertion, queue draining, sidecar write) in one line of code; the new module makes each testable in isolation.

## Migration Plan

1. **Land the registry refactor** with `STRICT_SPAWN_CORRELATION=0` default. Behaviour is functionally identical to today for known-good paths; logs reveal cwd-FIFO frequency.
2. **Ship the cleanup script** and document it in FAQ.
3. **Run telemetry for one release cycle.** If cwd-FIFO log lines are absent from issue reports, flip default to `STRICT_SPAWN_CORRELATION=1` in a follow-up patch.
4. **Backout** = revert the registry refactor; the cleanup script is idempotent and stays.

## Open Questions

- **Q: Do we need to migrate `pendingDashboardSpawns` into the same persistence layer as `headlessPidRegistry` for restart-survival?**
  Probably no — a dashboard restart between spawn and first register is rare, and the user-visible failure mode is "session shows as TUI source instead of dashboard source", which is recoverable via the cleanup script. Defer until we have evidence it matters.

- **Q: Should the `.meta.json` cleanup script also reverse-stamp `source: "tui"` (or similar) when it removes `dashboard`?**
  Lean no — the bridge re-derives `source` on every register; removing the field is enough. Adding a positive tag would couple the script to source-detector internals.
