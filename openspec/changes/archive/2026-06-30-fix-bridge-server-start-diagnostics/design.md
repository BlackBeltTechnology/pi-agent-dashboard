## Context

GitHub issue #99. The bridge auto-spawn path in `server-launch` is internally inconsistent: it spawns with `stdio: "ignore"` and a 2 s readiness window, then — on failure — instructs the user to read a `server.log` that this path never writes. Two callers of the same shared primitive (`launchDashboardServer`) already use `stdio: { logFile }` with longer windows (CLI 30 s, Electron 15 s). The bridge is the outlier on both axes.

## Goals

- A failed bridge auto-spawn leaves an inspectable `~/.pi/dashboard/server.log`.
- A slow-but-successful cold start does not produce a spurious "failed to start" warning.
- Failure copy never points at a file that does not exist.

## Non-Goals

- The intermittent remote "Server offline" / WebSocket drop (tracked separately under `distinguish-offline-from-network-denied` and a future runtime-repro item).
- Changing CLI or Electron timeouts/log paths.

## Decisions

### Timeout value (RESOLVED — task 1.1: 10 s)
Candidates: 8 s, 10 s, 15 s. **Decision: 10 s.** The observed slow host (Fedora Silverblue/bootc, fresh jiti TS compile, hundreds of skills) reached `writePid()` and came up "a few seconds" after the 2 s mark; 10 s gives a comfortable margin without making a genuine crash feel hung (and `EarlyExitError` still beats the timeout the instant the child exits, so a real crash surfaces fast regardless). 8 s rejected as too close to the observed slow-boot tail; 15 s rejected as making the "hung, never exits" case feel unresponsive. CLI uses 30 s and Electron 15 s, so 10 s stays the tightest of the log-owning paths while clearing the slowest supported host class.

### Log path source
Use the shared `getServerLogPath()` from `packages/shared/src/dashboard-paths.ts` (already the CLI convention) rather than re-joining `os.homedir()` inline. Single source of truth; the warning and the actual fd target stay in lockstep by construction.

### Append vs ignore
Switching the bridge from `stdio: "ignore"` to `{ logFile }` means the server log now captures auto-spawn output too. Append-mode + header line is the existing policy; the file is shared with the CLI path, which is fine (one server log, one server). **Decision (task 1.2): append-only is acceptable, no rotation.** The server is long-running and the log is low-volume (a header line per spawn plus any pre-health stdout/stderr); a single long-lived server appends a handful of lines per boot. No unbounded-growth concern at this volume; rotation is out of scope.

## Risks

- **Slightly slower failure signal.** A genuinely broken spawn now takes up to 10 s (vs 2 s) to surface as a timeout — mitigated because `EarlyExitError` short-circuits on actual child exit, so only the "spawned, hung, never exits, never health-OK" case waits the full window.
- **Log fd lifecycle.** `{ logFile }` opens an fd in the parent and closes it after spawn; this path is already exercised by CLI/Electron, so no new fd-leak surface.
