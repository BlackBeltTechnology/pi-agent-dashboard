# DOX — tests/e2e/team

One row per file. Specs spawn their own dedicated dashboard instance + real pi sessions
(`team-harness.ts`); they need the `pi` CLI on PATH, so CI skips them — run locally. See
change: add-team-plugin, add-team-skill-access.

| File | Purpose |
|------|---------|
| `fake-llm.ts` | Local OpenAI-compatible fake provider recording every agent-turn request (system prompt, user texts, tool names/results). Scripted replies: text, tool call, or `{text, delayMs}` holding the SSE response so a turn stays streaming (revocation window). See change: add-team-plugin, add-team-skill-access. |
| `leaky-extension.ts` | `installLeakyExtension(home, skillMd)` — writes a user-dir pi extension emitting `resources_discover` for `skillMd`; the leak vector the team guard's prompt filter must close. See change: add-team-skill-access. |
| `static-app.ts` | Static-app boot helper for standalone team-app specs. See change: add-team-plugin. |
| `team-app.spec.ts` | Standalone-mode team app E2E. See change: add-team-plugin. |
| `team-harness.ts` | `bootTeamHarness`: fake OIDC issuer + `bootDedicated` instance, `plugins.team` config, `models.json`, plugin symlink, sign-in-via-app, team API helper, session listing. See change: add-team-plugin. |
| `team-llm.spec.ts` | Model-driven team behaviour vs real pi (prompt round trip, guard blocks, host-action refusals, restart/resume). Stale `.composer textarea` selector — predates the v2 composer (see change: redesign-prompt-input); skipped in CI, red locally. See change: add-team-plugin. |
| `team-skills.spec.ts` | Skill-access L3 (test-plan #F1–#F6): provider prompt carries only granted skills; in-root read ok / sibling `path_outside_root`; granted `/skill:` envelope vs ungranted refusal; widening keeps, narrowing ends (≤5 s) a streaming session + reopen 409 + banner with readable history; invalid-path card blocks with Fix skill → Skills panel. Selector: `[data-testid="composer-input-row"] textarea`. See change: add-team-skill-access. |
| `team-standalone.spec.ts` | Standalone host-mode team E2E. See change: add-team-plugin. |
