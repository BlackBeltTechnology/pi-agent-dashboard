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

The resolver SHALL additionally be available in a CLASSIFIED asynchronous form that
distinguishes three outcomes: a result, no result because the cwd is definitively not in
a repository (every needed probe completed, a probe exited non-zero), and FAILED because
a needed probe did not complete (timeout, spawn failure, missing binary, oversized output).
In the classified form, a failed probe at ANY step SHALL yield FAILED — it SHALL NOT be read
as an unset value and SHALL NOT fall through to a later derivation rule (e.g. a failed
`core.worktree` read SHALL NOT fall through to the common-dir-parent rule). The unclassified
forms SHALL keep returning no result for both definitive absence and failure, so existing
consumers are unchanged. The repository-binding check SHALL have a classified twin with the
outcomes bound, unbound, and failed.

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

#### Scenario: Classified form reports a timed-out probe as failed
- **WHEN** the classified resolver runs and the `--git-common-dir` probe times out
- **THEN** it SHALL return FAILED, not no-result
- **AND** the unclassified resolver, under the same probe outcome, SHALL return no result

#### Scenario: Failed core.worktree probe does not fall through
- **GIVEN** a linked worktree whose `core.worktree` read times out and whose common-dir parent is a real directory
- **WHEN** the classified resolver runs
- **THEN** it SHALL return FAILED
- **AND** SHALL NOT return the common-dir parent as `mainCheckout`

#### Scenario: Definitive non-repository is not failed
- **WHEN** the classified resolver runs for a directory outside any repository and `--git-dir` exits non-zero
- **THEN** it SHALL return no result, not FAILED
