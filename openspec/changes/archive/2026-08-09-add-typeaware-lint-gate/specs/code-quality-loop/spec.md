## ADDED Requirements

### Requirement: Type-aware and structural rules are enabled at error severity

`biome.json` SHALL enable `nursery.noFloatingPromises`,
`nursery.noMisusedPromises`, and `suspicious.noImportCycles` at `error`
severity in the base rule set, alongside the already-enabled
`correctness.noUndeclaredDependencies`.

These rules SHALL be named individually. `linter.domains` SHALL NOT be used to
enable them as a group, because a domain grants future Biome rules
automatically on upgrade, which conflicts with a one-way ratchet in which every
graduation is a deliberate act.

`error` severity is required rather than `warn`: CI runs `biome lint .` without
`--error-on-warnings`, so a `warn`-tier rule does not gate and a regression
would land silently.

#### Scenario: The three rules are enabled in the base configuration

- **WHEN** reading `biome.json`
- **THEN** `linter.rules.nursery.noFloatingPromises` SHALL be `"error"`
- **AND** `linter.rules.nursery.noMisusedPromises` SHALL be `"error"`
- **AND** `linter.rules.suspicious.noImportCycles` SHALL be `"error"`

#### Scenario: Domains are not used to enable rule groups

- **WHEN** reading `biome.json`
- **THEN** there SHALL be no `linter.domains` block

#### Scenario: The whole-repo tree is clean under the enabled rules

- **WHEN** running `npx biome lint . --max-diagnostics=20000` at repo root
- **THEN** it SHALL report zero diagnostics in the
  `lint/nursery/noFloatingPromises`, `lint/nursery/noMisusedPromises`, and
  `lint/suspicious/noImportCycles` categories

#### Scenario: A reintroduced floating promise blocks CI

- **WHEN** a PR introduces a promise-valued call that is neither awaited,
  returned, aggregated, nor given an explicit rejection handler
- **THEN** the CI `biome lint .` step SHALL exit non-zero and block the PR

#### Scenario: A reintroduced import cycle blocks CI

- **WHEN** a PR introduces an import cycle between modules
- **THEN** the CI `biome lint .` step SHALL exit non-zero and block the PR

### Requirement: A graduation probe SHALL be proven non-vacuous before it is trusted

A zero-finding probe is evidence of a clean tree only if the rule is capable of
firing. Before a rule graduates on the strength of a zero result, the probe
SHALL be shown to report a deliberately planted violation of that rule under
the same configuration and invocation.

A zero result from a rule that cannot fire — because it is misnamed, resolved
`off` by an override, or excluded by `files.includes` — is indistinguishable
from a clean tree and SHALL NOT be accepted as a graduation criterion.

Rule identifiers SHALL be verified against the installed Biome version rather
than assumed from planning notes. A rule named under the wrong group silently
reports zero.

#### Scenario: Planted violation is reported

- **WHEN** a file containing a known violation of the candidate rule is added
  to the tree and the graduation probe is run
- **THEN** the probe SHALL report that violation

#### Scenario: A silent zero is not a graduation

- **WHEN** a probe reports zero findings and a planted violation of the same
  rule is also not reported
- **THEN** the rule SHALL NOT graduate, and the probe SHALL be treated as
  misconfigured

#### Scenario: A misnamed rule is caught

- **WHEN** a rule identifier used in a probe does not exist in the installed
  Biome version's rule set
- **THEN** the probe SHALL be corrected before its result is used, and the zero
  SHALL NOT be reported as a clean tree

### Requirement: The graduation probe uses the real configuration, not `--only`

The probe that verifies a rule at zero before graduation SHALL enable the rule
at `error` in a copy of `biome.json` and run a plain `biome lint .`. It SHALL
NOT use `--only=<rule>`, because that flag force-enables the rule and bypasses
`overrides` severity entirely, so any rule resolved by override can never
report zero under it.

`--only` MAY be used to count findings for a rule that is currently `off` and
has no override interaction, such as during triage of a candidate rule.

#### Scenario: Probe enables the rule in config

- **WHEN** verifying a candidate rule before graduation
- **THEN** the rule SHALL be set to `"error"` in the configuration used for the
  probe
- **AND** the probe invocation SHALL NOT include `--only`

#### Scenario: `--only` disagrees with the real configuration

- **WHEN** running `--only=correctness/noUndeclaredDependencies` against files
  covered by the `__tests__` override
- **THEN** findings SHALL be reported
- **AND** a plain `biome lint .` over the same files SHALL report none,
  demonstrating that `--only` is not a valid graduation oracle

### Requirement: Candidate type-aware rules are triaged on measured evidence

`nursery.useAwaitThenable`, `suspicious.noUnnecessaryConditions`,
`nursery.noBaseToString`, and `nursery.useExhaustiveSwitchCases` SHALL each be
triaged by a sampled audit of their findings before any severity is assigned.

Each rule SHALL enter at `warn` if the sampled signal holds, or remain `off`
with a recorded reason if it does not. No rule in this set SHALL enter at
`error`, because none has a zero-violation tree.

Finding counts SHALL be re-derived against the current tree at the time of
triage. Planning-time counts SHALL NOT be used as evidence, because the tree
moves under active development and rule identifiers may differ from those
assumed at planning time.

The audit's outcome per rule — the sample size, the observed false-positive
rate, and the resulting severity — SHALL be recorded in `docs/code-quality.md`.

#### Scenario: Every candidate rule has a recorded verdict

- **WHEN** the change is complete
- **THEN** `docs/code-quality.md` SHALL record, for each of the four candidate
  rules, its measured finding count, its sampled false-positive assessment, and
  its assigned severity of `warn` or `off`

#### Scenario: No candidate rule enters at error

- **WHEN** reading `biome.json` after the change
- **THEN** none of the four candidate rules SHALL be set to `"error"`

#### Scenario: A high false-positive rate keeps a rule off

- **WHEN** a sampled audit of a candidate rule shows that a material fraction of
  its findings are false positives under Biome's approximate inference
- **THEN** the rule SHALL remain `"off"`
- **AND** the reason SHALL be recorded rather than the rule silently omitted

### Requirement: The grandfathered test-file blind spot is documented

`docs/code-quality.md` SHALL state that the `__tests__` override disables
`noUndeclaredDependencies` for test files permanently, SHALL give the re-derived
count of sites the override silences, and SHALL state that test files can
therefore accumulate undeclared imports with no signal once the rule sits at
`error`.

The count SHALL be measured against the current tree at graduation time, not
carried over from planning. Planning-time figures of ~1288 silenced sites and
~1030 `vitest` sites were measured and found wrong; the actual figures are 911
silenced sites, 891 of them `from "vitest"`, against 965 whole-repo sites.

The documentation SHALL NOT present the rule as reporting a clean zero without
naming this exclusion, because a gate whose documented scope overstates its real
scope discourages further inspection.

#### Scenario: The blind spot is named in the tier ladder documentation

- **WHEN** reading `docs/code-quality.md`
- **THEN** it SHALL name the `__tests__` override as a permanent exclusion for
  `noUndeclaredDependencies`
- **AND** it SHALL state that undeclared imports in test files produce no
  diagnostic
- **AND** the silenced-site count it reports SHALL match a probe run against the
  tree at graduation time

### Requirement: A type-aware false positive is escaped by a reasoned suppression

Because Biome's type inference is approximate, an `error`-tier type-aware rule
can produce a false positive on new code and hard-stop an unattended run. The
escape hatch SHALL be a `biome-ignore` suppression carrying a non-empty reason
identifying why the finding is incorrect.

A suppression in shipped code SHALL be accompanied by a linked follow-up. The
rule SHALL NOT be downgraded to `warn` to clear a single false positive, because
that removes the gate for all code.

#### Scenario: False positive is suppressed with a reason

- **WHEN** an `error`-tier type-aware rule reports a finding that is
  demonstrably incorrect
- **THEN** the finding SHALL be cleared by a `biome-ignore` comment naming the
  rule and stating the reason
- **AND** the rule's severity in `biome.json` SHALL remain `"error"`

#### Scenario: Stale suppressions surface

- **WHEN** a suppression no longer suppresses any diagnostic
- **THEN** Biome's `suppressions/unused` diagnostic SHALL report it

### Requirement: The change flips switches and does not fix violations

This graduation SHALL operate on an already-green tree. If a pre-flip probe
reports a non-zero finding count for a candidate rule, that rule SHALL NOT be
flipped, and the finding SHALL be routed to a cleanup change rather than fixed
as part of the graduation.

Each rule SHALL be verified and flipped independently, so a non-zero probe
blocks exactly one rule rather than the whole set.

#### Scenario: A non-zero probe blocks one rule only

- **WHEN** a pre-flip probe reports findings for one candidate rule and zero for
  the others
- **THEN** the other rules SHALL still graduate
- **AND** the non-zero rule SHALL remain at its prior severity

#### Scenario: Violations are not fixed in the graduation

- **WHEN** a pre-flip probe reports a violation
- **THEN** the diff for this change SHALL NOT contain a fix for it
