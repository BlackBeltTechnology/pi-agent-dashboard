## Purpose

Defines how any cwd is resolved to its git checkout roots — the checkout it sits in, whether
it is a linked worktree, and the repository's primary working tree — so that every consumer
across the extension, server, and plugins shares one correct answer instead of re-deriving it
from a path substring.

## ADDED Requirements

### Requirement: Checkout roots are resolved as three distinct facts

The system SHALL expose a single shared resolver that, for a given `cwd`, returns:

- `thisCheckout` — the working tree containing `cwd` (`git rev-parse --show-toplevel`), or
  `null` when there is none (a bare repository).
- `isLinkedWorktree` — whether `cwd` belongs to a linked worktree.
- `mainCheckout` — the repository's primary working tree, or `null` when the repository has
  none.

These SHALL be three separate fields. A consumer SHALL select the field matching its need;
the resolver SHALL NOT collapse them into one path. `thisCheckout` and `mainCheckout` are
equal for every non-worktree state and differ for a linked worktree, which is precisely why
both are returned.

The resolver SHALL return no result (a null/absent value, not a fabricated path) when the
`cwd` is not inside a git repository or when a REQUIRED git probe fails. The required probes
are exactly `--git-dir` and `--git-common-dir`; both succeeding means the cwd IS inside a
repository. `--show-toplevel` is NOT required: it fails by design in a bare repository, and
that failure SHALL yield `thisCheckout = null` for an existing repository rather than "no
result". A bare repository SHALL therefore be distinguishable from a non-repository, because
consumers that must not fall through to a non-git code path depend on that distinction.

All probe outputs SHALL be canonicalized before use or comparison: obtained with
`--path-format=absolute`, normalized for trailing separators, and compared using the
project's platform-aware path helpers (native separators, and case-folding on Windows and
macOS). A path SHALL NOT be compared in its raw probe form.

Where this specification requires that a path not contain a `.git` segment, the test is
EXACT SEGMENT EQUALITY (a path component equal to `.git`). A checkout legitimately located at
a path whose component merely ends in `.git` — for example `/work/app.git` — SHALL NOT be
rejected by that test.

#### Scenario: Normal checkout resolves to itself

- **WHEN** the resolver runs for a cwd that is an ordinary git checkout root
- **THEN** `thisCheckout` SHALL be that checkout
- **AND** `isLinkedWorktree` SHALL be false
- **AND** `mainCheckout` SHALL equal `thisCheckout`

#### Scenario: Subdirectory resolves to its containing checkout

- **WHEN** the resolver runs for a cwd nested several levels inside a checkout
- **THEN** `thisCheckout` SHALL be the checkout root, not the cwd
- **AND** `mainCheckout` SHALL be resolved for that checkout, not for the cwd

#### Scenario: Failed probe yields no result

- **WHEN** the cwd is not inside a git repository, or a required git probe (`--git-dir` / `--git-common-dir`) fails
- **THEN** the resolver SHALL return no result
- **AND** SHALL NOT return a path derived from a partial probe

#### Scenario: Bare repository is distinguishable from a non-repository

- **GIVEN** a bare repository cwd, where `--show-toplevel` fails but `--git-dir` and `--git-common-dir` succeed
- **WHEN** the resolver runs
- **THEN** it SHALL return a result (not "no result")
- **AND** `thisCheckout` and `mainCheckout` SHALL both be `null`
- **AND** a consumer SHALL be able to distinguish this from a non-repository cwd, so it does not fall through to a non-git code path

#### Scenario: Relative and absolute probe forms do not change the classification

- **GIVEN** a normal checkout root, where `git rev-parse --git-dir` would report the relative form `.git` while `--git-common-dir` is read in absolute form
- **WHEN** the resolver runs
- **THEN** both probes SHALL be canonicalized to absolute form before comparison
- **AND** `isLinkedWorktree` SHALL be false
- **AND** the checkout SHALL NOT be misclassified as a linked worktree because the two probe outputs were expressed differently

#### Scenario: A checkout whose directory name ends in .git is not rejected

- **GIVEN** an ordinary checkout located at `/work/app.git`
- **WHEN** the resolver runs and its result is tested for a `.git` segment
- **THEN** the test SHALL compare whole path components
- **AND** `/work/app.git` SHALL NOT be treated as containing a `.git` segment

### Requirement: Linked-worktree detection uses the gitdir-vs-common-dir signal

`isLinkedWorktree` SHALL be true if and only if `git rev-parse --git-dir` and
`git rev-parse --git-common-dir` resolve to DIFFERENT paths. A linked worktree is exactly the
state in which the per-worktree git directory differs from the repository's shared common
directory.

The system SHALL NOT determine worktree identity by testing whether the common dir lies
outside `--show-toplevel`, and SHALL NOT determine it by testing whether the common dir is
named `.git`. Both are proxies that misclassify supported git configurations: the first
reports a submodule as a worktree, and the second reports a worktree of a submodule, and a
worktree of a bare repository, as non-worktrees.

#### Scenario: Linked worktree of an ordinary repository

- **GIVEN** a worktree created by `git worktree add` from a normal checkout
- **WHEN** the resolver runs for that worktree
- **THEN** `isLinkedWorktree` SHALL be true
- **AND** `thisCheckout` SHALL be the worktree's own root
- **AND** `mainCheckout` SHALL be the main checkout

#### Scenario: Submodule is not a linked worktree

- **GIVEN** a submodule checkout whose `--git-common-dir` is `<super>/.git/modules/<name>`
- **WHEN** the resolver runs for it
- **THEN** `--git-dir` and `--git-common-dir` SHALL be equal
- **AND** `isLinkedWorktree` SHALL be false
- **AND** `mainCheckout` SHALL be the submodule's own checkout
- **AND** neither `thisCheckout` nor `mainCheckout` SHALL contain a `.git` path segment

#### Scenario: Separate-git-dir checkout is not a linked worktree

- **GIVEN** a checkout created with `git init --separate-git-dir=<elsewhere>.git`
- **WHEN** the resolver runs for it
- **THEN** `isLinkedWorktree` SHALL be false
- **AND** `thisCheckout` and `mainCheckout` SHALL both be that checkout
- **AND** neither SHALL be the directory that merely contains the git dir

### Requirement: Main-checkout resolution for a linked worktree

When `isLinkedWorktree` is false, `mainCheckout` SHALL equal `thisCheckout`.

When `isLinkedWorktree` is true, `mainCheckout` SHALL be resolved from the common dir in this
order:

1. `core.worktree` configured on the common dir, resolved relative to that common dir. This
   value SHALL be read from the REPOSITORY-LOCAL configuration only — a merged read is
   forbidden. A `core.worktree` set in user, global, or system configuration SHALL NOT be
   consulted: a merged read returns such a value for every linked worktree on the machine and
   would propagate a single stray setting into every consumer of `mainCheckout`, including
   authorization and delete boundaries. The read SHALL also be issued in argv form, never by
   interpolating the common-dir path into a shell command string;
2. otherwise the parent of the common dir, when the common dir is named `.git` AND the
   repository is NOT bare. A bare hub MAY itself be named `.git` (`git init --bare
   <dir>/.git`), and its parent is then an ordinary directory holding no working tree; naming
   it would hand an authorization consumer an anchor the repository never owned. Bareness
   SHALL be read as repository-LOCAL `core.bare` on the common dir, under the same
   local-only and argv-form constraints as rule 1;
3. otherwise `null`.

The resolver SHALL return the resolved value VERBATIM and SHALL NOT judge its plausibility.
In particular, a `core.worktree` value is user-controlled and is not validated by git, so rule
1 MAY yield a path that is nonexistent, outside the repository, or inside a git directory. The
resolver SHALL NOT substitute, sanitize, or null such a value.

Validating `mainCheckout` before acting on it is the CONSUMER's obligation, and each consumer
SHALL state its own check, because the safe response differs by consumer: a display consumer
omits the field, whereas an authorization consumer must reject. A consumer SHALL NOT assume
the resolver has already excluded implausible paths.

#### Scenario: An implausible core.worktree value is returned verbatim

- **GIVEN** a linked worktree whose repository-local `core.worktree` points at a path inside a git directory, or at a nonexistent path
- **WHEN** the resolver resolves `mainCheckout`
- **THEN** it SHALL return that configured path verbatim
- **AND** it SHALL NOT substitute `null`, `thisCheckout`, or a path from a later rule
- **AND** the obligation to reject or ignore that value SHALL rest with the consumer

#### Scenario: A globally-configured core.worktree is ignored

- **GIVEN** a `core.worktree` value set in user/global configuration, and an ordinary linked worktree whose repository-local configuration does NOT set `core.worktree`
- **WHEN** the resolver resolves `mainCheckout` for that worktree
- **THEN** the global value SHALL NOT be used
- **AND** resolution SHALL proceed to the next rule (the parent of the common dir when it is named `.git`)
- **AND** a merged configuration read, which would return the global value, SHALL NOT be used

#### Scenario: Worktree of a submodule resolves to the submodule checkout

- **GIVEN** a worktree created by `git worktree add` from inside a submodule at `/super/models/sub`, whose common dir is `/super/.git/modules/models/sub`
- **WHEN** the resolver runs for that worktree
- **THEN** `isLinkedWorktree` SHALL be true
- **AND** `mainCheckout` SHALL be `/super/models/sub`, resolved via `core.worktree` on the common dir
- **AND** `mainCheckout` SHALL NOT be `/super/.git/modules/models`

#### Scenario: Worktree of a bare repository has no main checkout

- **GIVEN** a worktree created from a bare hub (`git clone --bare` then `git worktree add`), whose common dir is `<hub>.git` with no `core.worktree`
- **WHEN** the resolver runs for that worktree
- **THEN** `isLinkedWorktree` SHALL be true
- **AND** `thisCheckout` SHALL be the worktree's own root
- **AND** `mainCheckout` SHALL be `null`, because a bare repository has no working tree
- **AND** `mainCheckout` SHALL NOT be the directory containing the bare git dir

#### Scenario: Worktree of a bare hub NAMED `.git` has no main checkout

- **GIVEN** a bare repository located at `<parent>/.git`, and a worktree created from it, so the common dir is `<parent>/.git` and the basename rule alone would name `<parent>`
- **WHEN** the resolver runs for that worktree
- **THEN** `isLinkedWorktree` SHALL be true
- **AND** `mainCheckout` SHALL be `null`, because the hub is bare and `<parent>` holds no working tree
- **AND** `mainCheckout` SHALL NOT be `<parent>`, which an authorization consumer could otherwise match against its known-folder set

#### Scenario: Bare repository cwd

- **WHEN** the resolver runs for a bare repository directory itself
- **THEN** `thisCheckout` SHALL be `null`
- **AND** `mainCheckout` SHALL be `null`

### Requirement: Persisted implausible worktree paths are repaired on load

A previously persisted worktree main path MAY have been written by the superseded
`dirname(--git-common-dir)` derivation and can therefore name a directory that is not a
checkout. Because a session that has ended never re-probes, and persisted session metadata is
re-seeded into memory at every startup, such a value SHALL NOT be assumed to expire on its
own.

This repair is a BEST-EFFORT SHAPE TEST, not an identity check, and the specification claims
no more than that. A phantom path is indistinguishable from a legitimate one whenever it
happens to land on a directory that is itself a working tree — for example a bare hub at
`$HOME/bare.git`, whose phantom is `$HOME`, when `$HOME` is itself a git checkout (a dotfiles
repository). Such a record SHALL survive the filter. Repairing it would require re-probing
git for every persisted session at startup, which is a cost this requirement deliberately
does not impose; live sessions still converge via the present→absent path.

On load, the system SHALL drop a persisted worktree record whose main path is not a plausible
working tree. A path is plausible only when ALL of the following hold: it is statable on disk,
it contains no `.git` path segment (exact-segment test), and it directly contains a `.git`
entry (file or directory) of its own.

A record SHALL be dropped on ANY stat failure, not only on a not-found result. The accepted
consequence is that a legitimate main checkout residing on a currently-unreachable volume (an
unmounted network share, a detached drive) is dropped, and because an ended session never
re-probes its grouping is not restored when the volume returns. This is accepted in exchange
for a single unambiguous rule.

The third condition is required and is not redundant: the phantom paths produced for a
`--separate-git-dir` or bare repository are REAL, EXISTING directories with no `.git` segment
— an unrelated parent directory such as `/tmp`. Existence alone therefore cannot distinguish
them from a genuine checkout, and a filter without this condition would preserve exactly the
states that are hardest to notice. A genuine working tree always carries its own `.git` entry
(a directory in a normal checkout, a file in a submodule or linked worktree).

A dropped record SHALL degrade that session to grouping by its own cwd. The system SHALL NOT
rewrite the persisted metadata files to achieve this.

#### Scenario: Phantom submodule path is dropped on load

- **GIVEN** persisted session metadata carrying `gitWorktree.mainPath = "/super/.git/modules/models"`
- **WHEN** the session is loaded at startup
- **THEN** the worktree record SHALL be dropped
- **AND** the session SHALL group by its own cwd
- **AND** the persisted metadata file SHALL NOT be rewritten as part of the load

#### Scenario: Nonexistent main path is dropped on load

- **GIVEN** persisted metadata whose `gitWorktree.mainPath` no longer exists on disk
- **WHEN** the session is loaded
- **THEN** the worktree record SHALL be dropped

#### Scenario: Unreachable volume is dropped like a missing path

- **GIVEN** persisted metadata whose `gitWorktree.mainPath` is a legitimate checkout on a volume that is currently unmounted, so the stat fails with an error other than not-found
- **WHEN** the session is loaded
- **THEN** the record SHALL be dropped
- **AND** the load SHALL NOT fail or throw for that session
- **AND** the record SHALL NOT be restored automatically when the volume returns, for a session that has ended

#### Scenario: Phantom path to a real unrelated directory is dropped on load

- **GIVEN** persisted metadata carrying `gitWorktree.mainPath = "/tmp"`, produced by the superseded derivation for a `--separate-git-dir` or bare repository — an existing directory, with no `.git` segment, that is not a checkout
- **WHEN** the session is loaded at startup
- **THEN** the record SHALL be dropped, because `/tmp` contains no `.git` entry of its own
- **AND** existence alone SHALL NOT qualify a path as plausible

#### Scenario: Valid worktree record survives load

- **GIVEN** persisted metadata whose `gitWorktree.mainPath` is an existing directory, with no `.git` path segment, that directly contains a `.git` entry
- **WHEN** the session is loaded
- **THEN** the record SHALL be preserved unchanged

#### Scenario: A phantom that lands on a real checkout is not repairable by shape

- **GIVEN** a bare hub at `$HOME/bare.git` whose superseded derivation produced the phantom `mainPath = $HOME`
- **AND** `$HOME` is itself a git checkout, so it exists, has no `.git` path segment, and contains a `.git` entry
- **WHEN** the session is loaded
- **THEN** the record SHALL survive the filter, because the filter tests shape and not identity
- **AND** this SHALL be treated as a known limitation rather than a filter defect
