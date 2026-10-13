# server-pid.ts — index

PID file management at `~/.pi/dashboard/server.pid`. Exports `writePid`, `readPid`, `removePid`, `isServerRunning(port)`, re-exports `isProcessAlive`. `isServerRunning` validates liveness + dashboard health, cleans stale PID files.

`isServerRunning` probes with `{timeoutMs:2000, retries:2}` (injectable via `ServerPidOptions.probe`) and removes the pid file ONLY when the process is dead; a live-but-silent process keeps its file. No longer called by `cmdStart` (the port classifier replaces it). See change: harden-dashboard-start-detection.
