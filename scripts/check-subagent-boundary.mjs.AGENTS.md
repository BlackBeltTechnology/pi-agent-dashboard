# check-subagent-boundary.mjs — index

Tree-wide gate over `packages/{extension,server,shared,client,dashboard-plugin-runtime}/src`: D9 case-insensitive denylist (`subagent_*`, `subagents:`, `SubagentState*`, `.subagents`, ...). Exempt tests/`test-support`/`generated`/i18n. Allowlist `subagent-boundary-allowlist.json`; stale row warns. Prints `file:line`, exit 1. Run first by `npm test`; `npm run check:subagent-boundary`. See change: move-subagents-to-plugin.
