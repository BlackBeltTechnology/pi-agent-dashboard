# Design

## Context

Line numbers refer to `origin/develop` at planning time.

- `processStartedAt` is null on win32 (`packages/shared/src/platform/process.ts:141-143`).
  The terminator's identity guard (`session-terminator.ts:147-160`) therefore
  refuses every `wt` session. `scope-pids-to-namespace` refuses WSL targets and
  makes force-kill of them WebSocket-only.
- The pid target model, `pidNamespace`, and the fixes to the existing
  foreign-pid bugs are defined in `scope-pids-to-namespace` (a blocker).
- Prior art: `packages/extension/src/process-scanner.ts:139-153,257` parses
  Windows `CreationDate` via `Get-CimInstance`.

**Spike facts (GitHub Actions `windows-latest`, run `40245592849`):**

| Probe | Result |
|---|---|
| Windows `Get-Process` `.StartTime` (PowerShell 5.1) | exact to the ms; warm 278–430 ms; cold ~2.8 s |
| CIM `CreationDate` | identical value; ~355 ms; 2 pids in one call 365 ms |
| Dead pid | empty output |
| Windows pid reuse | 200 spawns gave 172 distinct pids |
| WSL pid seen from the Windows side | not visible |
| WSL `/proc` + `btime` start | −0.7 s vs the Windows clock (whole-second `btime`) |
| WSL ↔ Windows skew | ~30 ms on a fresh VM |
| `wsl.exe --exec` call | ~130 ms |
| `wsl.exe --exec kill -TERM` | works |

## Decisions

### D1 — The pid target comes from `scope-pids-to-namespace`

This change consumes `resolvePidTarget` (`host | {wsl, distro} | legacy-wsl | foreign | unknown`)
and the stored `pidNamespace` from `scope-pids-to-namespace`. That change already
refuses non-local and `unknown` targets on unattended paths. It fixes the linking,
carrier-loss, reaper, watchdog and process-list consumers, and it refuses
force-kill of a WSL target. This change replaces the WSL refusal and the Windows `host` refusal with verified
kills. `legacy-wsl` (no distro known) stays refused.

| Target on a Windows server | unattended reclaim | operator shutdown | force-kill |
|---|---|---|---|
| `host` | `verifyAndKillWindows` (max start = `pidRecordedAt + tol`) | `killProcess` (today) | `killProcess` (today) |
| `{wsl, D}` | `wslLiveness` + `verifyAndKillWsl` with the age check (`minAgeMs`, W4) | `verifyAndKillWsl`, no start check | `verifyAndKillWsl`, no start check |

POSIX servers are unchanged. An unattended reclaim of a `host` or WSL target with
no `pidRecordedAt` cannot compute its bound and stays `refused-identity`.

**W13 — target type.** The resolved target is passed to the platform helpers as
`{ kind: "host" } | { kind: "wsl", distro }` everywhere (terminator, force-kill,
registry probe). A bare string such as `"host"` is not a valid target; the probe
returns `null` for it.

### D2 — Windows reclaim results

`verifyAndKillWindows` and `verifyAndKillWsl` return
`killed | mismatch | absent | error` (W1):
- `absent` requires an explicit marker from the script. Empty output is `error`.
  The terminator treats `absent` as confirmed only after a liveness re-check.
- `error` covers a non-zero exit, a timeout, unparsable output, invalid input and a
  `StartTime` access denial. The terminator maps it to `unconfirmed`, never to
  `confirmed-dead`. `reclaim-give-up.ts` already retries `unconfirmed` up to 3
  attempts, so a transient failure gets a bounded retry without any new tracker
  (Q7).
- `mismatch` is proof that the pid is gone or was replaced. The terminator maps
  it to `refused-identity` (terminal: the tracker gives up at once).
- A `killed` result is still confirmed by a liveness re-check.
- **W10 output grammar.** The script's trimmed stdout must equal exactly one
  marker (`killed`, `mismatch` or `absent`). Banner noise, a second token, another
  case or an empty string is `error`.
- **W7 markers.** Both scripts print an explicit result marker. Absence is
  reported only by the marker, never inferred from exit codes or localised error
  text. The WSL script forces `LC_ALL=C`.
- **W3 operator paths.** Force-kill and shutdown map `error` to `success:false`
  with a "not terminated" message (shutdown: unconfirmed plus the orphan signal)
  and `absent` to success ("already gone").
- **W2 unattended WSL.** When `wslLiveness` is `unknown`, the reclaim is
  `unconfirmed` and `verifyAndKillWsl` is not run. The in-script check is the
  safety, and the next bounded retry recovers a transient blip.

### D3 — The start-time probe (async, in the platform module)

`probeProcessStart(pid, target, {timeoutMs = 10_000}) → epoch ms | null`:
- **win32 host:** runs
  `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -Command …`
  through the async `exec.ts` wrapper (`windowsHide`). It uses `Get-Process -Id <pid>`
  `.StartTime` → `ToUnixTimeMilliseconds`.
- **POSIX host:** `processStartedAt(pid)`.
- **WSL `D`:** runs `%SystemRoot%\System32\wsl.exe -d <D> --exec sh -c '<script>'`.
  The script prints `now_ms` and `start_ms` (from `/proc/<pid>/stat` field 22,
  `btime` and `CLK_TCK`), both on the WSL clock. The result is
  `Date.now() − (now_ms − start_ms)`. This is the process AGE carried onto the
  server clock, so it is **immune to WSL ↔ Windows clock skew**.
- Input validation (W6): `pid` must be a positive integer, checked before any
  interpolation. `D` must match `^[A-Za-z0-9._-]{1,64}$` and must not start with
  `-`. `maxStartMs` and `minAgeMs` must be finite and ≥ 0. A failed check gives
  `null` (probe), `error` (verify-and-kill) or `unknown` (liveness), and spawns
  nothing. A non-win32 platform for a Windows or WSL target, or a missing or
  relative `SystemRoot`, gives the same results.
- **W5 limiter.** At most **2** PowerShell / `wsl.exe` invocations in flight per
  server. The limiter covers probes, `verifyAndKill*` and `wslLiveness`, FIFO and
  unbounded. `timeoutMs` starts when a slot is acquired, so queue wait never
  consumes it and a kill cannot time out behind wedged probes. One limiter in the
  platform module is shared by the terminator, force-kill and
  `guard-restored-headless-identity`'s registry verifier. POSIX host probes are not
  limited.
- **W12 exec timeout.** The wrapper timeout of a verify-and-kill call is
  `timeoutMs + 10 s`, so the in-script SIGTERM → SIGKILL ladder can finish. A
  wrapper timeout yields `error`.

### D4 — Verify-and-kill in ONE invocation (closes the probe → signal TOCTOU)

Windows reuses pids immediately, so a separate probe followed by a kill is unsafe.
- **win32 host:** one PowerShell call gets the `Process` object and pins its
  handle (`$null = $p.Handle`). An open handle keeps the pid from being reused.
  It checks that `StartTime ≤ maxStartMs`, then runs `taskkill /F /T /PID <pid>`
  while the handle is still open. It prints `killed | mismatch | absent`; any
  other outcome is `error`.
- **WSL `D`:** one `sh -c` call checks the age, then signals.
  - **W4 age check.** `verifyAndKillWsl` takes `minAgeMs`, not an absolute time.
    The server computes it from `pidRecordedAt`:
    `max(0, Date.now() − (pidRecordedAt + tol))`. The script compares it with the
    process age on the WSL clock, so the check is immune to clock skew. The
    whole-second `btime` quantisation overstates the age by under 1 s, which the
    2 s tolerance absorbs; it cannot produce a false `mismatch`.
  - **W8 group leader.** The pgid is read from `/proc/<pid>/stat` (field 5, parsed
    after the last `)`), with no `ps` dependency. If it equals `<pid>`, the script
    uses `kill -TERM -- -<pid>`, otherwise `kill -TERM <pid>`. An unreadable stat
    file is `error`, never a guessed group signal. This mirrors #912's
    group-aware `killProcess` (Q5, decided).
  - It polls `kill -0` up to `timeoutMs`, then sends `SIGKILL` the same way. It
    prints `killed | mismatch | absent` (W7, W10), with `LC_ALL=C`.
- **WSL liveness** is tri-state: `alive | absent | unknown`. Only the script's
  explicit `absent` marker (from a `kill -0` under `LC_ALL=C`) is `absent`. Any
  `wsl.exe` failure, timeout or other output is `unknown`, which reads as alive.
  A wedged WSL service can therefore never yield `confirmed-dead`.

On Windows the pinned handle closes the reuse window. Whether `.StartTime` alone
opens a handle is unverified, so the handle is pinned explicitly, and this is
verified on the CI leg (W11): the gating pinned arm must see 0 reuse of the target
pid across 500 spawns made after the target died while the handle is held. An
unpinned control arm is logged and does not gate, because a deterministic negative
proves safety and a probabilistic positive would be flaky. Inside WSL the residual is the gap between the
in-script check and `kill`, a few ms within one shell. It is stated in the spec,
not claimed as covered.

### D5 — Platform module and single-source rule

The new helpers live in `packages/shared/src/platform/process.ts`:
`probeProcessStart`, `verifyAndKillWindows`, `wslLiveness`, `verifyAndKillWsl`.
They are added to `command-executor` *Single-source process-termination module*'s
helper list. A repo test asserts that no file outside `platform/` spawns
`powershell.exe` or `wsl.exe` to probe or signal a process.

**W9 enforcement rule.** The test flags a file that names `powershell.exe` or
`wsl.exe` together with a process probe or signal token: `Get-Process`,
`StartTime`, `taskkill`, `Stop-Process`, or `kill` run via `wsl.exe`. Three
existing files are allowlisted by exact path:
- `packages/extension/src/process-scanner.ts` (process enumeration);
- `packages/browser-plugin/src/server/dedicated/process-identity.ts`;
- the tmux spawn in `packages/server/src/spawn-process/process-manager.ts`.

An allowlist entry that no longer exists fails the test. `__tests__/` and
`packages/shared/src/platform/` are excluded.

### D6 — Interplay with `guard-restored-headless-identity` (#914)

- Headless registry entries are always `host`. #914's injectable probe becomes
  `(pid) => probeProcessStart(pid, { kind: "host" })` (W13), with no further
  adapter.
- #914's `killAll` verification and `piLinkedAt` handling go through the D3
  limiter, so Windows never fans out more than 2 probes.
- This change's force-kill-handler delta no longer says "headless … as before".
  It defers to `headless-spawn`.

### D7 — Probe failure (Q7, decided)

A transient probe or helper failure (cold PowerShell, antivirus, a wedged WSL)
maps to `unconfirmed`. The existing `reclaim-give-up.ts` tracker retries
`unconfirmed` for up to 3 sweeps, so the failure gets a bounded retry and the
pi is not left resident until the operator acts. No change to the *An unattended
kill SHALL verify process identity before signalling* requirement is needed, so
this change does not stack on #914's identity requirement.

A start-time `mismatch` maps to `refused-identity`, which the tracker gives up on
at once. `unknown` on a Windows server keeps today's signal on operator paths
(Q8, as already reflected in the resolved-target requirement).

## Risks

- Windows PowerShell blocked by policy, or `wsl.exe` hangs: `null` / `unknown` /
  `error`, so the session is `unconfirmed` (bounded retry, then given up) and
  logged. Nothing is signalled.
- Container and tunnel residuals are documented in `scope-pids-to-namespace` §Risks.
- A cold PowerShell start adds ~2.8 s to the first unattended reclaim. Reaper
  sweeps are background work.
