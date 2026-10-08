## ADDED Requirements

### Requirement: One-time welcome pin
On load, when the preference `welcomeSeeded` is not `true`, the server SHALL append `~/.pi/dashboard/welcome` to `pinnedDirectories` (if the directory exists and is not already pinned) and SHALL persist `welcomeSeeded: true`. The flag SHALL be independent of `pinSeeded` and SHALL never be reset by the server, so a user's unpin is permanent. The welcome directory SHALL NOT be offered Initialize or OpenSpec initialization.

#### Scenario: Existing install gets the pin once
- **GIVEN** an install with `pinSeeded: true`, user pins present, and no `welcomeSeeded`
- **WHEN** the server boots with the welcome directory present
- **THEN** the welcome directory SHALL be appended to `pinnedDirectories` and `welcomeSeeded` SHALL become `true`

#### Scenario: Unpin is permanent
- **GIVEN** `welcomeSeeded: true` and the user unpinned the welcome directory
- **WHEN** the server restarts or upgrades
- **THEN** the welcome directory SHALL NOT be pinned again

#### Scenario: No Initialize offer
- **WHEN** the welcome directory's card renders
- **THEN** no Initialize or OpenSpec-init offer SHALL be shown for it
