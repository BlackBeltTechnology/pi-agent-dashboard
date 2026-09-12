## MODIFIED Requirements

### Requirement: Config-root resolution decoupled from git

The server SHALL resolve the directory that holds a checkout's worktree-init
configuration via `resolveConfigRoot(cwd)`, independent of whether the cwd is a
git repository. A SINGLE checkout-root resolution SHALL decide both whether the
cwd is in a repository and which checkout holds its config; the server SHALL NOT
use a separate `--is-inside-work-tree` probe for that decision, because that
probe reports FALSE inside a bare repository and would let a bare repository
fall through to the non-git branch.

- WHEN the checkout-root resolution yields a result for `cwd` (the cwd is inside
  a repository, including a bare one), `resolveConfigRoot` SHALL return the
  resolved MAIN CHECKOUT of that repository, or `null` when none resolves. It
  SHALL NOT fall through to the non-git `cwd/.pi/settings.json` check.
- WHEN the resolution yields no result AND `cwd/.pi/settings.json` exists,
  `resolveConfigRoot` SHALL return `cwd`.
- WHEN the resolution yields no result AND `cwd/.pi/settings.json` does not
  exist, `resolveConfigRoot` SHALL return `null`.

"No result" is a SINGLE observable outcome: the resolver does not distinguish a
directory that is not a repository from a probe that failed or timed out. This
requirement therefore does NOT ask for different behaviour in those two cases,
and no scenario SHALL assert one. The consequence is accepted deliberately: a
transient probe failure inside a real repository that also carries
`cwd/.pi/settings.json` resolves to `cwd` for that call. The alternative —
treating an unanswerable probe as a hard `null` — would break the ordinary
non-git directory case, which is the common one on this path, and the
read-only init-status surface is the correct place to absorb that risk rather
than a delete boundary.

The resolved main checkout SHALL be the shared resolver's `mainCheckout`, NOT
the parent of `git rev-parse --git-common-dir`. For a submodule and for a
worktree of a submodule this is the submodule's own working tree; for a
`--separate-git-dir` checkout it is the checkout itself; for a bare repository
and a worktree of a bare hub it is `null`.

A `null` config root SHALL survive every consumer. No caller SHALL substitute
`cwd` for a `null` result, whether directly or through a default-value
coercion on a memoised lookup: substituting `cwd` re-creates exactly the
bare-repository adoption this requirement forbids, on whichever path performs
the substitution. Consumers SHALL treat `null` as "no config root" and skip the
lookup they would otherwise perform.

For a non-git directory the config root SHALL be exactly `cwd`; the server SHALL
NOT walk upward to a parent directory's `.pi/settings.json`. `resolveConfigRoot`
only locates a config file: it MAY run read-only git discovery probes
(`git rev-parse`), but it SHALL NOT execute any repo-declared hook command
(`gate`/`run`).

The init-status (`GET /api/git/worktree/init-status`) and init
(`POST /api/git/worktree/init`) endpoints SHALL use `resolveConfigRoot` in place
of the previous `isGitRepo` guard plus `resolveMainPath` call. Worktree
creation, removal, and lifecycle endpoints SHALL continue to require a git
repository and SHALL be unaffected by this requirement.

#### Scenario: Git checkout resolves to main repo root

- **WHEN** `resolveConfigRoot(cwd)` is called for a cwd inside a git worktree
- **THEN** it SHALL return the repository's resolved main checkout

#### Scenario: Submodule resolves to the submodule checkout

- **GIVEN** `cwd` is inside a submodule whose git dir is `<super>/.git/modules/<name>`
- **AND** `<submodule-checkout>/.pi/settings.json` exists
- **WHEN** `resolveConfigRoot(cwd)` is called
- **THEN** it SHALL return the submodule's working tree
- **AND** init-status SHALL report the declared hook rather than an unconfigured directory

#### Scenario: Worktree of a submodule resolves to the submodule checkout

- **GIVEN** `cwd` is a linked worktree created from inside a submodule
- **WHEN** `resolveConfigRoot(cwd)` is called
- **THEN** it SHALL return the submodule's working tree

#### Scenario: Separate-git-dir checkout resolves to itself

- **GIVEN** a checkout created with `--separate-git-dir`
- **WHEN** `resolveConfigRoot(cwd)` is called
- **THEN** it SHALL return the checkout itself, not the parent of the separate git dir

#### Scenario: Bare repository does not adopt its own settings

- **GIVEN** `cwd` is inside a bare repository that happens to contain `.pi/settings.json`
- **WHEN** `resolveConfigRoot(cwd)` is called
- **THEN** it SHALL return `null`
- **AND** it SHALL NOT return `cwd` via the non-git branch

#### Scenario: Null config root is not coerced to cwd by a consumer
- **GIVEN** `cwd` is inside a bare repository containing `.pi/settings.json`
- **AND** a server consumer looks up the config root for `cwd` to probe for declared configuration
- **WHEN** the lookup returns `null`
- **THEN** the consumer SHALL skip the probe
- **AND** it SHALL NOT probe under `cwd`

#### Scenario: Non-git dir with settings resolves to itself

- **WHEN** `cwd` is not a git repository and `cwd/.pi/settings.json` exists
- **THEN** `resolveConfigRoot(cwd)` SHALL return `cwd`

#### Scenario: Non-git dir without settings resolves to null

- **WHEN** `cwd` is not a git repository and `cwd/.pi/settings.json` does not exist
- **THEN** `resolveConfigRoot(cwd)` SHALL return `null`

#### Scenario: Git dir with unresolvable common-dir resolves to null

- **GIVEN** a cwd inside a repository for which the resolution yields a result but no main checkout (a bare repository, or a worktree of a bare hub)
- **WHEN** `resolveConfigRoot(cwd)` is called
- **THEN** it SHALL return `null`
- **AND** it SHALL NOT fall through to the non-git `cwd/.pi/settings.json` check
- **AND** init-status SHALL report `{ success: true, data: { hasHook: false } }` rather than `not_a_repo`

#### Scenario: No upward walk for non-git dir

- **GIVEN** a parent directory `P` that is not a git repository and contains `P/.pi/settings.json`
- **AND** a child directory `P/child` that is not a git repository and has no `P/child/.pi/settings.json`
- **WHEN** `resolveConfigRoot("P/child")` is called
- **THEN** it SHALL return `null` (it SHALL NOT inherit `P`'s settings)
