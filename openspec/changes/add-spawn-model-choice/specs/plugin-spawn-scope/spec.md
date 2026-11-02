## ADDED Requirements

### Requirement: Plugin spawn model choice is validated and role-resolved

`PluginSpawnOptions` SHALL accept an optional `thinkingLevel` and an `@role` reference in `model`. The hook SHALL resolve an `@role` before mapping, so `pluginSpawnToSessionOptions` stays pure and total. An unresolvable role or a non-canonical `thinkingLevel` SHALL be dropped with a `warning`. A literal `model` SHALL keep today's `isSafeArgvString` pass-through, so trusted callers passing bare ids are unaffected. `agent` combined with `thinkingLevel` SHALL be rejected, as `agent` with `model` is.

#### Scenario: Plugin spawn with role and level
- **GIVEN** role `review` is assigned `zai/glm-5.3`
- **WHEN** a trusted plugin calls `spawnSession({cwd:"/p", model:"@review", thinkingLevel:"low"})`
- **THEN** pi SHALL be spawned with `--model zai/glm-5.3 --thinking low`

#### Scenario: Literal plugin model passes through unchanged
- **WHEN** a trusted plugin calls `spawnSession({cwd:"/p", model:"sonnet"})`
- **THEN** pi SHALL be spawned with `--model sonnet`, as before

#### Scenario: Unresolvable plugin role is dropped with a warning
- **GIVEN** no role `ghost` is configured
- **WHEN** a trusted plugin calls `spawnSession({cwd:"/p", model:"@ghost"})`
- **THEN** pi SHALL be spawned without `--model` and the result SHALL carry a `warning`

#### Scenario: ACP agent with a thinking level rejected
- **WHEN** a trusted plugin calls `spawnSession({cwd:"/p", agent:"qmt", thinkingLevel:"low"})`
- **THEN** the result SHALL be `success: false` and no process SHALL be spawned

#### Scenario: Plugin spawn without a model is unchanged
- **WHEN** a first-party plugin (automation, goal, team, chat-gateway) calls `spawnSession({cwd:"/p"})` with no `model` or `thinkingLevel`
- **THEN** pi SHALL be spawned without `--model` or `--thinking`, as before
