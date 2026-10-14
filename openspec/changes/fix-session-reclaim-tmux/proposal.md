## Why

Issue: https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/459 (split
from `fix-tmux-session-shutdown-leak`, related #452).

Every *unattended* reclaim path still terminates through the headless PID
registry only:

- the idle reaper (gear 1 `idle`, gear 3 `phantom`) — `packages/server/src/server.ts:2406`
  injects `killBySessionId: (id) => browserGateway.headlessPidRegistry.killBySessionId(id)`
- the caps reclaim gate — `packages/server/src/embed-lifecycle/caps.ts:41` takes a
  `reclaim(sessionId)` dep documented as "graceful reclaim (killBySessionId)"
- the automation stop / run-completion kill — `packages/server/src/server.ts:3534-3540`
  (`abortSpawnedRun`) calls `reg.killBySessionId` / `reg.killByToken` and nothing else

The registry only holds an entry when a spawn returned a child-process handle
(`spawnResult.process && spawnResult.pid`, e.g.
`packages/server/src/browser-handlers/session-action-handler.ts:896`). A
`tmux` / `wsl-tmux` spawn is an `execFileSync` that returns neither
(`packages/server/src/spawn-process/process-manager.ts:918-924,944-946`), so
`killBySessionId` returns `false` and the ~127 MB `pi` survives. tmux is the
DEFAULT for a server-side spawn (`process-manager.ts:803-812` — only an explicit
`strategy: "headless"` or Electron mode picks headless), and automation spawns,
which are the `ephemeral` sessions the reaper governs
(`packages/automation-plugin/src/server/engine.ts:703-736`), do not pass one.
(`wt` DOES register — it returns `pid`/`process` via `spawnDetached`,
`process-manager.ts:1003-1004` — but the pid it registers is the `wt.exe`
launcher, not pi's. It is covered here by the same `session.pid` rung, not by the
registry.)

Worse, a registry hit is not proof either: `killBySessionId` returns `true` once
the kill has been ISSUED for a known entry, including when `killProcess` reported
`{ok:false}` (`headless-pid-registry.ts:341-345,518-521`,
`packages/shared/src/platform/process.ts:196`). So today no unattended path can
tell a completed termination from an attempted one.

`handleShutdown` already proved the fix: it escalates to `session.pid` through the
shared `killProcess(pid, { timeoutMs: 2000 })` ladder, which is strategy-agnostic
because the server stores the PID from `session_register`
(`packages/server/src/browser-handlers/session-action-handler.ts:1073-1091`). The
unattended paths never learned it, and because they are unattended nobody sees the
failure: the reaper's `onReap` fires regardless of the kill result
(`packages/server/src/embed-lifecycle/idle-reaper.ts:113-121`), so the metrics
count a reap that did not happen.

## What Changes

- Extract the proven escalation into ONE shared terminator
  (`createSessionTerminator`): registry kill (an *attempt*, never a verdict) →
  `session.pid` (or the registry entry's pid) → already-gone check → identity
  guard (unattended callers only) → `killProcess(pid, { timeoutMs: 2000 })` →
  confirm. Liveness uses the existing errno-aware `signalZero`
  (`packages/shared/src/platform/process.ts:152-168`), so an EPERM-live process
  is never read as dead; `isProcessAlive` and its ~15 callers are untouched. It
  reports `{ outcome, terminated, pid }`, `outcome` ∈ `confirmed-dead` /
  `unconfirmed` / `refused-identity` / `no-identity`.
- The identity guard is NEW and conservative: the server stamps
  `pidRecordedAt` when it stores `session.pid`, and an unattended kill signals
  the pid only if `processStartedAt(pid)` (existing helper) is not after that
  stamp. Unverifiable (win32, read failure) ⇒ refuse with a diagnostic, never
  guess.
- `shutdownSession` delegates the ladder only (keeping its advisory
  `{type:"shutdown"}` hint, grace window, marker scan, orphan broadcast,
  unregister + `session_removed`), so there is no second ladder to drift.
- Wire the terminator at every unattended reclaim site: the reaper injection
  (`server.ts:2406`), the caps `reclaim` dep contract, and `abortSpawnedRun`
  (`server.ts:3533-3545`) — including its pre-register window, where the
  terminator reclaims by spawn token (`findPidsBySpawnToken`, the mechanism the
  spawn-register watchdog already uses) because `killByToken` is registry-only.
- Make a failed reclaim observable and bounded: the reaper counts `onReap` only
  on confirmed termination (gear 2 `stop-after-turn` counts on delivery of its
  latch — it terminates nothing), logs a diagnostic naming the session, reason,
  outcome and surviving PID otherwise, retries at most 3 sweeps before giving up
  with one `error`-level line (immediately for `no-identity` /
  `refused-identity`), and a `failedReclaims` counter joins the `/api/health`
  lifecycle snapshot. An undeliverable gear-2 latch is retried each sweep and
  never given up.
- An unconfirmed caps reclaim no longer admits: `admit` refuses with the existing
  structured `CapacityError` rather than exceeding the cap on an unverified kill.
  The give-up state is shared with the caps gate, so a given-up session is never
  re-picked as a victim (it still counts toward the cap).
- Shutdown with no process identity logs a diagnostic instead of releasing the
  record silently (the orphan signal needs a pid, so that case is log-only).
- An unattended reclaim stamps the in-memory `closedReason: "manual"` before
  signalling (withdrawn if termination is not confirmed) — the same pre-signal
  stamp `shutdownSession` uses — so pi's SIGTERM-driven `session_unregister` no
  longer makes a reaped session a shutdown-window recovery candidate.

## Capabilities

### Modified Capabilities

- `openspec/specs/force-kill-handler/spec.md` — the universal-termination
  guarantee extends from the operator-initiated paths (shutdown / force-kill) to
  every server-initiated termination, including the unattended ones (for the
  session's `pi` process, where its identity is verifiable — not on win32 for
  non-headless sessions). MODIFIED: *Ending a session SHALL terminate its
  process for every spawn strategy* (shared ladder = `killProcess`; force-kill
  stays pid-first; watchdog only pre-register), *PID safety check before
  SIGKILL* (start-time guard is the check on unattended paths), *A removal SHALL
  never imply a termination the server did not verify* (log-only when no pid).
- `openspec/specs/embed-session-lifecycle/spec.md` — reap/reclaim is
  strategy-agnostic, and reap accounting reflects confirmed termination.
- `openspec/specs/automation-run-lifecycle/spec.md` — a completed or stopped run
  leaves no resident `pi` for any spawn strategy where its identity is
  verifiable (win32 non-headless: reported, not killed), including the
  spawn-to-register window.
- `openspec/specs/shutdown-session-recovery/spec.md` — server-initiated
  reclaims are intentional closes: stamped `manual` before signalling, so they
  never persist a shutdown-window `liveEpoch`.

### New Capabilities

None.

## Discipline Skills

- `systematic-debugging` — reproduce the registry miss on a real tmux spawn
  (`killBySessionId` → `false`, PID still alive) before changing any injection
  site; the same measurement is the acceptance check.
- `review-code` — before commit, non-trivial server change.
- `observability-instrumentation` — the failed-reclaim diagnostic +
  `failedReclaims` counter are the regression detector for this class of bug.
- `security-hardening` — an unattended kill of a pid the dashboard did not spawn
  must verify identity (start-time guard, refuse on uncertainty).

## Non-goals

- No change to WHEN a session is reaped: the quiescence predicate, gears, and cap
  counting (`quiescence.ts`, `caps.ts` pool + oldest-quiescent sort) are
  untouched. The caps ADMISSION decision changes in one branch — a reclaim whose
  termination is not confirmed now refuses instead of admitting — and given-up
  sessions are excluded from victim selection.
- No unattended reclamation of non-headless sessions on Windows: there is no
  verifiable identity there (`processStartedAt` → `null`; `wsl-tmux` pids live in
  the WSL namespace). Those are diagnosed and given up, not killed on a guess.
- No change to `isProcessAlive` or to process-group killing (a pre-existing gap
  on every path, headless included, against headless-spawn *Process group kill*;
  deltas speak of the session's `pi` process only, and a GitHub issue is opened
  for the gap). No new `closedReason` value: reaps reuse `"manual"`.
- No start-time guard on processes reached through the headless PID registry,
  including entries restored after a server restart (pre-existing; declared in
  the identity delta, follow-up).
- No rewiring of `handleForceKill`. It runs the pid ladder before the registry
  (`session-action-handler.ts:1347-1351`) and has its own no-pid branch;
  converging it would flip signal order on an operator path for no gain here.
- No tmux window/pane addressing. Killing `pi` collapses its pane
  (`remain-on-exit` off), as established by `fix-tmux-session-shutdown-leak` D6.
- No change to the spawn-register watchdog (the never-registered case, already
  fixed).
- `createCapsAdmission` has no production call site today; this change fixes its
  reclaim contract and test coverage, it does not wire the embed front.

## Impact

- `packages/server/src/spawn-process/session-terminator.ts` (new, shared ladder),
  `packages/server/src/browser-handlers/session-action-handler.ts` (delegate),
  `packages/server/src/embed-lifecycle/{idle-reaper,caps,embed-lifecycle-controller,lifecycle-metrics}.ts`,
  `packages/server/src/server.ts` (two injection sites),
  `packages/server/src/session/memory-session-manager.ts` (`pidRecordedAt` stamp),
  new `embed-lifecycle` give-up tracker.
- Protocol: unchanged. Persistence: unchanged (`pidRecordedAt` is in-memory). Config: unchanged
  (`embedLifecycle.enabled` stays `false` by default).
- Migration: none — the terminator is a strict superset of today's registry kill.
  A headless session's registry rung is unchanged, but it is no longer
  byte-identical: the terminator then probes liveness and re-signals through
  `killProcess` if the process is still alive (design Risks).
- Compatibility: a session with no stored `pid` (pre-change record, or a bridge
  that registered without one) degrades to exactly today's behaviour — reported
  as `no-identity`, never counted as a reap. Shutdown keeps its signalling
  unchanged (no identity guard on the operator path).
- Rollback: revert the commit; the injection sites return to
  `headlessPidRegistry.killBySessionId`. No data or protocol state to unwind.
- Risk: a reap now kills a process the registry does not own. Mitigated by the
  start-time identity guard (refuse when unverifiable) and the reaper acting
  only on `ephemeral` sessions. Residuals (start-time tolerance, restored
  registry entries, no group kill on any path, reaps labelled `manual`) are
  listed in design.md Risks.
