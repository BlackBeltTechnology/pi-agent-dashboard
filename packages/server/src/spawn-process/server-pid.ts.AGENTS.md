# server-pid.ts — index

PID file management at `~/.pi/dashboard/server.pid`. Exports `writePid`, `readPid`, `removePid`, `isServerRunning(port)`, re-exports `isProcessAlive`. `isServerRunning` validates liveness + dashboard health, cleans stale PID files.
