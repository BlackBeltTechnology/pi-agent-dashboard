# DOX — packages/team-app/src/api

One row per file. See change: add-team-plugin.

| File | Purpose |
|------|---------|
| `client.ts` | Typed `/api/plugins/team/*` client over `host.api.fetch`; `ApiError(status, code, fields, details)`; skills routes: `skillsAdmin`/`skillsCaller` (GET /skills), `availableSkills`, `createSkill`, `updateSkill`, `deleteSkill`, `skillImpact`. See change: add-team-plugin. See change: add-team-skill-access. `history(key,t,c)` → `{sessionId}` read-only transcript handle. See change: add-team-skill-access. |
| `types.ts` | Wire types (`Me`, `ProjectInfo`, `Persona`, `Agent` + `effectiveSkills`/`skillBlock`, `Conversation`, `MatchResult`, `SkillUsers`/`SkillTargets`, `AdminSkillRow`, `CallerSkill`, `OperatorSkill`, `ImpactPreview`). See change: add-team-plugin. See change: add-team-skill-access. |
