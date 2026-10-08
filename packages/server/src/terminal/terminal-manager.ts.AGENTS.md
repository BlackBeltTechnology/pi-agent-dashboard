# terminal-manager.ts — index

Server-side PTY terminal manager.

Exports `RingBuffer`, `detectShell`, `TerminalManager`, `createTerminalManager(options)` — spawns node-pty with a git-source augmented env, replays ring-buffered output, attaches/detaches WS clients, guards resize, and `kill`s (Windows taskkill tree-kill; POSIX SIGHUP→SIGKILL). Also `getTranscript`, `getTerminalRecord(id)` (capped `{transcript,sawInput}` — live entry, else tombstone, else undefined), `releaseTranscript(id)`/`isReleased(id)`.

Transcript capping: `capTranscript(s, capBytes)` (byte-measured tail cap; the `…[N chars hidden]…` marker counts inside the budget) + `deriveTranscriptCapBytes(maxEventDataSize, maxStringFieldSize?)` (75% of the ceiling; an unset string cap defaults to `DEFAULT_MAX_STRING_SIZE`, explicit `0` disables the string pass; fail-loud boot asserts) + `DEFAULT_TRANSCRIPT_CAP_BYTES` (192 KiB, coupled to the 256 KiB event ceiling — D9).

Retention contract: a dead EPHEMERAL inline PTY leaves a bounded transcript tombstone (`TOMBSTONE_CAP=64`) so a closed card can still show its output; `releaseTranscript` suppresses that stickily (`RELEASED_TTL_MS=60_000`) so a late exit cannot re-tombstone a card the user already closed. `sawInput` records whether the user ever typed into the PTY (resize/title frames do not count).

See change: preserve-inline-terminal-transcript, fit-attachments-for-display.

PTY env `{ ...process.env, ...hints }` passes through `normalizeEnvPathKey` before `augmentEnvWithGitSource` (bundled-source PATH write no longer duplicates win32 `Path`). See change: fix-windows-path-env-key-casing.

`spawn` runs shared `stripDashboardHeapFlag` over `{ ...process.env, ...hints }` before `normalizeEnvPathKey`: drops the dashboard's own marker-matched old-space token AND the `PI_DASHBOARD_HEAP_FLAG` marker; operator flag (incl. identical value without marker) preserved. Terminal headroom regression: inherited 8192 → runtime default. See change: guard-server-heap-and-store-coupling (D4).

- Identity plane: `spawn(cwd, {ephemeral?, owner?})` stamps `principalOwner` `{iss,sub}` (copy). Owner rule = sessions (equality; ownerless invisible to humans; operator sees all). See change: add-multi-user-identity-plane (18.13).

POSIX PTY spawns `$SHELL -l` (login shell) so `~/.zprofile`/`~/.bash_profile` run (e.g. `brew shellenv` → `/opt/homebrew/bin`); server's inherited GUI/launchd PATH lacks Homebrew. win32 args stay `[]`.
