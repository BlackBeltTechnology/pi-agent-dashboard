# pi-retry-settings.ts — index

READ-ONLY reader for pi's own retry policy. Exports `readPiRetrySettings({home?,cwd?,readFile?,fileExists?})`, `PiRetrySettings`, `PI_RETRY_DEFAULTS` (`maxRetries:3`, `baseDelayMs:2000`). Merges global `~/.pi/agent/settings.json` then project `<cwd>/.pi/settings.json` (project wins). Present-but-unparseable file → `baseDelayMs:0` → surface renders elapsed-only instead of a fabricated countdown. Never throws, never writes. Feeds `RetryTracker`'s `delayMs`/`maxAttempts` display math. See change: retry-forever-with-stop-control.
