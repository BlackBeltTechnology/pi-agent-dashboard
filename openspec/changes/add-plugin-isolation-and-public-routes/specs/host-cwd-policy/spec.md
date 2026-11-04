## MODIFIED Requirements

### Requirement: The spawn funnel applies cwd policy to ANY spawn

`spawnPiSession(cwd, options)` SHALL resolve the cwd policy for its `cwd` and merge it into `options` (via `mergeCwdPolicy`) BEFORE building argv or env, for EVERY spawn regardless of origin — including generic (non-plugin) spawns routed through `session-api` and plugin spawns routed through the `spawnSession` hook. When `resolveCwdPolicy(cwd)` returns no policy, the produced argv and env SHALL be byte-identical to the output produced before this capability existed. For an isolated plugin spawn (valid `scope.agentDir`, see `plugin-spawn-scope`) the policy SHALL still be merged, except that a policy-contributed `skills` list SHALL be discarded before merging: `--skill` paths load even under the isolated spawn's forced `--no-skills`, so they are the one policy field that would add content to an isolated session. Every tightening field (`tools`, `excludeTools`, `noTools`, `noBuiltinTools`, `noSkills`) SHALL still apply.

#### Scenario: Policy applied to a generic (non-plugin) spawn
- **WHEN** `registerCwdPolicy("/w/secrets", { noTools: true })` is registered and a generic user-initiated spawn lands in `/w/secrets` with no caller `scope`
- **THEN** the spawned pi argv SHALL contain `--no-tools`
- **AND** the session SHALL have been constrained without any plugin originating the spawn

#### Scenario: No matching policy is byte-identical
- **WHEN** a spawn lands in a cwd with no registered policy
- **THEN** the produced argv and env SHALL be byte-identical to the pre-change `spawnPiSession` output for that mechanism

#### Scenario: Policy tools allowlist reaches argv
- **WHEN** a policy `{ tools: ["read","grep"] }` is registered for the spawn cwd and the caller supplies no `scope`
- **THEN** the argv SHALL contain `--tools` followed by `read,grep`

#### Scenario: Isolated spawn keeps policy tightenings but not policy skills
- **WHEN** a policy `{ noTools: true, skills: ["/w/skill.md"] }` is registered for the spawn cwd and a plugin performs an isolated spawn there
- **THEN** the argv SHALL contain `--no-tools`
- **AND** the argv SHALL NOT contain `--skill /w/skill.md`
