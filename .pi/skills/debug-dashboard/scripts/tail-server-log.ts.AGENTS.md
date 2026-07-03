# debug-dashboard/scripts/tail-server-log.ts — index

Tail `~/.pi/dashboard/server.log`. Default: last 50 lines of current run (since last `=== [ts] ===` banner). Modes: `--follow` (watch appends, `watchFile` 500ms), `--all <N>` (whole log), `--errors` (lines matching `/error|fail|warn|throw|crash|fatal/i`). Node built-ins only. Exits 1 if log missing, 2 on bad usage.
