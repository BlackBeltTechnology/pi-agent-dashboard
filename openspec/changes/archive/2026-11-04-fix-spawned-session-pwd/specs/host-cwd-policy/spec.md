## MODIFIED Requirements

### Requirement: The spawn funnel applies cwd policy to ANY spawn

`spawnPiSession(cwd, options)` SHALL resolve the cwd policy for its `cwd` and merge it into `options` (via `mergeCwdPolicy`) BEFORE building argv or env, for EVERY spawn regardless of origin — including generic (non-plugin) spawns routed through `session-api` and plugin spawns routed through the `spawnSession` hook. When `resolveCwdPolicy(cwd)` returns no policy, the produced argv and env SHALL be byte-identical to the output produced before this capability existed, apart from the cwd-derived `PWD` the headless-spawn capability sets.

#### Scenario: Policy applied to a generic (non-plugin) spawn
- **WHEN** `registerCwdPolicy("/w/secrets", { noTools: true })` is registered and a generic user-initiated spawn lands in `/w/secrets` with no caller `scope`
- **THEN** the spawned pi argv SHALL contain `--no-tools`
- **AND** the session SHALL have been constrained without any plugin originating the spawn

#### Scenario: No matching policy is byte-identical
- **WHEN** a spawn lands in a cwd with no registered policy
- **THEN** the produced argv and env SHALL be byte-identical to the pre-change `spawnPiSession` output for that mechanism, apart from the cwd-derived `PWD` (headless-spawn capability)

#### Scenario: Policy tools allowlist reaches argv
- **WHEN** a policy `{ tools: ["read","grep"] }` is registered for the spawn cwd and the caller supplies no `scope`
- **THEN** the argv SHALL contain `--tools` followed by `read,grep`
