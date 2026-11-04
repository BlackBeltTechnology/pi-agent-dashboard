## MODIFIED Requirements

### Requirement: Pi gateway clears watchdog on session_register
The pi-gateway `session_register` handler SHALL clear the watchdog for the registering spawn, trying the strongest identity first: `spawnToken`, then `pid`, then `cwd`. The `pid` tier SHALL be skipped for a register whose pid target is not local (`force-kill-handler` *A recorded pid is used only in its resolved pid target*).

A clear that has already matched on a stronger tier SHALL NOT go on to cancel an entry belonging to a **different** spawn on a weaker tier. Specifically, an unconditional `clearByCwd` after a successful token clear SHALL NOT cancel a concurrent same-cwd spawn's still-armed watchdog — doing so silently disarms that spawn, suppressing both its timeout diagnostic and its reclaim.

Clearing an unknown key SHALL remain a no-op.

#### Scenario: Token clear does not disarm a concurrent same-cwd spawn
- **WHEN** spawns A and B are armed for the same `cwd` with distinct tokens
- **AND** A registers carrying its token
- **THEN** A's watchdog SHALL be cancelled
- **AND** B's watchdog SHALL remain armed and SHALL still fire if B never registers

#### Scenario: cwd tier still clears a token-less spawn
- **WHEN** a tmux spawn armed without a token or pid registers with only its `cwd`
- **THEN** the cwd tier SHALL cancel that watchdog

#### Scenario: Clear on unknown key is a no-op
- **WHEN** a register arrives whose token, pid and cwd match no armed entry
- **THEN** the handler SHALL return without throwing and without cancelling any entry

#### Scenario: A foreign pid does not disarm a local spawn
- **WHEN** a register whose pid target is WSL or `foreign` carries a pid equal to a pending local spawn's pid
- **THEN** that spawn's watchdog SHALL remain armed

#### Scenario: A non-local register still clears by cwd
- **WHEN** a register whose pid target is WSL, with no token, carries the `cwd` of a pending spawn's armed watchdog
- **THEN** the cwd tier SHALL cancel that watchdog
