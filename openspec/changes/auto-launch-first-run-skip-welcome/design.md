# Design — auto-launch-first-run-skip-welcome

## Decisions (recorded during apply; see tasks.md for full context)

### D1 — Marker written on `done` only (task 1.7, option a)
The `~/.pi/dashboard/first-run-done` marker is written only when the startup
machine reaches the `done` end-state. The `attach` arms (remote-mode + local
already-running) `return` before the write and do NOT write the marker.
Rationale: the marker semantics are "first successful local launch completed";
attach-first machines never spawned a local server, so the marker is
appropriately absent. The spec delta (ADDED "First-run marker is written on
first successful launch") reflects this — marker on `done`, never on error or
attach end-states.

### D2 — Doctor `run-setup` removed, not repurposed (task 2A.2, option a)
`doctor:run-setup` handler + "Run setup wizard" button + `runSetup` bridge
contract entry + preload method all deleted. There is no wizard to open. The
reset-to-local need is covered by the app-menu "Use Local Dashboard" action
(D3). No dangling `openWizardWindow` import remains in `doctor-window.ts`.

### D3 — Remote-attach via app-menu dialog (task 2B.1, option a′)
`app-menu.ts` gains "Connect to Remote Dashboard…" → `openRemoteConnectWindow()`
and "Use Local Dashboard" → `useLocalDashboard()`. The window
(`remote-connect.html`) collects a URL, probes `${url}/api/health`, and on
connect writes `dashboard-settings.json` remote mode + `app.relaunch()`. IPC
bridge = `window.remoteConnect` (`preload/remote-connect-preload.ts`), handlers
in `remote-connect-window.ts`. This preserves CONTRACT #3/#6 (shell can enter
remote mode) which the deleted `wizard:persist-mode` writer would otherwise
have taken with it. Rejected: sharing the web-client `knownServers`
(`config.json`) — the shell decides attach-vs-spawn at STARTUP, before any
server connection, so the server list must be shell-local.

### D4 — Settings file renamed + recent-servers store (tasks 2B.3–2B.5)
`~/.pi-dashboard/mode.json` → `~/.pi-dashboard/dashboard-settings.json`.
`readModeFile()` migrates a legacy `mode.json` on first read (rewrite under new
name, delete legacy — best-effort). Function names `readModeFile`/`writeModeFile`
retained (call-site + mock stability). `DashboardSettings` (alias `ModeConfig`)
adds `recentRemotes: { url, lastUsed }[]` — MRU, cap 8. Helpers
`listRecentRemotes`/`addRecentRemote`/`removeRecentRemote`. Local dashboard is
an implicit list entry (not stored). Picking a saved server connects directly
(pre-trusted, no re-probe); a fresh URL is probed then added on connect.

### D5 — `add-wizard-launch-progress-log` retarget (task 6.2)
`add-wizard-launch-progress-log` currently deltas the `first-run-wizard`
capability, which this change dissolves. The splash window survives; only the
wizard goes. Recommendation: that proposal retargets its delta to the splash /
bootstrap surface (`electron-bootstrap-flow` states + `electron-shell`), not
`first-run-wizard`. Non-blocking for this change — flagged for that proposal's
owner. The `first-run-wizard` spec dir is left as an all-REMOVED stub; a
follow-on housekeeping change deletes it once no proposal references it.
