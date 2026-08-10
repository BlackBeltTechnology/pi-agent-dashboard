# source-detector.ts — index

Detects session source env. Exports `detectSessionSource(hasUI?, sessionFile?)` → `SessionSource`. TUI attached → `tui`/`tmux` (ZED_TERM/TMUX). Headless → reads `.meta.json` sidecar via `readSessionMeta` for `"dashboard"`; else `zed`/`tmux`/`tui`.
