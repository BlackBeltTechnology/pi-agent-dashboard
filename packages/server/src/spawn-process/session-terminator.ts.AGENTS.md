# session-terminator.ts — index

ONE termination primitive for every server-initiated kill of a session's `pi` process: the unattended reclaims (idle reaper, caps reclaim, automation stop / run completion) and `shutdownSession`. NOT `handleForceKill` (pid-first order kept on purpose).

Exports: `createSessionTerminator({sessionManager, headlessPidRegistry, ...primitives})` → `{ terminate }`; `Terminate`; `TerminateOptions {graceMs?, spawnToken?, verifyIdentity?, stampManualClose?}`; `TerminateResult {outcome, terminated, pid?}`; `TerminateOutcome` = `confirmed-dead` | `unconfirmed` | `refused-identity` | `no-identity`; `IDENTITY_TOLERANCE_MS` (2000).

Ladder (design D1):
- step 0: `stampManualClose` ⇒ in-memory `closedReason:"manual"` before any signal (record exists, not ended, no reason).
- step 1: `registry.getPid` captured, then `registry.killBySessionId` — an ATTEMPT flag, never a verdict.
- step 2: `pid = session.pid ?? registryPid`; none ⇒ `spawnToken` rung (`registry.killByToken` attempt + `findPidsBySpawnToken` → `killProcess` each → confirm) else `no-identity`.
- step 3: `signalZero(pid)==="esrch"` ⇒ `confirmed-dead`, no signal.
- step 4: `graceMs>0` ⇒ poll `signalZero` (shutdown only).
- step 5: identity guard — only `verifyIdentity` AND `pid===session.pid` AND not registry-owned: `processStartedAt(pid) <= pidRecordedAt + 2000`; null / win32 / missing stamp ⇒ re-probe (esrch ⇒ `confirmed-dead`) else `refused-identity` + diagnostic (`pid reused` | `identity unverifiable on <platform>`); zero signals.
- steps 6–7: `killProcess(pid,{timeoutMs:2000})`; confirm ONLY by `signalZero==="esrch"` (`killProcess.ok` never read; EPERM = alive ⇒ `unconfirmed`).
- step 8: stamp withdrawn (`closedReason: undefined`) when not `confirmed-dead` and record not `ended`.

Contracts: empty `sessionId` = token-only call (no record / registry-by-id rung). Never calls `process.kill` (`no-direct-process-kill` invariant); signals only via `killProcess`, probes via `signalZero`. `isProcessAlive` untouched. Callers: reaper (`graceMs:0, verifyIdentity, stampManualClose`), caps `reclaim` (same), `createAbortSpawnedRun` (+`spawnToken`), `shutdownSession` (`graceMs:SHUTDOWN_GRACE_MS, verifyIdentity:false`).

See change: fix-session-reclaim-tmux.
