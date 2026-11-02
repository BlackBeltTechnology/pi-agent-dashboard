# Proposal

## Why

Split out of GitHub issue #913 while planning it (Windows reclaim of `wt` /
`wsl-tmux`). A `windows-latest` spike (GitHub Actions run `40245592849`) and two
doubt-review cycles showed something more basic. The server stores each session's
`pid` (`memory-session-manager.ts:479-482`) but never records **which pid
namespace** that number belongs to. Several shipped paths treat it as a local pid
on every OS:

- **Remote-origin sessions** (`originDeviceId`, paired devices), on any server OS:
  - operator force-kill signals a **local** process with the same pid number
    (`session-action-handler.ts:1334`);
  - the terminator probes and can signal it (`session-terminator.ts:128-187`);
  - the idle-reaper probe reads a local process's CPU and child count
    (`idle-reaper.ts:153-157`).

  `death-reason.ts:18-31` is the only place that already knows such a pid is foreign.
- **WSL sessions on a Windows server**, whose pi registers a Linux pid that is
  invisible to Windows (spike):
  - force-kill runs `taskkill /F /T` on a Windows process with that number;
  - the terminator's `isGone` gets ESRCH, so the reclaim is reported
    `confirmed-dead` while pi runs;
  - `classifyCarrierLoss` reports `process_gone`;
  - `linkByPid` can attach the session to a Windows headless entry with the same
    number (`event-wiring.ts:1725-1738`).
- **Container bridges** reaching a host server over loopback carry a pid from
  another namespace.

Windows reuses pids immediately (spike: 200 spawns gave 172 distinct pids), so the
WSL cases can hit live, unrelated processes.

## What Changes

- **Bridge evidence.** `session_register` gains an optional `pidNamespace`:
  `{platform, kind: "host" | "wsl", distro?, nsId?, hostId?}`.
  - `nsId` is the Linux pid-namespace link.
  - `hostId` is the Linux `boot_id`; elsewhere it is the hostname.

  One shared builder is used at every register site. The server stores the field
  atomically with `pid`, including on the provisional path.
- **One server helper, `resolvePidTarget`,** returns
  `host | {wsl, distro} | legacy-wsl | foreign | unknown` (design D2):
  - origin first: `originDeviceId` ⇒ `foreign`;
  - then platform, `hostId` and `nsId` checks. An unreadable field gives `unknown`,
    never `foreign`;
  - a legacy register on a Windows server with a POSIX-style cwd ⇒ `legacy-wsl`;
  - a legacy register that matches this session's own registry entry ⇒ `host`.
- **Every pid consumer dispatches on the target** (design D3):
  - the terminator (resolved once, before the registry rung);
  - shutdown and force-kill;
  - `classifyCarrierLoss`;
  - the idle-reaper probe;
  - registry pid / cwd linking;
  - the register watchdog's `clearByPid`;
  - process-list classification;
  - bridge-contention fast-accept.

  Only `host` is probed or signalled locally:
  - Unattended reclaim of any other target is refused before any liveness probe.
  - Operator shutdown of a non-local target is reported as an unconfirmed
    termination, with the existing orphan signal.
  - Force-kill of a non-local target is refused: no signal, the WebSocket kept
    open, `success: false`.
- **`TerminateOptions.operator`** (explicit) and a new outcome, `not-local`.
- **A deny-by-default repo test** for local pid probes and signals.
- **Spec deltas:**
  - `force-kill-handler`: Unattended reclamation; Force kill process escalation;
    Ending a session; Bridge WebSocket force-closed; Session marked ended after
    force kill; and a new *A recorded pid is used only in its resolved pid target*;
  - `shared-protocol`: `pidNamespace`;
  - `spawn-correlation`: Three-tier link;
  - `session-death-attribution`: Process-liveness classification SHALL NOT overclaim;
  - `process-list-classification`;
  - `spawn-register-watchdog`: Pi gateway clears watchdog;
  - `bridge-connection-contention`: same-process reconnect.

`add-windows-process-identity` (#913) builds on this. It adds Windows and WSL
verify-and-kill, so Windows `host` targets and WSL targets become reclaimable.

## Proposed decisions (confirm at the scenario-design gate)

- **Q8** `unknown` on a Windows server now means a legacy **native** Windows pi
  (`legacy-wsl` catches WSL). Operator shutdown and force-kill keep today's signal
  for it (design D4). Unattended paths refuse it. On POSIX servers, `unknown`
  (unreadable `/proc`) is refused on every path.

## Capabilities

### New Requirements

- `force-kill-handler`: *A recorded pid is used only in its resolved pid target*.
- `shared-protocol`: *Session registration reports the pi process's pid namespace*.

### Modified Capabilities

- `force-kill-handler`:
  - *Unattended reclamation SHALL terminate the session process for every spawn strategy*;
  - *Force kill process escalation*;
  - *Ending a session SHALL terminate its process for every spawn strategy*;
  - *Bridge WebSocket force-closed after kill*;
  - *Session marked ended after force kill*.
- `spawn-correlation`: *Three-tier link in `headlessPidRegistry`*.
- `session-death-attribution`: *Process-liveness classification SHALL NOT overclaim*.
- `process-list-classification`: *Server classifies forwarded process-list entries*.
- `spawn-register-watchdog`: *Pi gateway clears watchdog on session_register*.
- `bridge-connection-contention`: *A same-process reconnect is not a contention*.

## Impact

- `packages/shared`:
  - `protocol.ts` and `types.ts`: `pidNamespace`, and the stored namespace;
  - the `buildPidNamespace()` builder.
- Bridge:
  - `session-sync.ts:154,298`, `bridge-handlers/lifecycle.ts:585`, `bridge.ts:1695`;
  - the ACP bridge (`acp-session-adapter.ts:134`).
- Server:
  - `pi-gateway.ts` (`:808-825`, `:929,991`, carrier-loss callers `:367,400,417,476`,
    watchdog `:958-961`);
  - `pi/provisional-registration.ts`, `memory-session-manager.ts`;
  - new `session/pid-target.ts`;
  - `session-terminator.ts` (with `operator` and `not-local`);
  - `session-action-handler.ts`;
  - `death-reason.ts`, `embed-lifecycle/idle-reaper.ts`;
  - `event-wiring.ts` (linking `:1725-1738`, process list `:2793`);
  - `spawn-process/process-classifier.ts`, `bridge-contention.ts`.

  `reclaim-give-up.ts` and `caps.ts` are unchanged, because unattended refusals
  reuse `refused-identity`.
- **Behaviour changes:** these are fixes. Remote-origin, WSL-on-Windows and
  container sessions are no longer signalled as local processes. Their reclaims
  and shutdowns are reported as unconfirmed, and their force-kill is refused.
- **Compatibility:**
  - old bridge with a new server: POSIX unchanged; a Windows WSL legacy session is
    `legacy-wsl` and is never signalled; a native Windows legacy session gets
    operator signals (Q8) and is refused for unattended reclaim;
  - new bridge with an old server: the field is ignored.
- **Rollback:** revert. Nothing is persisted beyond the in-memory session record.
- No migration.
- **Ordering:** this change and `guard-restored-headless-identity` both edit the
  terminator. The order is resolve → registry rung → escalate (design D7).

## Discipline Skills

- `security-hardening`: a pid from another namespace is untrusted input to a kill
  decision. This change closes existing paths that signal unrelated local processes.
- `doubt-driven-review`: changes a destructive-path identity model across every
  consumer. Stress-test it before it stands.
- `review-code`: non-trivial changes to the terminator, shutdown, force-kill and
  linking.
