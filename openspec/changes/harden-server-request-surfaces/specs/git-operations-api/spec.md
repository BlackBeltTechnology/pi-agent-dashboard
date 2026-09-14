## ADDED Requirements

### Requirement: Caller-supplied git arguments never reach a shell
Every git and `gh` invocation performed on behalf of a worktree or branch
request that carries a caller-supplied value — branch name, base ref, remote
ref, worktree path, pull-request number, commit message — SHALL pass that value
as a discrete argv element to the child process with no shell interpreter on
any platform. The server SHALL NOT construct a command string from
caller-supplied values, and SHALL NOT rely on POSIX quoting to neutralise
shell metacharacters (`cmd.exe` treats single quotes as literal characters).
Exit-code handling, stable error codes, and timeouts SHALL be unchanged by the
invocation form.

#### Scenario: Branch name with a command separator is passed verbatim
- **WHEN** a create-worktree request names the branch `feat&calc`
- **THEN** git SHALL be invoked with `feat&calc` as a single argument
- **AND** no process other than git SHALL be started

#### Scenario: Merge with a metacharacter branch on Windows semantics
- **WHEN** a merge request targets a worktree whose branch is `x; echo pwned`
- **THEN** `git merge --no-ff` SHALL receive `x; echo pwned` as one argument
- **AND** the merge outcome SHALL be reported by git's exit status alone

#### Scenario: Diff-stat with a base containing spaces
- **WHEN** a diff-stat request resolves a base of `release 2026`
- **THEN** the range argument SHALL be a single argv element `release 2026..<branch>`

#### Scenario: Pull-request creation passes the title untouched
- **WHEN** a create-pull-request request carries a title containing `"` and `$(`
- **THEN** `gh pr create` SHALL receive the title as one argument with those characters intact
