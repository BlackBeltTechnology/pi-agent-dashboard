# Triage of anchor-recovered results (task 3.18, test-plan M2, `security-hardening`)

Local run 2026-11-03, worktree without `node_modules`. 17 results / 15 baseline keys. Each gate read in code at HEAD.

| File:line (keys) | Verdict | Gate verified |
|---|---|---|
| `team-plugin/src/server/paths.ts:150-153` (4 keys, 5 results) — `realFs` writeFile/rename/rm/mkdir | false-positive | every caller passes a path built by `TeamPaths.under`/`confine` (`paths.ts:93`, `canonicalize` + `isInside` under TEAM_HOME); `atomicWriteJson` callers: records `file()` (`records.ts:60`), personas `fileFor` (`store.ts:34`, confine), fixed `projectsFile()` / `usersFile()` (`under`), fixed `skills.json` under home |
| `team-plugin/src/server/records.ts:65,79` (2 keys) — read/rm of a record | false-positive | `CONVERSATION_ID_RE` (`records.ts:59`) then `TeamPaths.confine` (`records.ts:60`) |
| `team-plugin/src/server/records.ts:99,109` (2 keys) — `readdirSync` in `list` | false-positive | `base` confined (`records.ts:90`); persona dirs come from `readdirSync(base)`, filtered by `personaKeyFromDir` |
| `automation-plugin/src/server/run-store.ts:92,102` (2 keys) | false-positive | `isSafeRunId` (`run-store.ts:85`, no separator, no `..`) inside `resolveRunDir`; `scopeBase` from a cwd admitted by `withCwd` → `admitRouteCwdParam` (`routes.ts:169`) |
| `automation-plugin/src/server/automation-writer.ts:48,55,67,72,73` (5 keys, 6 results) | accepted-risk, #1104 | NOT a false positive: WS `plugin_action` `create` (`index.ts:~190`) passes an unadmitted `payload.cwd` as `scopeBase` (finding F1). REST path admits. GitHub alerts stay open until #1104 lands |
| `goal-plugin/src/server/routes.ts:345` | fixed | constant `%s` format string; tests `goal-routes.test.ts` #E27–#E29 |
