# bridge.ts — index

Main bridge extension entry (default export). Connects to dashboard server, forwards pi events via… → see… → see `bridge.ts.AGENTS.md` `onReconnect` computes `liveTailOpen` once, passes it to `sendStateSync({liveTailOpen})` and the replay. See change: fix-large-session-resume-replay.
