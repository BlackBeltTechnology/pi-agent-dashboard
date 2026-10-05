## ADDED Requirements

### Requirement: Branch checkout executes via argv without shell interpolation
The branch checkout operation SHALL execute git via an argument vector
(`spawn`/`runGitCapture` with `shell:false`), never by interpolating the
request-supplied branch name into a shell command string. Both the local checkout
(`git checkout <branch>`) and the remote-tracking checkout
(`git checkout -b <localName> <branch>`) SHALL pass branch and local names as
distinct arguments.

#### Scenario: Injection payload does not execute
- **WHEN** `POST /api/git/checkout` is called with `branch` = `x; id > /tmp/pwned #`
- **THEN** no shell command SHALL run beyond git itself
- **AND** the file `/tmp/pwned` SHALL NOT be created

#### Scenario: Valid local branch checkout still works
- **WHEN** `POST /api/git/checkout` is called with a valid existing local `branch`
- **THEN** the working tree SHALL switch to that branch (behavior unchanged)

#### Scenario: Remote-tracking branch checkout still works
- **WHEN** `POST /api/git/checkout` is called with `branch` = `origin/feature-x` and no local branch exists
- **THEN** a local tracking branch `feature-x` SHALL be created and checked out via argv (no shell)

### Requirement: Branch names validated at the route boundary
The checkout route SHALL validate the `branch` value against an allowlist before
invoking the git operation, rejecting names that do not match safe git ref
characters and rejecting any name beginning with `-` (option injection). A
rejected request SHALL return a 4xx error and SHALL NOT invoke git.

#### Scenario: Leading-dash branch rejected
- **WHEN** `branch` = `--upload-pack=evil`
- **THEN** the route SHALL reject the request with a 4xx error and SHALL NOT invoke git

#### Scenario: Shell-metacharacter branch rejected
- **WHEN** `branch` = `a$(id)`
- **THEN** the route SHALL reject the request with a 4xx error

### Requirement: Git operations avoid platform-dependent shell escaping
Git operations SHALL execute via argv (`shell:false`) on all platforms when they
incorporate branch names, refs, worktree paths, or PR arguments, rather than
building a shell string with a POSIX-only escape helper. Correctness SHALL NOT
depend on the host shell's quoting rules.

#### Scenario: Windows argument injection prevented
- **WHEN** a worktree/merge/PR operation runs on Windows with a ref containing `&` (e.g. `a&calc`)
- **THEN** the ref SHALL be passed as a single argv argument and SHALL NOT be interpreted by cmd.exe

#### Scenario: POSIX behavior unchanged
- **WHEN** the same operation runs on macOS/Linux with a normal ref
- **THEN** the result SHALL be identical to the previous shell-escaped behavior
