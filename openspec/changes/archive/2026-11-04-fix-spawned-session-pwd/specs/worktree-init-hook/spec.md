## MODIFIED Requirements

### Requirement: Agent-flavor hook runs detached

When `run.type === "agent"`, the server SHALL spawn a DETACHED headless pi process in the checkout cwd, configured with `run.prompt`, `run.model`, and optional `run.settings`. The process SHALL NOT be registered as a dashboard session (no transcript in the session list, no abort control). Combined stdout/stderr SHALL be written to `<cwd>/.pi/worktree-init.log`. Completion SHALL be determined by re-evaluating the gate after the process exits; if the gate still reports `needsInit: true`, the run SHALL be treated as failed and the server SHALL surface the log tail. Unless the caller supplies an explicit environment, the agent process's environment SHALL carry `PWD` equal to the canonical physical path of the checkout cwd (same rule as the spawned-session `PWD` in the headless-spawn capability), replacing any inherited `PWD`; every other variable of the default hook environment SHALL be unchanged. The gate and script-flavor hook environments are not affected by this rule.

#### Scenario: Agent run spawns detached, not a session

- **WHEN** an `agent` hook runs
- **THEN** the server SHALL spawn a detached headless pi with the configured prompt + model
- **AND** SHALL NOT create a dashboard session entry for it

#### Scenario: Agent run completion detected via gate

- **WHEN** the detached agent process exits and the gate then reports `needsInit: false`
- **THEN** the run SHALL be reported done

#### Scenario: Agent run failure surfaced from log

- **WHEN** the detached agent process exits and the gate still reports `needsInit: true`
- **THEN** the run SHALL be reported failed
- **AND** the server SHALL include the tail of `<cwd>/.pi/worktree-init.log`

#### Scenario: Agent pi PWD names the checkout cwd

- **WHEN** the server environment has `PWD=/launch/dir` and an `agent` hook runs for checkout `/work/wt-1` with no caller-supplied environment
- **THEN** the spawned pi process environment SHALL have `PWD=/work/wt-1`

#### Scenario: Caller-supplied environment keeps its PWD

- **WHEN** a caller passes an explicit environment to the hook runner
- **THEN** the agent process SHALL receive that environment unchanged, including its `PWD` (or its absence)
