# terminal-reload-inprocess.spec.ts — index

L3 terminal-hosted (tmux) `/reload`: two reloads without touching TUI → one `completed` pill each, same pid, no `__dashboard_reload` user bubble (#F1); concurrent reload → one completed + one `already in progress` failed pill (#F2). See change: fix-terminal-session-dashboard-reload.
