# process-scan-scheduler.ts — index

Pure adaptive scan scheduler (injected clock/timers). Fast 5 s (win 10 s) while the agent runs or a tool executes, +15 s after, +30 s after a list change; idle 30 s (win 60 s); idle→fast re-arms the pending timer; one extra scan 1 s after a case-insensitive `bash` tool end; a due timer during an in-flight scan is skipped; `dispose()` clears all timers and ignores late settles. Exports `createProcessScanScheduler`, `ProcessScanScheduler`.
See change: optimize-polling-hot-paths.
