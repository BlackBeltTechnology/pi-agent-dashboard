# browser/SKILL.md — index

Router for the bundled `browser` skill. Step 0a preflight (`pi-dashboard-ensure`, registry check, never auto-install); Step 0b probes CDP_LIVE/PD_RUNNING and routes to one of THREE recipes: `references/web.md`, `references/electron.md`, `references/own-browser.md`. Login-state override routes to own-browser. Step 1 carries the challenge hook — interactive anti-bot page → stop and follow `references/challenge.md`. Notes record the shared-daemon trap (MCP tool + CLI = one browser) and the MCP `eval` wrapper bug. See change: add-browser-challenge-pause.
