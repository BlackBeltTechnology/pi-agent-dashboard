# DOX — packages/team-plugin/src/extension

Companion pi extension loaded into every team session (`-e`). One row per file. See change: add-team-plugin.

| File | Purpose |
|------|---------|
| `guard.ts` | Deny-first `decideToolCall`: name gate (preset `chat`/`files`/`full`), path gate (canonicalised, symlinks resolved, mirrors pi's `@`/`~`/unicode-space normalisation), fail-closed on missing policy; refuses any `scheme:` path and write/edit under `.git`/`.pi`/`.claude`. `policyFromEnv` reads `PI_EXT_TEAM_TOOLS` + `PI_EXT_TEAM_ROOT`. See change: add-team-plugin. |
| `index.ts` | Extension entry: `tool_call` handler + `session_start` → `dashboard:plugin-message` `team_guard_ready` (only with a valid policy; payload `{runId}` from `PI_EXT_TEAM_RUN_ID`; repeated at 1/3/8 s). See change: add-team-plugin. |
