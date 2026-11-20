## MODIFIED Requirements

### Requirement: Folder banner safety chip

When `folder-banner` resolves hidden and the folder is in a state that would show the setup / initialize / re-trust / failure banner, the directory card SHALL render a compact warning chip naming the state, EXCEPT while Focus mode is on, when the compact chip SHALL NOT render for any state. Outside Focus mode, activating a chip SHALL reveal the full banner for that folder until the folder leaves that state.

#### Scenario: Hidden banner, folder blocked
- **GIVEN** `folder-banner` hidden, Focus mode off, and folder `/a` requires re-trust
- **WHEN** `/a` renders
- **THEN** a compact warning chip SHALL render instead of the banner
- **AND** activating the chip SHALL show the full banner

#### Scenario: Hidden banner, folder healthy
- **GIVEN** `folder-banner` hidden and folder `/a` needs no action
- **WHEN** `/a` renders
- **THEN** neither banner nor chip SHALL render

#### Scenario: Focus mode hides every chip rung
- **GIVEN** Focus mode is on and folder `/a` is in the `init-needed`, `setup`, `retrust`, `failed` or `running` state
- **WHEN** `/a` renders, collapsed, compact or expanded with `folder-banner` hidden
- **THEN** no compact chip SHALL render for `/a`

#### Scenario: Outside Focus the chip is unchanged
- **GIVEN** Focus mode is off, `folder-banner` hidden, and folder `/a` has a trusted init hook that has not run
- **WHEN** `/a` renders
- **THEN** the compact chip naming the state SHALL render exactly as before
