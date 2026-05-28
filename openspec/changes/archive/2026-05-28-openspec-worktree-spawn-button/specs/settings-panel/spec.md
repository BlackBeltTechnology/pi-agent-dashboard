## ADDED Requirements

### Requirement: Worktree preference toggle in settings
The settings panel SHALL expose a checkbox bound to the new config field `gitWorktreeEnabled` (boolean, default `true`). Label SHALL read `Show worktree spawn buttons in folders and OpenSpec rows`. Help text SHALL clarify that this is a UI preference only — it does not disable the underlying `/api/git/worktree*` REST endpoints.

The field SHALL persist through the existing `/api/config` partial-merge write path and SHALL coexist with all other config fields without disturbing them.

#### Scenario: Default value when field absent
- **WHEN** the dashboard config on disk has no `gitWorktreeEnabled` key
- **THEN** the settings panel SHALL render the checkbox as checked (effective value `true`)

#### Scenario: Disabling persists across restarts
- **WHEN** the user unchecks the box and clicks save
- **THEN** the next read of `/api/config` SHALL return `gitWorktreeEnabled: false`
- **THEN** subsequent UI renders SHALL hide both folder `+Worktree` and OpenSpec-row `⑂+` buttons

#### Scenario: Toggle preserves other config fields
- **WHEN** the user toggles only `gitWorktreeEnabled`
- **THEN** the partial-merge write SHALL preserve every other field in the config file unchanged
