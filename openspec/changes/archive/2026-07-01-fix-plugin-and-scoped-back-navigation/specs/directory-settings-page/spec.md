## ADDED Requirements

### Requirement: Instructions file selection SHALL be URL-encoded

On the Instructions page, selecting a file in the scoped file picker SHALL be a URL navigation, not React-only component state. Selecting a candidate SHALL push `/folder/:cwd/settings/instructions?file=<encoded relPath>` (global scope: `/settings/:page?...` equivalent) via history push. The active file SHALL be derived from the `?file=` query so the URL is the single source of truth for which file is shown.

Because each selection is a discrete history entry, the browser/OS back button and the shared depth-aware back action SHALL walk file→file→page→launcher rather than ejecting to the card list on the first back invocation. Selecting a file SHALL NOT change the settings route's depth (it remains depth 1).

When `?file=` is absent, the page SHALL apply its default selection. When `?file=` names a path not present in the current candidate set (e.g. deleted or out of scope after refresh), the page SHALL fall back to the default selection without error.

#### Scenario: Selecting a file pushes a history entry
- **GIVEN** the Instructions page is open at `/folder/<encoded cwd>/settings/instructions`
- **WHEN** the user picks `AGENTS.md` from the scoped picker
- **THEN** the URL SHALL become `/folder/<encoded cwd>/settings/instructions?file=AGENTS.md`
- **AND** a new browser history entry SHALL be created (push, not replace)
- **AND** the editor SHALL load `AGENTS.md`

#### Scenario: Back walks between selected files
- **GIVEN** the user selected `AGENTS.md` then `.pi/notes.md` on the Instructions page
- **WHEN** the user invokes the back action once
- **THEN** the URL SHALL return to `?file=AGENTS.md` and that file SHALL be shown
- **AND** the app SHALL NOT navigate to `/`

#### Scenario: Refresh restores the selected file
- **WHEN** the user refreshes at `/folder/<encoded cwd>/settings/instructions?file=AGENTS.md`
- **THEN** once candidates load, `AGENTS.md` SHALL be the active selection

#### Scenario: Unknown file falls back to default
- **WHEN** the page loads at `?file=does/not/exist.md` and no candidate matches
- **THEN** the page SHALL apply its default selection with no error
