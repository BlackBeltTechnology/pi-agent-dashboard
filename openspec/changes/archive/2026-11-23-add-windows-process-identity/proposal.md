# Proposal

## Why

GitHub issue #913 is a follow-up from `fix-session-reclaim-tmux` (decision R5).

On win32, `processStartedAt` returns `null` (`packages/shared/src/platform/process.ts:143`).
The terminator's identity guard therefore refuses every unattended kill of a `wt`
session. After `scope-pids-to-namespace`, `wsl-tmux` sessions are refused as well,
and their force-kill closes only the WebSocket. Either way, those `pi` processes
stay resident after the idle reaper, the caps reclaim, or an automation run
completes.

A `windows-latest` spike (GitHub Actions run `40245592849`, design §Context)
measured what a real check can rely on:
- Windows creation time is exact to the millisecond. Its cost is ~0.3 s warm and
  ~2.8 s cold.
- Windows reuses pids immediately: 200 spawns gave 172 distinct pids.
- WSL pids are readable inside the distribution through `wsl.exe` (~130 ms).
- WSL ↔ Windows clocks differ by ~30 ms.

This change was split: the pid target model and the fixes to the existing
foreign-pid bugs live in `scope-pids-to-namespace`, which this change depends on.

## What Changes

- **Platform module** (`packages/shared/src/platform/process.ts`):
  - an async `probeProcessStart(pid, target)`: Windows `Get-Process` through
    absolute-path Windows PowerShell; POSIX `processStartedAt`; and a skew-immune,
    age-based WSL probe. The target is `{ kind: "host" } | { kind: "wsl", distro }`.
    It has a 10 s timeout. At most 2 PowerShell / `wsl.exe` invocations are in
    flight, shared by probes, verify-and-kill and liveness;
  - `verifyAndKillWindows`: one PowerShell process pins the process handle,
    checks the creation time, and tree-kills;
  - `verifyAndKillWsl`: one `sh -c` inside the distribution checks the process age
    (`minAgeMs`, computed server-side) and runs a group-aware SIGTERM → SIGKILL.
    The group leader is read from `/proc/<pid>/stat`;
  - tri-state `wslLiveness`.

  The kill helpers return `killed | mismatch | absent | error`; `error` is never
  read as dead.
- **The terminator** reclaims Windows `host` targets with `verifyAndKillWindows`
  and WSL targets with `wslLiveness` + `verifyAndKillWsl`. A helper `error` is
  `unconfirmed` (retried by the existing bounded give-up); `mismatch` is
  `refused-identity` (terminal).
- **Force-kill** of a WSL target kills inside the distribution, instead of closing
  only the WebSocket.
- **`guard-restored-headless-identity`'s registry probe** becomes
  `probeProcessStart(pid, {kind:"host"})`. Restored Windows headless entries become
  verifiable.
- **Enforcement test:** no file outside `platform/` may spawn `powershell.exe` or
  `wsl.exe` with a process probe or signal command. Three existing files are
  allowlisted by path: `extension/process-scanner.ts`, the browser-plugin
  `process-identity.ts`, and the tmux spawn in `process-manager.ts`.
- **QA:** `qa/tests/45-windows-reclaim-refused.ps1` asserts the refusal this change
  removes, so it is updated to the verified reclaim. The new Windows driver is
  `qa/tests/53-windows-process-identity.ps1`.
- **Spec deltas:**
  - `force-kill-handler`: Unattended reclamation and Force kill process
    escalation, rebased on `scope-pids-to-namespace`;
  - `command-executor`: the single-source helper list, the probe, and the two
    verify-and-kill helpers.

## Decisions

- **Q7 (decided):** a transient probe or helper failure is `unconfirmed`. The
  existing give-up tracker retries it up to 3 times, so no stacking on #914's
  identity requirement is needed. A start-time mismatch is `refused-identity`
  (terminal).
- **Q8 (decided):** `unknown` on a Windows server keeps today's signal on operator
  paths (already reflected in the resolved-target requirement).
- **W1–W13 (decided):** helper result mapping, WSL age bound, limiter scope,
  input validation, output markers, enforcement allowlist, handle-pin CI check
  and target normalisation. Each is recorded in `design.md`.

Decided in design:
- **Q4:** Windows PowerShell 5.1 `Get-Process`, absolute path, handle pinned.
- **Q5:** WSL kill is group-aware, mirroring #912.
- **Q6:** a 10 s timeout.

## Capabilities

### New Requirements

- `command-executor`:
  - *Process start time is probed through the platform module*;
  - *A WSL-target pid is verified and terminated inside its distribution*;
  - *A Windows host pid is verified and killed in one invocation*;
  - *Process helper invocations are bounded and validated*.

### Modified Capabilities

- `force-kill-handler`:
  - *Unattended reclamation SHALL terminate the session process for every spawn
    strategy*;
  - *Force kill process escalation*;
  - *Ending a session SHALL terminate its process for every spawn strategy*;
  - *A recorded pid is used only in its resolved pid target*.

  All four are rebased on their predecessors in the chain.
- `command-executor`:
  - *Single-source process-termination module*;
  - *Cross-platform tree termination uses killProcess* (rebased on the
    `group-aware-kill-process` archive).

## Impact

- `packages/shared/src/platform/process.ts`: the new helpers, via the async
  `exec.ts` wrapper.
- `packages/server/src/spawn-process/session-terminator.ts`: Windows and WSL
  dispatch.
- `packages/server/src/browser-handlers/session-action-handler.ts`: WSL force-kill.
- `packages/server/src/spawn-process/headless-pid-registry.ts`: the injected probe.
- **Compatibility:** POSIX is unchanged. On Windows, sessions that were previously
  refused become reclaimable.
- **Rollback:** revert.
- No migration.
- **Ordering:** `dependencies.yaml` is `blocked_by` `scope-pids-to-namespace` and
  `guard-restored-headless-identity`.
- **Verification:** a `windows-latest` CI leg (with WSL via `Vampire/setup-wsl`)
  runs the helpers against real processes, including the handle-pinning check. A
  live `wt` / `wsl-tmux` reclaim on a desktop install is a manual QA row.

## Discipline Skills

- `security-hardening`: a destructive kill on a host that reuses pids immediately.
  Verify-and-kill runs in one invocation.
- `performance-optimization`: the probe costs 0.3–2.8 s; the limiter and the
  timeout bound it.
- `doubt-driven-review`: the handle-pinning assumption and the WSL residual race.
- `review-code`: non-trivial changes to the platform module and the terminator.
