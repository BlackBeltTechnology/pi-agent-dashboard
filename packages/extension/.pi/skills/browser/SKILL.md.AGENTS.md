# browser/SKILL.md — index

Router for the bundled `browser` skill. Step 0a preflight (`command -v agent-browser`, never auto-install); Step 0b probes CDP_LIVE/PD_RUNNING and routes to one of THREE recipes: `references/web.md`, `references/electron.md`, `references/own-browser.md`. Login-state override routes to own-browser. Notes record the shared-daemon trap (MCP tool + CLI = one browser) and the MCP `eval` wrapper bug.
