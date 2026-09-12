## MODIFIED Requirements

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

## ADDED Requirements

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
