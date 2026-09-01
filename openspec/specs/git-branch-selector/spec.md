# git-branch-selector Specification

## Purpose

Lets the user see and change the git branch of a folder group from the dashboard. Defines the clickable branch indicator on the group header, a typeahead branch picker, the checkout orchestration behind it, and initialising a repository from the same affordance when the folder is not yet a git repo.

## Requirements

### Requirement: Clickable branch icon at folder group level
The `GroupGitInfo` component SHALL render the branch icon as a clickable button that opens the branch picker dialog. The icon SHALL be the entry point for all git branch operations at the folder level.

#### Scenario: Git repo with normal branch
- **WHEN** the folder group has sessions with a detected git branch
- **THEN** the branch icon SHALL be clickable and display the branch name next to it
- **AND** clicking the icon SHALL open the BranchPicker dialog

#### Scenario: Git repo with detached HEAD
- **WHEN** the git repository is in detached HEAD state
- **THEN** the branch icon SHALL display the short commit SHA
- **AND** clicking the icon SHALL open the BranchPicker dialog to select a branch

#### Scenario: No git repository
- **WHEN** the folder group's `cwd` is not inside any git repository
- **THEN** the branch icon SHALL appear dimmed
- **AND** clicking the icon SHALL show a confirmation prompt to initialize a git repository

#### Scenario: Individual session GitInfo
- **WHEN** a session card shows git info via the `GitInfo` component
- **THEN** the branch icon SHALL remain read-only and NOT open any picker

### Requirement: Typeahead branch picker dialog
The BranchPicker dialog SHALL provide a keyboard-first typeahead interface for selecting a git branch, following the same interaction pattern as the existing PathPicker component.

#### Scenario: Opening the picker
- **WHEN** the user clicks the branch icon on a folder group
- **THEN** the dialog SHALL fetch the branch list from `GET /api/git/branches?cwd=...`
- **AND** display branches in a scrollable list with a text input for filtering

#### Scenario: Typeahead filtering
- **WHEN** the user types in the filter input
- **THEN** the branch list SHALL filter to show only branches whose name contains the typed text (case-insensitive)

#### Scenario: Keyboard navigation
- **WHEN** the picker is open
- **THEN** Arrow Up/Down SHALL move the highlight through the list
- **AND** Enter SHALL select the highlighted branch
- **AND** Escape SHALL close the picker

#### Scenario: Current branch indicator
- **WHEN** branches are displayed in the list
- **THEN** the current branch SHALL be marked with a `●` indicator
- **AND** the current branch SHALL NOT be selectable for checkout

#### Scenario: Local and remote branches
- **WHEN** the branch list is displayed
- **THEN** local branches SHALL appear first
- **AND** remote-only branches SHALL appear in a separate section with a visual separator
- **AND** branches SHALL be sorted by most recent commit date within each section

### Requirement: Branch checkout orchestration
The BranchSwitchDialog SHALL orchestrate the full checkout flow including dirty-state handling, stash prompt, and stash pop prompt.

#### Scenario: Clean checkout
- **WHEN** the user selects a branch and the working tree is clean
- **THEN** the dialog SHALL call `POST /api/git/checkout` with `stash: false`
- **AND** on success, close the dialog

#### Scenario: Dirty working tree
- **WHEN** the checkout returns 409 with dirty files
- **THEN** the dialog SHALL display the list of uncommitted changed files
- **AND** offer "Cancel" and "Stash & Switch" buttons

#### Scenario: Stash and switch
- **WHEN** the user clicks "Stash & Switch"
- **THEN** the dialog SHALL call `POST /api/git/checkout` with `stash: true`
- **AND** on success, prompt "Pop stash on new branch?" with "No, keep stashed" and "Pop" buttons

#### Scenario: Stash pop accepted
- **WHEN** the user clicks "Pop" after a successful stash + checkout
- **THEN** the dialog SHALL call `POST /api/git/stash-pop`
- **AND** if conflicts occur, display a warning message before closing

#### Scenario: Stash pop declined
- **WHEN** the user clicks "No, keep stashed"
- **THEN** the dialog SHALL close without popping the stash

#### Scenario: Remote branch checkout
- **WHEN** the user selects a remote-only branch (e.g., `origin/feature-x`)
- **THEN** the checkout SHALL create a local tracking branch named `feature-x`

### Requirement: Git init from branch icon
When the folder's `cwd` has no git context, clicking the branch icon SHALL offer to initialize a git repository.

#### Scenario: Confirm git init
- **WHEN** the user clicks the dimmed branch icon and confirms initialization
- **THEN** the system SHALL call `POST /api/git/init` with the folder's `cwd`
- **AND** on success, refresh the folder's git info

#### Scenario: Cancel git init
- **WHEN** the user clicks "Cancel" on the init confirmation
- **THEN** no git repository SHALL be created
