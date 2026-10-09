# DOX — packages/subagents-plugin/src/bridge

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Subagents plugin bridge entry. Exports `SUBAGENTS_FORWARD_DECLARATION` (`subagents:entry`→`subagent_entry`, `subagents:delta`→`subagent_delta`, both `stream` keyed by `agentId`) and `activate`; declares on activate and on every `dashboard:bridge-ready`. See change: add-plugin-bridge-contributions. |
