## Purpose

[Spec purpose]
## Requirements
### Requirement: Git branch detection
The bridge extension SHALL detect the current git branch by running `git rev-parse --abbrev-ref HEAD` in the session's `cwd`. If the command fails (not a git repo), the branch SHALL be `undefined`. When in detached HEAD state, the extension SHALL detect the short commit SHA via `git rev-parse --short HEAD`.

#### Scenario: Session in a git repository
- **WHEN** the extension gathers git info in a directory that is a git repository
- **THEN** the extension SHALL detect the current branch name

#### Scenario: Session not in a git repository
- **WHEN** the extension gathers git info in a directory that is not a git repository
- **THEN** the branch SHALL be `undefined` and no git info SHALL be sent

#### Scenario: Detached HEAD
- **WHEN** the git repository is in a detached HEAD state
- **THEN** `git rev-parse --abbrev-ref HEAD` returns `"HEAD"`
- **AND** the extension SHALL run `git rev-parse --short HEAD` to get the short commit SHA
- **AND** the branch SHALL be the short SHA (e.g., `"abc1234"`)
- **AND** no branch link SHALL be generated

### Requirement: Git remote URL detection
The extension SHALL detect the remote URL by running `git remote get-url origin` in the session's `cwd`. If the command fails (no origin remote), the remote URL SHALL be `undefined`.

#### Scenario: SSH remote URL
- **WHEN** the origin remote URL is in SSH format (e.g., `git@github.com:user/repo.git`)
- **THEN** the extension SHALL parse it to extract the host, user, and repo

#### Scenario: HTTPS remote URL
- **WHEN** the origin remote URL is in HTTPS format (e.g., `https://github.com/user/repo.git`)
- **THEN** the extension SHALL parse it to extract the host, user, and repo

#### Scenario: No origin remote
- **WHEN** the repository has no "origin" remote configured
- **THEN** the remote URL SHALL be `undefined` and no links SHALL be generated

### Requirement: PR number detection
The extension SHALL attempt to detect the current PR/MR number using platform-specific CLI tools. Detection SHALL be best-effort and fail silently.

#### Scenario: GitHub PR detected via gh CLI
- **WHEN** `gh` CLI is available and the current branch has an open PR
- **THEN** the extension SHALL detect the PR number

#### Scenario: CLI tool not available
- **WHEN** the platform CLI tool (gh, glab, etc.) is not installed
- **THEN** the PR number SHALL be `undefined` and no PR link SHALL be generated

### Requirement: Hosting platform link building
The extension SHALL build clickable URLs for the git branch and PR based on the detected hosting platform.

Supported platforms and their URL patterns:
- **GitHub**: branch → `/tree/{branch}`, PR → `/pull/{number}`
- **GitLab**: branch → `/-/tree/{branch}`, MR → `/-/merge_requests/{number}`
- **Bitbucket**: branch → `/src/{branch}`, PR → `/pull-requests/{number}`
- **Gitea**: branch → `/src/branch/{branch}`, PR → `/pulls/{number}`
- **Codeberg**: branch → `/src/branch/{branch}`, PR → `/pulls/{number}`
- **SourceHut**: branch → `/tree/{branch}`, patches → `/patches/{number}`

#### Scenario: GitHub repository with PR
- **WHEN** the remote is `git@github.com:user/repo.git`, branch is `feat/foo`, PR is #42
- **THEN** the branch URL SHALL be `https://github.com/user/repo/tree/feat%2Ffoo` and PR URL SHALL be `https://github.com/user/repo/pull/42`

#### Scenario: GitLab repository
- **WHEN** the remote is `https://gitlab.com/user/repo.git` and branch is `main`
- **THEN** the branch URL SHALL be `https://gitlab.com/user/repo/-/tree/main`

#### Scenario: Unknown hosting platform
- **WHEN** the remote host does not match any known platform
- **THEN** no URLs SHALL be generated and branch/PR SHALL be shown as plain text

#### Scenario: Branch with special characters
- **WHEN** the branch name contains `/` or other URL-unsafe characters
- **THEN** the branch name SHALL be URL-encoded in the generated URL

### Requirement: Periodic git info refresh
The extension SHALL poll git info every 30 seconds and send a `git_info_update` message to the server only when the branch or PR number has changed since the last update.

#### Scenario: Branch changes during session
- **WHEN** the user checks out a different branch during a session
- **THEN** the next 30-second poll SHALL detect the change and send updated git info

#### Scenario: No change since last poll
- **WHEN** git info has not changed since the last update
- **THEN** the extension SHALL NOT send a `git_info_update` message

#### Scenario: Initial git info
- **WHEN** a session is registered
- **THEN** the extension SHALL send git info immediately after registration, then poll every 30 seconds

### Requirement: Git branch rendered as chip in session card
In addition to the existing GroupGitInfo at the folder level, the session card SHALL render git branch information as a compact chip in its meta row. The chip SHALL include the branch name with a git icon. When gitPrNumber is set, the PR number SHALL be included in the same chip.

#### Scenario: Branch chip in card
- **WHEN** session.gitBranch is "feature/x"
- **THEN** the card SHALL render a chip with branch icon and "feature/x"

#### Scenario: Branch chip with PR
- **WHEN** session.gitBranch is "feature/x" and session.gitPrNumber is 42
- **THEN** the chip SHALL render "feature/x · #42"

#### Scenario: No git info
- **WHEN** session.gitBranch is not set
- **THEN** no git chip SHALL render in the card

