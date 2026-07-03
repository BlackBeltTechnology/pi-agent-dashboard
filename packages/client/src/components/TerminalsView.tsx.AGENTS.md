# TerminalsView.tsx — index

Tabbed terminal content area for a cwd. Filters ephemeral terminals. Tab bar with inline rename, keep-alive mounted `TerminalView` per terminal (CSS visibility toggle). Empty state + New Terminal. Props: `cwd`, `terminals`, `activeTerminalId`, `onCreateTerminal`, `onKillTerminal`, `onRenameTerminal`, `onTerminalTitle`. Exports `TerminalsView`.
