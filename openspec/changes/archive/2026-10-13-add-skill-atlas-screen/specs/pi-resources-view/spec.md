## ADDED Requirements

### Requirement: Resource pages host plugin sections

The folder and global resource pages SHALL render the `resource-page-section` slot claims that match the page's resource type, above the unchanged resource grid. Rendering them SHALL NOT change the grid's content, filters, activation toggles, or test ids.

#### Scenario: Section above grid
- **WHEN** the Folder Skills page of `/repo` renders with the skill-atlas plugin enabled
- **THEN** the atlas section SHALL appear above the skill cards and every existing skill card SHALL still render

#### Scenario: No claims
- **WHEN** no enabled plugin claims `resource-page-section`
- **THEN** the page SHALL render exactly as before
