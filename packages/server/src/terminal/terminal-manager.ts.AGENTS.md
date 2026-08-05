# terminal-manager.ts — index

Server-side PTY terminal manager.

Exports `RingBuffer`, `detectShell`, `TerminalManager`, `createTerminalManager(options)` — spawns node-pty with a git-source augmented env, replays ring-buffered output, attaches/detaches WS clients, guards resize, and `kill`s (Windows taskkill tree-kill; POSIX SIGHUP→SIGKILL). Also `getTranscript`, `getTerminalRecord(id)` (capped `{transcript,sawInput}` — live entry, else tombstone, else undefined), `releaseTranscript(id)`/`isReleased(id)`.

Transcript capping: `capTranscript(s, capBytes)` (byte-measured tail cap; the `…[N chars hidden]…` marker counts inside the budget) + `deriveTranscriptCapBytes(maxEventDataSize, maxStringFieldSize?)` (75% of the ceiling; an unset string cap defaults to `DEFAULT_MAX_STRING_SIZE`, explicit `0` disables the string pass; fail-loud boot asserts) + `DEFAULT_TRANSCRIPT_CAP_BYTES` (192 KiB, coupled to the 256 KiB event ceiling — D9).

Retention contract: a dead EPHEMERAL inline PTY leaves a bounded transcript tombstone (`TOMBSTONE_CAP=64`) so a closed card can still show its output; `releaseTranscript` suppresses that stickily (`RELEASED_TTL_MS=60_000`) so a late exit cannot re-tombstone a card the user already closed. `sawInput` records whether the user ever typed into the PTY (resize/title frames do not count).

See change: preserve-inline-terminal-transcript, fit-attachments-for-display.
