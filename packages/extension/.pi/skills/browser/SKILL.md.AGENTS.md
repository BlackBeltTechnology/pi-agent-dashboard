# browser/SKILL.md — index

Router for the bundled `browser` skill. Step 0a preflight (`command -v agent-browser`, never auto-install); Step 0b probes CDP_LIVE/PD_RUNNING/RELAY and routes to one of the recipes: `references/web.md`, `references/electron.md`, `references/dashboard-relay.md` (preferred login state; `Bash(curl:*)` grant), `references/own-browser.md` (legacy Panerelay). Login-state override picks the relay first, then the legacy bridge. Notes record the shared-daemon trap (MCP tool + CLI = one browser) and the MCP `eval` wrapper bug.
