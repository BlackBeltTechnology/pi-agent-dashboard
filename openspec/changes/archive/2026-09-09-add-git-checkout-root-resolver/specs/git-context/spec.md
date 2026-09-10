## MODIFIED Requirements

### Requirement: Git branch detection
The bridge extension SHALL detect the current git branch by running `git rev-parse --abbrev-ref HEAD` in the session's `cwd`. If the command fails (not a git repo), the branch SHALL be `undefined`. When in detached HEAD state, the extension SHALL detect the short commit SHA via `git rev-parse --short HEAD`.

In the same `gatherGitInfo` pass, the extension SHALL determine worktree identity via the shared checkout-root resolution (`git-checkout-root-resolution`). The cwd SHALL be classified as a worktree when it is a linked worktree (`git rev-parse --git-dir` differs from `git rev-parse --git-common-dir`) AND a main checkout resolves for it. The extension SHALL NOT classify by comparing `--git-common-dir` against `--show-toplevel`, and SHALL NOT derive `mainPath` as the parent of `--git-common-dir`: that comparison reports a submodule as a worktree, and that derivation names a real checkout only when the git dir happens to sit inside one. The resolver returns a repository-local `core.worktree` value VERBATIM and does not judge it, so a resolved main checkout containing an exact `.git` path SEGMENT SHALL be treated as no worktree: the extension is a DISPLAY consumer, and the safe response is to omit `gitWorktree` rather than put a git-internal path on the wire.

#### Scenario: Resolved main checkout inside a git directory
- **GIVEN** a linked worktree whose repository-local `core.worktree` names a path containing a `.git` segment
- **WHEN** the extension gathers git info for that cwd
- **THEN** the extension SHALL emit `gitWorktree: undefined` (or omit the field)
- **AND** SHALL NOT emit the git-internal path as `mainPath`

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

#### Scenario: Session in main repo checkout
- **WHEN** the cwd is not a linked worktree (its `--git-dir` equals its `--git-common-dir`)
- **THEN** the extension SHALL emit `gitWorktree: undefined` (or omit the field) on the gathered info
- **AND** this SHALL hold for a submodule checkout, a `--separate-git-dir` checkout, and a bare repository alike

#### Scenario: Session in a git worktree
- **WHEN** the cwd is a linked worktree and a main checkout resolves for it
- **THEN** the extension SHALL emit `gitWorktree: { mainPath, name }`
- **AND** `mainPath` SHALL be the resolved main checkout — the main working tree for an ordinary worktree, and the submodule's own checkout for a worktree of a submodule
- **AND** `mainPath` SHALL NOT be the parent of `--git-common-dir` when that parent is not a working tree
- **AND** `name` SHALL be the basename of the worktree's own ROOT (`thisCheckout`), NOT of the request cwd, which may be a subdirectory of the worktree

#### Scenario: Worktree detection failure
- **WHEN** either `rev-parse` invocation fails (e.g., insufficient git version, permission)
- **THEN** the extension SHALL fall through to `gitWorktree: undefined`
- **AND** SHALL NOT block the branch / remote / PR detection that follows
