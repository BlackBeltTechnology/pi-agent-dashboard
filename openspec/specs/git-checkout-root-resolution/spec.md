# git-checkout-root-resolution Specification

## Purpose
Defines how any cwd is resolved to its git checkout roots — the checkout it sits in, whether
it is a linked worktree, and the repository's primary working tree — so that every consumer
across the extension, server, and plugins shares one correct answer instead of re-deriving it
from a path substring.

## Requirements

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

The result SHALL additionally carry `commonDir` — the canonical absolute
`--git-common-dir` of `cwd`. `commonDir` is the repository's IDENTITY, not a
checkout anchor: it names a git directory and SHALL NOT be used as a trust
anchor, containment root, or admission path. It exists so that a consumer can
apply the repository-binding check below to `thisCheckout` / `mainCheckout`
without re-probing the cwd.

The resolver SHALL return no result (a null/absent value, not a fabricated path) when the
`cwd` is not inside a git repository or when a REQUIRED git probe fails. The required probes
are exactly `--git-dir` and `--git-common-dir`; both succeeding means the cwd IS inside a
repository. Both probes SHALL be issued with `--path-format=absolute`, which REQUIRES git >= 2.31.0; below that floor both probes fail, resolution yields no result, and every consumer SHALL degrade to its no-result branch (omit the field / reject admission) rather than to a derived path. `--show-toplevel` is NOT required: it fails by design in a bare repository, and
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

The resolver SHALL be available in both a synchronous form and an asynchronous
form over the SAME resolution logic, so a consumer on an event-loop-sensitive
request path can resolve without blocking, and the two forms cannot drift in
classification.

#### Scenario: Normal checkout resolves to itself

- **WHEN** the resolver runs for a cwd that is an ordinary git checkout root
- **THEN** `thisCheckout` SHALL be that checkout
- **AND** `isLinkedWorktree` SHALL be false
- **AND** `mainCheckout` SHALL equal `thisCheckout`
- **AND** `commonDir` SHALL be that checkout's `.git` directory

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

#### Scenario: Mixed probe forms do not change the classification

This scenario guards the PROBE WIRING, not a state the canonical wiring can reach: with
`--path-format=absolute` required on both probes, mixed forms cannot occur in production. It
SHALL therefore be verified with INJECTED probes, which is the only way to observe a
mis-wiring in which one side dropped the flag.

- **GIVEN** injected probes for a normal checkout root, where `--git-dir` reports the relative form `.git` while `--git-common-dir` reports an absolute path
- **WHEN** the resolver runs
- **THEN** the classification SHALL rest on canonical absolute forms, not on the raw probe strings
- **AND** the checkout SHALL NOT be misclassified as a linked worktree merely because the two probe outputs were expressed differently
- **AND** the production wiring SHALL keep `--path-format=absolute` on BOTH probes, so this case never arises outside the injected-probe test

#### Scenario: A checkout whose directory name ends in .git is not rejected

- **GIVEN** an ordinary checkout located at `/work/app.git`
- **WHEN** the resolver runs and its result is tested for a `.git` segment
- **THEN** the test SHALL compare whole path components
- **AND** `/work/app.git` SHALL NOT be treated as containing a `.git` segment

#### Scenario: Synchronous and asynchronous forms agree

- **GIVEN** any of the nine fixture git states (normal, subdirectory, linked worktree, submodule, worktree of a submodule, bare, worktree of a bare hub, separate-git-dir, `.git`-named checkout) and a non-repository directory
- **WHEN** both the synchronous and the asynchronous resolver run for the same cwd
- **THEN** they SHALL return identical results

#### Scenario: Synchronous and asynchronous forms agree on a degraded probe

- **GIVEN** injected probes in which `--show-toplevel` fails, and separately in which the `core.bare` probe fails
- **WHEN** both forms run over the same injected probes
- **THEN** both SHALL return identical results, with the bareness mapped to `"unknown"` (never `"not-bare"`) in both forms

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
   repository is CONFIRMED not bare. A bare hub MAY itself be named `.git` (`git init --bare
   <dir>/.git`), and its parent is then an ordinary directory holding no working tree; naming
   it would hand an authorization consumer an anchor the repository never owned. Bareness
   SHALL be read as repository-LOCAL `core.bare` on the common dir, under the same
   local-only and argv-form constraints as rule 1, and SHALL be read as a GIT BOOLEAN
   (`--type=bool`) so that `yes`, `on` and `1` are recognized as true — a raw text
   comparison against the literal `true` SHALL NOT be used. The probe is THREE-valued:
   answered-bare, answered-not-bare, and UNANSWERABLE (spawn failure or timeout). An
   unanswerable probe SHALL NOT be treated as not-bare, and SHALL fall through to rule 3; an
   UNSET key is answered-not-bare, that being git's own boolean default;
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

#### Scenario: An unanswerable bareness probe does not take the parent fallback

- **GIVEN** a linked worktree whose common dir is named `.git`, and a `core.bare` probe that fails or times out
- **WHEN** the resolver resolves `mainCheckout`
- **THEN** `mainCheckout` SHALL be `null`
- **AND** the parent of the common dir SHALL NOT be used, because an unread probe is not evidence of a non-bare repository

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

### Requirement: Repository binding of a resolved checkout

Because `mainCheckout` (and, under a repository-local `core.worktree`, `thisCheckout`) can
be a user-controlled path the resolver returns verbatim, the system SHALL expose a shared
repository-binding check that an authorization or containment consumer applies BEFORE
using a resolved checkout as a trust anchor. A candidate path is BOUND to the repository of
`cwd` only when ALL of the following hold:

1. it contains no `.git` path segment (exact-segment test);
2. resolving the candidate itself as a cwd yields a result whose `commonDir` is the same
   path as the `commonDir` resolved for the original `cwd`;
3. that result's `thisCheckout` is the same path as the candidate — the candidate is a
   checkout ROOT of that repository, not a subdirectory of one;
4. the candidate is NOT the repository's `commonDir` and NOT under it — a git-internal
   path is never a checkout root.

Rule 4 SHALL NOT be folded into rule 3. With a repository-local `core.worktree` aimed at a
path inside the git dir, git honors that value on re-resolution and DOES report the path as
its own `--show-toplevel`, so rule 3 PASSES there; the rule-1 `.git`-segment test is the
first line of defence and rule 4 is the second, which is what keeps the rejection true even
when rule 1 is bypassed. Rule 4 is also load-bearing for a git dir NOT named `.git`: a
`--separate-git-dir` checkout whose `core.worktree` aims into `<elsewhere>/app.git/x` passes
rules 1-3, and only rule 4 rejects it.

The candidate SHALL be canonicalized (symlinks followed) BEFORE it is re-resolved and
before every comparison, and comparisons SHALL use the platform-aware path helpers. A
candidate that is nonexistent, not inside any repository, inside a different repository,
or inside a git directory SHALL be reported as unbound. The check SHALL fail closed: any
probe failure or timeout while re-resolving the candidate SHALL report it as unbound. The
check SHALL accept a per-probe timeout so a synchronous consumer can hold its own
worst-case budget; re-resolving a candidate costs up to five probes.

A bound candidate is, by rule 3, exactly what git reports as a checkout root for that
path. The check therefore never yields an anchor WIDER than a git-reported toplevel; it
may yield one narrower (see the subdirectory scenario).

Both consumers that anchor trust on a resolved checkout — file-read containment and the
kb-plugin cwd guard — SHALL use this one check, so they cannot diverge on what "the
repository owns this path" means.

#### Scenario: Honest main checkout is bound

- **GIVEN** a linked worktree of an ordinary repository, with no `core.worktree` configured
- **WHEN** the binding check runs for its resolved `mainCheckout`
- **THEN** the candidate SHALL be reported as bound, because it re-resolves to the same common dir and is its own checkout root

#### Scenario: Worktree of a submodule binds to the submodule checkout

- **GIVEN** a worktree created from inside a submodule, whose `mainCheckout` resolves via `core.worktree` to the submodule checkout
- **WHEN** the binding check runs for that `mainCheckout`
- **THEN** it SHALL be reported as bound, because the submodule checkout shares the worktree's common dir

#### Scenario: core.worktree aimed at an unrelated repository is unbound

- **GIVEN** a linked worktree whose repository-local `core.worktree` names the checkout root of a DIFFERENT repository
- **WHEN** the binding check runs for the resolved `mainCheckout`
- **THEN** it SHALL be reported as unbound, because that path resolves to a different common dir

#### Scenario: core.worktree aimed outside any repository is unbound

- **GIVEN** a repository whose repository-local `core.worktree` names a directory that is not inside any repository (for example the filesystem root or a temp directory), or a nonexistent path
- **WHEN** the binding check runs for the resolved checkout
- **THEN** it SHALL be reported as unbound

#### Scenario: core.worktree aimed inside a git directory is unbound

- **GIVEN** a linked worktree whose repository-local `core.worktree` names a path inside the repository's own git directory
- **WHEN** the binding check runs for the resolved `mainCheckout`
- **THEN** it SHALL be reported as unbound by the `.git`-segment test
- **AND** SHALL remain unbound even if that test were skipped, because the candidate is under the repository's own common dir (rule 4) — MEASURED: git reports the configured path as its own toplevel, so rule 3 alone does NOT reject it

#### Scenario: A subdirectory of the true checkout never widens past that checkout

- **GIVEN** a repository-local `core.worktree` naming a strict subdirectory of the repository's real main checkout
- **WHEN** the binding check runs for the resolved checkout
- **THEN** the outcome SHALL be MEASURED, not assumed: git may honor the same `core.worktree` on re-resolution and report the subdirectory as its own toplevel
- **AND** if reported unbound, the candidate SHALL be dropped
- **AND** if reported bound, the anchor SHALL be the subdirectory itself, so reach is strictly narrower than the real main checkout
- **AND** in neither case SHALL any path outside the real main checkout become reachable

#### Scenario: A sibling linked worktree of the same repository is bound

- **GIVEN** a repository-local `core.worktree` naming another linked worktree of the SAME repository
- **WHEN** the binding check runs for that candidate
- **THEN** it SHALL be reported as bound, because the repository owns that worktree
