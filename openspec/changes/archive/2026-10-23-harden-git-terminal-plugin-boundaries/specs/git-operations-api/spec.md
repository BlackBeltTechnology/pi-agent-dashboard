## ADDED Requirements

### Requirement: Git error bodies are redacted
Every git endpoint SHALL redact git-derived text (HTTP `error`, `message`, `stderr`, and the `worktree_init_failed` WebSocket message) before it reaches a client. Paths, home directory, URL userinfo and token-like secrets SHALL be relativized, masked or removed as the scenarios state, using specific token patterns only. A masked secret keeps its prefix plus `***`; a token is the prefix plus 20+ characters of `[A-Za-z0-9_-]`, not preceded by a word character. `code` values SHALL be unchanged.

#### Scenario: Repository path is made relative
- **WHEN** a git failure's stderr contains `/home/u/proj/src/a.ts` and the operation's repository root is `/home/u/proj`
- **THEN** the response SHALL carry `src/a.ts` in place of the absolute path
- **AND** the `code` field SHALL be the same value as before redaction

#### Scenario: Repository root itself becomes a dot
- **WHEN** a git failure's stderr names exactly the operation's repository root `/home/u/proj`
- **THEN** the response SHALL carry `.` in its place

#### Scenario: Home and foreign paths are masked
- **WHEN** an error text contains `/home/u/.ssh/config` and `/var/secret/x`, and the home directory is `/home/u`
- **THEN** the response SHALL show `~/.ssh/config` and a placeholder for `/var/secret/x`

#### Scenario: Remote URL credentials are removed
- **WHEN** a push or fetch error contains `https://user:tok@github.com/o/r.git`
- **THEN** the response SHALL NOT contain `user` or `tok`, and SHALL still name `github.com/o/r.git`

#### Scenario: SSH URL password is removed, user kept; scp form unchanged
- **WHEN** an error text contains `ssh://git:secret@github.com/o/r.git` and `git@github.com:o/r.git`
- **THEN** the response SHALL NOT contain `secret`, SHALL still contain `ssh://git@github.com/o/r.git`, and SHALL carry the scp-style remote unchanged

#### Scenario: Password-less userinfo is removed
- **WHEN** an error text contains `https://deploytoken@github.com/o/r.git`
- **THEN** the response SHALL NOT contain `deploytoken`, and SHALL still name `github.com/o/r.git`

#### Scenario: Token-like secrets are masked
- **WHEN** an error text contains a token-like secret such as a `ghp_`-, `github_pat_`-, `glpat-`- or `sk-`-prefixed token, or `Bearer <token>`
- **THEN** the response SHALL show the secret masked as its prefix followed by `***`, for example `ghp_***`

#### Scenario: Short or embedded lookalikes are not masked
- **WHEN** an error text contains `ghp_abc` (fewer than 20 token characters after the prefix) or `xghp_` followed by 20 or more token characters (a word character before the prefix)
- **THEN** the response SHALL carry that text unchanged

#### Scenario: Commit SHAs are preserved
- **WHEN** an error text contains a full 40-character commit hash such as `0123456789abcdef0123456789abcdef01234567`
- **THEN** the response SHALL carry the hash unchanged

#### Scenario: Worktree init failure message is redacted
- **WHEN** a worktree init hook fails and the server broadcasts `worktree_init_failed`
- **THEN** the message text SHALL be redacted by the same rules

#### Scenario: Hook output stays readable
- **WHEN** a commit hook prints a diagnostic that contains no paths or secrets
- **THEN** the `stderr` field SHALL carry that output unchanged

### Requirement: Redaction follows mapping and the operation's repository root
Redaction SHALL be applied to every outbound string AFTER server-side mapping (including the worktree-init hint derived from init stderr). Paths SHALL be made relative to the repository or worktree root the git operation ran in, not the request cwd or a value read at broadcast time. Users see the redacted text; this loss of detail is accepted.

#### Scenario: Worktree operation is relative to its own root
- **WHEN** a worktree operation runs in `/home/u/proj-wt` for a request whose cwd is `/home/u/proj`, and stderr names `/home/u/proj-wt/x.ts`
- **THEN** the response SHALL carry `x.ts`, not an absolute path

#### Scenario: Mapped init hint is redacted after mapping
- **WHEN** init stderr is mapped to a user-facing hint and either the raw stderr or the hint contains an absolute path or credential
- **THEN** both the `stderr` field and the hint SHALL be redacted

### Requirement: Caller-supplied refs are never parsed as options
Every git endpoint that passes a caller-supplied ref, commit-ish, new branch name, base hint or worktree path to git SHALL reject a PRESENT value that is not a string, begins with `-`, or contains a control character (C0 `0x00`–`0x1F` or DEL `0x7F`), with HTTP 400 and `code: "invalid_ref"`, before any git process starts. A missing required field (absent, `null` or empty string) SHALL keep the endpoint's existing missing-parameter response, not `invalid_ref`.

#### Scenario: Leading dash is refused
- **WHEN** a worktree-create request carries base `--upload-pack=x`
- **THEN** the server SHALL return 400 `invalid_ref` and SHALL NOT run git

#### Scenario: Control characters are refused
- **WHEN** a ref contains a newline, tab, NUL or DEL (`0x7F`) character
- **THEN** the server SHALL return 400 `invalid_ref`

#### Scenario: Non-string ref is refused
- **WHEN** a present ref field is a number, object or array
- **THEN** the server SHALL return 400 `invalid_ref`

#### Scenario: All caller ref inputs are covered
- **WHEN** an option-like value is supplied as the checkout commit-ish or the worktree path
- **THEN** each SHALL be refused with 400 `invalid_ref`

#### Scenario: Orphan-cleanup, PR-worktree and worktree-remove inputs are covered
- **WHEN** an option-like or control-character value is supplied as a ref or path to an orphan-cleanup, PR-worktree or worktree-remove request
- **THEN** the server SHALL return 400 `invalid_ref` and SHALL NOT run git

#### Scenario: Ordinary refs still work
- **WHEN** a request carries `feature/x`, `origin/main`, or a full commit hash
- **THEN** it SHALL be accepted and processed as before

### Requirement: Derived and optional git arguments are validated
A name derived from caller input (the local name after stripping a remote prefix) and a new branch name (`-b` value) SHALL satisfy the same rules as direct refs; an empty derived name SHALL be `invalid_ref`. A base hint SHALL be validated when set and re-validated where used. A worktree path is optional: absent uses the default; present is validated.

#### Scenario: Derived local name is validated
- **WHEN** a checkout request carries `origin/-x`, so the local name after the remote prefix is stripped is `-x`
- **THEN** the server SHALL return 400 `invalid_ref` and SHALL NOT run git

#### Scenario: Derived empty name is refused
- **WHEN** a checkout request carries `origin/`, so nothing remains after the remote prefix is stripped
- **THEN** the server SHALL return 400 `invalid_ref` and SHALL NOT run git

#### Scenario: New branch name is validated
- **WHEN** a worktree-create request carries `newBranch: "--detach"`
- **THEN** the server SHALL return 400 `invalid_ref` and SHALL NOT run git

#### Scenario: Optional worktree path
- **WHEN** a worktree-create request omits the path
- **THEN** the default worktree path SHALL be used
- **AND** WHEN the request carries a path beginning with `-`, the server SHALL return 400 `invalid_ref`

#### Scenario: Invalid base hint over WebSocket is not stored
- **WHEN** a client message sets a base hint beginning with `-`
- **THEN** the hint SHALL NOT be stored, SHALL be logged, and the client SHALL receive no error for it

#### Scenario: Stored base hint is re-validated at use
- **WHEN** a stored base hint beginning with `-` reaches a git command builder
- **THEN** it SHALL be ignored, default base resolution SHALL apply, and the value SHALL NOT reach git as an argument

## MODIFIED Requirements

### Requirement: Checkout endpoint
The server SHALL expose `POST /api/git/checkout` (localhost-only) that switches branches with optional stash support. A missing `cwd` or `branch` (absent, `null` or empty) SHALL keep the existing HTTP 400 `code: "cwd_and_branch_required"`. A present `branch` SHALL be validated under "Caller-supplied refs are never parsed as options", including the local name derived from a remote branch, before any git command runs; a present invalid value SHALL be refused with HTTP 400 and `code: "invalid_ref"`.

#### Scenario: Clean checkout of local branch
- **WHEN** `POST /api/git/checkout` is called with `{ cwd, branch, stash: false }` and the working tree is clean
- **THEN** the server SHALL run `git checkout <branch>` and return `{ success: true }`

#### Scenario: Dirty working tree without stash
- **WHEN** the working tree has uncommitted changes and `stash` is `false`
- **THEN** the server SHALL return HTTP 409 with `{ success: false, dirty: true, files: string[] }`
- **AND** the files array SHALL contain the list of modified/untracked files from `git status --porcelain`

#### Scenario: Checkout with stash
- **WHEN** `stash` is `true` and the working tree is dirty
- **THEN** the server SHALL run `git stash push -u` before `git checkout <branch>`
- **AND** return `{ success: true, stashed: true }`

#### Scenario: Remote branch checkout
- **WHEN** the branch name starts with `origin/` and no local branch of that name exists
- **THEN** the server SHALL run `git checkout -b <local-name> <remote-name>` to create a local tracking branch

#### Scenario: Already on target branch
- **WHEN** the target branch is the current branch
- **THEN** the server SHALL return `{ success: true }` without running any git commands

#### Scenario: Option-like branch is refused before git runs
- **WHEN** `POST /api/git/checkout` is called with `{ cwd, branch: "--orphan=x" }`
- **THEN** the server SHALL return HTTP 400 with `code: "invalid_ref"`
- **AND** no git command SHALL run and the working tree SHALL be unchanged

#### Scenario: Non-string branch is refused
- **WHEN** `POST /api/git/checkout` is called with `branch` set to a number, object, or array
- **THEN** the server SHALL return HTTP 400 with `code: "invalid_ref"`

#### Scenario: Missing branch keeps the existing code
- **WHEN** `POST /api/git/checkout` is called with `{ cwd }` and no `branch`, or `branch: ""`
- **THEN** the server SHALL return HTTP 400 with `code: "cwd_and_branch_required"`
