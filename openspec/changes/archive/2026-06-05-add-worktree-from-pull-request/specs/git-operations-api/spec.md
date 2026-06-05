# git-operations-api — delta

## ADDED Requirements

### Requirement: List pull requests endpoint

The server SHALL expose `GET /api/git/pull-requests?cwd=…` returning the open pull requests for the repository at `cwd`. The endpoint SHALL run behind the `networkGuard` preHandler and SHALL resolve the `gh` binary via the tool registry before invoking it.

The handler SHALL shell out to `gh pr list --json number,title,headRefName,headRefOid,author,isDraft,isCrossRepository,statusCheckRollup --limit 100`, parse the result into a `PullRequestInfo[]`, and collapse each PR's `statusCheckRollup` into a single `checkRollup` summary (`"passing" | "failing" | "pending" | "none"`).

`gh` failures SHALL map to stable codes consistent with the existing PR-create route: `gh_not_found` when the binary is unresolved, `gh_not_authed` when authentication fails, `no_remote` when no GitHub remote is configured.

#### Scenario: Successful list

- **WHEN** a client requests `GET /api/git/pull-requests?cwd=<repo>` for a repo with open PRs and an authenticated `gh`
- **THEN** the response SHALL be `{ success: true, data: PullRequestInfo[] }`
- **AND** each entry SHALL carry `number`, `title`, `headRefName`, `headRefOid`, `author`, `isDraft`, `isCrossRepository`, and `checkRollup`

#### Scenario: gh binary not found

- **WHEN** the `gh` binary cannot be resolved via the tool registry
- **THEN** the response SHALL be a failure envelope with code `gh_not_found` and HTTP status 400
- **AND** no `gh` subprocess SHALL be spawned

#### Scenario: gh not authenticated

- **WHEN** `gh pr list` fails because the user is not authenticated
- **THEN** the response SHALL be a failure envelope with code `gh_not_authed` and HTTP status 401

#### Scenario: No GitHub remote

- **WHEN** the repository has no GitHub remote configured
- **THEN** the response SHALL be a failure envelope with code `no_remote` and HTTP status 400

#### Scenario: Invalid cwd

- **WHEN** the `cwd` query parameter fails validation
- **THEN** the response SHALL be a failure envelope with HTTP status 400 and SHALL NOT invoke `gh`

### Requirement: Create worktree from pull request endpoint

The server SHALL expose `POST /api/git/worktree/from-pr` accepting `{ cwd: string; prNumber: number; path?: string }`. The endpoint SHALL run behind `networkGuard`, validate `cwd`, and resolve `gh` before proceeding.

The handler SHALL materialise the pull request's head commit into a new git worktree without modifying the repository's current working tree. The worktree SHALL be checked out at the PR head, on a local branch derived from the PR number (`pr-<number>` unless the spike decides otherwise). The mechanic SHALL handle pull requests originating from forks (`isCrossRepository: true`), not only same-repository PRs.

The handler SHALL reuse the worktree-creation success/failure contract of the existing create-worktree endpoint: 409 for `branch_exists` / `branch_in_use` / `path_exists`, 400 for `not_a_repo` / `base_not_found`, plus `pr_not_found` (404) and `gh_not_authed` (401) for PR-specific failures.

#### Scenario: Same-repository PR checkout

- **WHEN** a client posts `{ cwd, prNumber }` for an open same-repo PR
- **THEN** a new worktree SHALL be created at the PR head commit
- **AND** the response SHALL be `{ success: true, data: { path, branch, prNumber } }`
- **AND** the repository's pre-existing working tree HEAD SHALL be unchanged

#### Scenario: Fork PR checkout

- **WHEN** a client posts `{ cwd, prNumber }` for an open PR whose head is on a fork (`isCrossRepository: true`)
- **THEN** the worktree SHALL still be created at the PR head commit
- **AND** the operation SHALL NOT require pre-existing fork-remote configuration

#### Scenario: PR not found

- **WHEN** the posted `prNumber` does not correspond to an open PR
- **THEN** the response SHALL be a failure envelope with code `pr_not_found` and HTTP status 404

#### Scenario: Re-checkout collision

- **WHEN** a worktree or local branch for the same PR already exists
- **THEN** the response SHALL reuse the existing `branch_exists` / `branch_in_use` / `path_exists` codes with HTTP status 409
- **AND** the existing worktree SHALL NOT be silently overwritten

#### Scenario: gh unavailable

- **WHEN** `gh` cannot be resolved or the user is not authenticated
- **THEN** the response SHALL be `gh_not_found` (400) or `gh_not_authed` (401) respectively
- **AND** no worktree SHALL be created
