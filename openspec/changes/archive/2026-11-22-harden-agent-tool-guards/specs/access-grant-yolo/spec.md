## ADDED Requirements

### Requirement: YOLO never auto-allows a credential or browser-profile directory

An agent path-gate call whose resolved real path equals, or lies inside, a directory of the requirement "Credential and browser-profile directories are sensitive grant subjects" of `path-anchor-grants` SHALL NOT be auto-allowed by any YOLO session, scoped or unscoped, and SHALL receive the ordinary prompt, not a block. A symlink inside a YOLO root that resolves into one SHALL NOT be admitted.

#### Scenario: Unscoped YOLO still prompts for cloud credentials
- **GIVEN** YOLO is active and unscoped
- **WHEN** the agent reads `~/.aws/credentials`
- **THEN** no automatic allow SHALL be issued and the sensitive prompt SHALL be shown

#### Scenario: A symlink inside a YOLO root does not reach a credential directory
- **GIVEN** YOLO is active with root `/w/repo` and `/w/repo/aws` is a symlink to `~/.aws`
- **WHEN** the agent reads `/w/repo/aws/credentials`
- **THEN** no automatic allow SHALL be issued

#### Scenario: Non-credential files stay auto-allowed
- **GIVEN** YOLO is active and unscoped
- **WHEN** the agent reads `/w/other/readme.md`, outside its roots and not sensitive
- **THEN** it SHALL be auto-allowed
