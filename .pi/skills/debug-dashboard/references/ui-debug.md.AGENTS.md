# debug-dashboard/references/ui-debug.md — index

Pointer to `browser` skill for UI and Electron debugging. Visual, layout, responsive, screenshot, and console issues route to `browser`; server, bridge, API, auth, and restart failures stay in debug-dashboard. Handoff requires the First moves `/api/health` check, then `/skill:browser`.
