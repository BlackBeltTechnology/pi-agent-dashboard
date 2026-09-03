# tmux-session-shutdown.spec.ts — index

L3 gate for the tmux shutdown leak (test-plan #T2): spawn under the harness default `PI_SPAWN_STRATEGY=tmux`, `shutdown`, then assert the CONTAINER's process table (`/proc` + `tmux list-panes` via `docker exec`) — a vanished session RECORD is exactly what the bug already did. Session pid from `/api/sessions`; container by published `DASHBOARD_PORT`, never by name. See change: fix-tmux-session-shutdown-leak.
