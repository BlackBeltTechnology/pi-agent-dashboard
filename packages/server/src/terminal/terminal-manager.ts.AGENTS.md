# terminal-manager.ts — index

Server-side PTY terminal manager. Exports `RingBuffer`, `detectShell`, `TerminalManager` interface, `createTerminalManager(options)` — spawn node-pty with git-source augmented env, ring-buffer output replay, attach/detach WS clients, resize guards, `kill` (windows taskkill tree-kill, POSIX SIGHUP→SIGKILL), `getTranscript`.
