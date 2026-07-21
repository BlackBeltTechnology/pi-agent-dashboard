## ADDED Requirements

### Requirement: project-init optionally provisions and verifies the scaffold over the bus

The `project-init` skill SHALL offer an optional, opt-in provision-and-verify step after it has written the scaffold and validated the `worktreeInit` hook (directory now in the configured-but-unprovisioned state). When the user opts in AND
the local dashboard bus is reachable over loopback, the step SHALL trigger the
directory's `worktreeInit` hook and await the provisioning session reaching
`idle`, then report the outcome — replacing the "click Initialize again"
instruction with a verified result. The step SHALL NOT route kb indexing or
`openspec init` over the bus; those run inside the triggered `worktreeInit` hook,
unchanged. The step SHALL default to **not** running (opt-in), SHALL be gated to
profiles that declare a build hook (e.g. `coding`), and SHALL never block or undo
the already-written scaffold.

#### Scenario: Opt-in with a reachable bus provisions and verifies

- **WHEN** project-init has written the scaffold + a valid `worktreeInit` hook, the user opts into provision-and-verify, and `connect()` to the loopback bus succeeds
- **THEN** the skill SHALL trigger the directory's `worktreeInit` hook
- **AND** SHALL await the provisioning session reaching `idle`
- **AND** SHALL report a `configured + provisioned` result instead of the "click Initialize again" message

#### Scenario: Bus unreachable degrades to the manual-click message

- **WHEN** the provision-and-verify helper calls `connect()` and it throws a typed `off-box` or `connect-failed` error (bare `pi` terminal, no server, or off-box caller)
- **THEN** the step SHALL be skipped without error
- **AND** the skill SHALL fall back to the existing Step 7 "click Initialize again" message
- **AND** the written scaffold SHALL be unaffected

#### Scenario: Opt-out leaves behavior unchanged

- **WHEN** the user declines the provision-and-verify prompt (the default)
- **THEN** the skill SHALL NOT connect to the bus or trigger any hook
- **AND** SHALL emit the existing Step 7 message verbatim

#### Scenario: Indexing and openspec-init are not bus-routed

- **WHEN** the provision-and-verify step runs
- **THEN** it SHALL NOT call `plugin("kb", …)`, `plugin_config_write`, or any verb to perform kb indexing or `openspec init`
- **AND** any indexing or openspec wiring SHALL occur only as a side effect of the triggered `worktreeInit` hook

#### Scenario: Already-provisioned directory is a no-op

- **WHEN** provision-and-verify runs against a directory whose init-status reports it is already provisioned
- **THEN** the step SHALL NOT re-trigger the hook
- **AND** SHALL report an `already provisioned` result

#### Scenario: Provisioning timeout is reported, not failed

- **WHEN** the awaited provisioning session does not reach `idle` before the provisioning timeout
- **THEN** the step SHALL report that provisioning is still running
- **AND** SHALL exit without a hard failure, leaving the configured scaffold intact
