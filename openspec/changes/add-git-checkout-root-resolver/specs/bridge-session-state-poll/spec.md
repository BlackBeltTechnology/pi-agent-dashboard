## MODIFIED Requirements

### Requirement: Git state detection

The bridge SHALL detect the current git branch, remote origin URL, open PR number, and worktree identity for a cwd, and SHALL treat non-repository probes such that a real repo whose probe fails inconclusively never loses its git signal.

Worktree identity SHALL be derived from the shared checkout-root resolution
(`git-checkout-root-resolution`): a cwd is reported as a worktree when it is a linked
worktree AND a main checkout resolves for it, with `mainPath` set to that resolved main
checkout and `name` set to the cwd's basename. Worktree identity SHALL NOT be derived from a
bare inside/outside comparison of `--git-common-dir` against `--show-toplevel`, and SHALL NOT
be derived from the common dir's name.

Consequently:

- A **submodule** SHALL NOT be reported as a worktree. Its per-worktree git dir and common
  dir are equal, so it is not a linked worktree; it is an independent project and consumers
  group it by its own cwd. The same applies to a `--separate-git-dir` checkout and to a bare
  repository.
- A **worktree of a submodule** SHALL be reported as a worktree, with `mainPath` set to the
  submodule's own checkout — never to a path inside `.git/modules`.
- A **worktree of a bare repository** is a linked worktree for which no main checkout exists.
  It SHALL be reported with NO worktree identity rather than with a fabricated `mainPath`, so
  it groups by its own cwd.

The bridge SHALL validate the resolved main checkout before reporting it, because the resolver
returns a user-controlled `core.worktree` value verbatim and does not judge it. When the
resolved main checkout contains a `.git` path segment (exact-segment test), the bridge SHALL
report NO worktree identity rather than the invalid path — omitting the field is the safe
response for a display consumer. `mainPath`, when reported, SHALL NEVER contain a `.git` path
segment.

#### Scenario: Branch resolves for a normal checkout
- **WHEN** git detection runs against a cwd on a named branch
- **THEN** the detected branch is that branch's short ref name

#### Scenario: Detached HEAD resolves to a short SHA
- **WHEN** the current ref resolves to `HEAD` (detached)
- **THEN** the detected branch is the short commit SHA
- **AND** when even that fails it falls back to the literal `HEAD`

#### Scenario: Not a git repository yields no git info
- **WHEN** the branch cannot be detected for a cwd
- **THEN** `gatherGitInfo` returns undefined and no git_info_update is sent for that tick

#### Scenario: Worktree identity is derived from git-common-dir vs toplevel
- **WHEN** the cwd is a linked worktree (its `--git-dir` differs from its `--git-common-dir`) AND a main checkout resolves for it
- **THEN** the cwd is reported as a worktree with `mainPath` set to that main checkout and `name` set to the cwd's basename
- **AND** when the cwd is not a linked worktree, or no main checkout resolves, or either rev-parse fails, the worktree is undefined

#### Scenario: Submodule is not a worktree
- **GIVEN** a cwd that is a git submodule checkout, whose `--git-common-dir` is `<super>/.git/modules/<name>` and equals its `--git-dir`
- **WHEN** git detection runs for that cwd
- **THEN** the worktree identity SHALL be undefined
- **AND** no `mainPath` pointing inside `<super>/.git/modules` SHALL be reported
- **AND** the branch, remote, and PR signals for the submodule SHALL still be detected normally

#### Scenario: Worktree of a submodule reports the submodule as its main path
- **GIVEN** a worktree created from a submodule checked out at `/super/models/sub`, whose common dir is `/super/.git/modules/models/sub`
- **WHEN** git detection runs for that worktree
- **THEN** it SHALL be reported as a worktree
- **AND** `mainPath` SHALL be `/super/models/sub`
- **AND** `mainPath` SHALL NOT be `/super/.git/modules/models`

#### Scenario: An implausible resolved main checkout is not reported
- **GIVEN** a linked worktree whose repository-local `core.worktree` points inside a git directory, which the resolver returns verbatim
- **WHEN** git detection runs for that worktree
- **THEN** the bridge SHALL report no worktree identity
- **AND** SHALL NOT emit a `mainPath` containing a `.git` path segment
- **AND** SHALL NOT rely on the resolver having filtered the value

#### Scenario: Worktree of a bare repository reports no worktree identity
- **GIVEN** a worktree created from a bare hub, for which no main checkout exists
- **WHEN** git detection runs for that worktree
- **THEN** the worktree identity SHALL be undefined rather than naming the directory that contains the bare git dir
- **AND** the session SHALL group by its own cwd

#### Scenario: Separate-git-dir and bare checkouts report no worktree identity
- **GIVEN** a cwd created with `git init --separate-git-dir=<elsewhere>.git`, whose `--git-dir` and `--git-common-dir` are equal
- **WHEN** git detection runs for that cwd
- **THEN** the worktree identity SHALL be undefined rather than reporting the common dir's parent as `mainPath`
- **AND** the same SHALL hold for a bare repository cwd, which has no toplevel at all

#### Scenario: Git-repo tri-state distinguishes confirmed non-repo from unknown
- **WHEN** the git-repo probe exits with code 128 ("not a repository")
- **THEN** the repo state is a confirmed false
- **AND** when the probe fails any other way (missing binary, timeout, signal, other exit code) the repo state is undefined (unknown) rather than false
