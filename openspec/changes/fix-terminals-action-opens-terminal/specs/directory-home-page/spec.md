## ADDED Requirements

### Requirement: Terminals and Editor quick actions have distinct targets

The directory home page's **Terminals** quick action SHALL navigate to the folder editor route with the terminal-focused entry (`/folder/<encodedCwd>/editor?focus=terminal`), so the user lands on an active terminal tab — an existing one, or a newly created one when none exists. The **Editor** quick action SHALL navigate to `/folder/<encodedCwd>/editor` without the parameter and SHALL NOT create a terminal.

#### Scenario: Terminals action lands on a terminal

- **GIVEN** the directory home page for `/home/u/proj` with no terminals
- **WHEN** the user activates the Terminals quick action
- **THEN** the folder pane SHALL open with one newly created `term:` tab active

#### Scenario: Editor action lands on the file editor

- **WHEN** the user activates the Editor quick action on the same page
- **THEN** the folder pane SHALL open on the file editor
- **AND** no terminal SHALL be created
