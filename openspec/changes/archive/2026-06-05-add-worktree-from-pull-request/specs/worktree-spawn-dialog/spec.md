# worktree-spawn-dialog — delta

## ADDED Requirements

### Requirement: From-a-pull-request creation mode

The "Create a new worktree" section of `WorktreeSpawnDialog` SHALL offer a source toggle with two modes: **From a branch** (the existing base-branch + new-branch-name + path fields) and **From a pull request**. The dialog SHALL default to **From a branch**, preserving existing behaviour.

In **From a pull request** mode, the dialog SHALL render a `PrCombobox` typeahead listing the repository's open pull requests (via `GET /api/git/pull-requests`). Selecting a PR SHALL derive a worktree path (default `<repo>/.worktrees/pr-<number>`, editable via the existing Path input) and, on submit, SHALL call `POST /api/git/worktree/from-pr` with `{ cwd, prNumber, path }`.

The **From a pull request** toggle SHALL degrade gracefully when `gh` is unavailable: the dialog SHALL NOT eagerly probe `gh` at mount; on first activation of the PR mode the `PrCombobox` SHALL fetch the PR list, and if the server returns `gh_not_found` or `gh_not_authed`, the toggle SHALL be disabled with an inline hint rather than presented as a working but dead control.

The PR list fetch SHALL surface loading, error, empty, and gh-unavailable states (PR data is a network round-trip, unlike the local branch list).

#### Scenario: Default mode is From a branch

- **WHEN** the dialog opens
- **THEN** the source toggle SHALL be set to "From a branch"
- **AND** the existing base-branch, new-branch-name, and path fields SHALL render
- **AND** no PR list fetch SHALL be issued

#### Scenario: Switching to PR mode loads PRs

- **WHEN** the user activates "From a pull request" for the first time
- **THEN** the `PrCombobox` SHALL fetch `GET /api/git/pull-requests?cwd=…`
- **AND** SHALL show a loading state until the response resolves
- **AND** on success SHALL list open PRs with number, title, author, and a CI/draft badge

#### Scenario: Selecting a PR derives the path

- **WHEN** the user selects PR #142 in PR mode
- **THEN** the path field SHALL derive to `<repo>/.worktrees/pr-142`
- **AND** the path SHALL remain editable

#### Scenario: PR-mode submit posts from-pr

- **WHEN** the user has selected a PR and submits in PR mode
- **THEN** the dialog SHALL call `POST /api/git/worktree/from-pr` with `{ cwd, prNumber, path }`
- **AND** SHALL NOT call the branch-based `POST /api/git/worktree`

#### Scenario: gh unavailable disables the PR toggle

- **WHEN** activating PR mode and the PR fetch returns `gh_not_found` or `gh_not_authed`
- **THEN** the "From a pull request" toggle SHALL become disabled
- **AND** an inline hint SHALL explain that `gh` must be installed/authenticated to checkout PRs
- **AND** the dialog SHALL remain usable in "From a branch" mode

#### Scenario: Typeahead filtering of PRs

- **WHEN** the `PrCombobox` is open and the user types
- **THEN** the list SHALL filter to PRs whose number, title, or head branch contains the typed text (case-insensitive)

#### Scenario: Keyboard selection in PR mode

- **WHEN** the `PrCombobox` popover is open
- **THEN** ArrowUp/ArrowDown SHALL move the highlight, Enter SHALL select the highlighted PR, and Escape SHALL close the popover without closing the dialog

#### Scenario: Branch mode unchanged

- **WHEN** the dialog is in "From a branch" mode
- **THEN** the base-branch + new-branch-name + path fields and the `POST /api/git/worktree` submit path SHALL behave exactly as before this change
