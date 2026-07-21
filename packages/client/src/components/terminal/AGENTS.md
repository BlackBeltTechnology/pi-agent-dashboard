# DOX — packages/client/src/components/terminal

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `InlineTerminalCard.tsx` | Inline interactive terminal card. Live → bounded `TerminalView` reattach via `terminalId`. Frozen → read-only xterm replays transcript. Independent from LLM. See change: add-inline-terminal-card. |
| `ProcessList.tsx` | Repurposed as BackgroundProcessesDrawer (filename kept). Renders bridge PGID scan as collapsible drawer under… → see `ProcessList.tsx.AGENTS.md` |
| `TerminalCard.tsx` | Sidebar terminal card. Cyan border, console icon, name (`InlineRenameInput` rename), relative age,… → see `TerminalCard.tsx.AGENTS.md` |
| `TerminalView.tsx` | xterm.js terminal emulator wrapper with keep-alive. Adds `heightPx?` bounded fixed-height variant for inline… → see `TerminalView.tsx.AGENTS.md` |
