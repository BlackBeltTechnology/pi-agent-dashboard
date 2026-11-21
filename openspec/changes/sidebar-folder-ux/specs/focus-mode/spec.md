## MODIFIED Requirements

### Requirement: Built-in default focus profile

When no focus profile is stored, Focus mode SHALL apply a built-in minimalist profile that hides every optional session-card block (`openspec`, `openspec-badge`, `git`, `tags`, `spawn`, `kb`, `status`, `flows`, `memory`, and every per-plugin badge and action-bar entry), every directory-card block (`folder-git`, `folder-banner`, `folder-openspec`, `folder-create`, `folder-ended`, every per-plugin pill), both visual effects, and sets `folderListMode = accordion`. The PROCESS subcard SHALL remain governed by normal resolution. A `Reset to default` action SHALL delete the stored profile.

#### Scenario: Minimal sidebar out of the box
- **GIVEN** no stored focus profile
- **WHEN** the user turns Focus mode on
- **THEN** directory cards SHALL show only their header and session cards
- **AND** session cards SHALL show no subcards other than PROCESS when it has content
- **AND** card status gradients and the selected glow ring SHALL NOT animate

#### Scenario: Safety cues survive
- **GIVEN** Focus mode on with the built-in profile
- **WHEN** a folder requires re-trust and a session with `process` hidden has a background process
- **THEN** the PROCESS safety chip SHALL render
- **AND** the folder banner compact chip SHALL NOT render (Focus is an explicit opt-in to a minimal sidebar; see `session-card-section-visibility`)
