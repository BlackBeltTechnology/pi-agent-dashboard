# DOX — packages/team-plugin/src/extension

Companion pi extension loaded into every team session (`-e`). One row per file. See change: add-team-plugin, add-team-skill-access.

| File | Purpose |
|------|---------|
| `guard.ts` | Deny-first `decideToolCall`: name gate (preset `chat`/`files`/`full`), path gate (canonicalised, symlinks resolved, mirrors pi's `@`/`~`/unicode-space normalisation), fail-closed on missing policy; refuses any `scheme:` path and write/edit under `.git`/`.pi`/`.claude`; read-only tools (`read`/`grep`/`find`/`ls`) may reach inside effective skill roots, write/edit stay root-confined. `policyFromEnv` reads `PI_EXT_TEAM_TOOLS` + `PI_EXT_TEAM_ROOT` + `PI_EXT_TEAM_SKILLS` (JSON `[{name, root}]`; missing/unparseable → `null` ⇒ no readiness). `grantedSkillFilter` (D10 `(name, canonical filePath)` match, ≤1 per slot), `isRefusedInput` (`parseSkillCommand`/`parseSkillBlock` refusal predicate). See change: add-team-plugin, add-team-skill-access. |
| `index.ts` | Extension entry: `tool_call` handler + `before_agent_start` in-place skills filter (splice, never returns `systemPrompt`) + `input` refusal (`{action:"handled"}`, never `ctx.ui.notify`) + `session_start` → `dashboard:plugin-message` `team_guard_ready` (only with a valid policy; payload `{runId}` from `PI_EXT_TEAM_RUN_ID`; repeated at 1/3/8 s). See change: add-team-plugin, add-team-skill-access. |
