# code-quality-loop Specification

## Purpose
TBD - created by archiving change add-code-quality-skill. Update Purpose after archive.
## Requirements
### Requirement: Biome-backed static analysis configuration

The project SHALL provide a single `biome.json` that configures Biome for the
monorepo. The formatter SHALL be disabled by default; when enabled it SHALL use
space indentation. VCS integration SHALL be enabled with `clientKind: git`,
`useIgnoreFile: true`, and `defaultBranch: develop` (the repo's integration
branch; there is no `main`). The config SHALL ignore build
output (`dist/`, `**/dist/`, `*.tsbuildinfo`), generated plugin-registry output,
and `openspec/changes/archive/**`. Rules SHALL be organized into tiers (high-signal
Tier A, noisy-but-valuable Tier B, style/complexity Tier C), with accessibility
rules scoped to `packages/client/**`.

The `correctness` tier SHALL enable `noUndeclaredDependencies` at `error`
severity in the base rule set, not leave it to an ad-hoc `--only` probe. This is
load-bearing: Biome's `--only=<rule>` flag force-enables the named rule and
**bypasses `overrides` severity entirely**, so a rule resolved by override can
never reach zero under `--only`. Only `files.includes` exclusions survive that
flag. Because this change resolves test files and build/config entry points by
override, the rule MUST be enabled in the base config and verified with a plain
`biome lint .` invocation.

Overrides SHALL exist for `__tests__/**` (matching `**/__tests__/**`,
`**/*.test.ts`, `**/*.test.tsx`) and for build/config entry points. The previously
specified overrides for `packages/server/**` and `scripts/**` SHALL NOT be
asserted, because they do not exist in `biome.json`; this corrects a
long-standing divergence between this specification and the configuration.

The build/config override SHALL be derived from probe output rather than from an
assumed filename pattern. A glob set limited to `**/vitest.config.ts`,
`**/vite.config.ts`, and `**/forge.config.ts` is insufficient: it does not match
`packages/electron/vite.main.config.ts`, `packages/electron/vite.preload.config.ts`,
`packages/client/scripts/vite-build.mjs`, or
`packages/electron/scripts/download-git-windows.mjs`, all of which are build-time
files that are never published.

The build/config override SHALL NOT match any file under a `src/` directory.
Verifying that the override reduces a rule's finding count to zero proves
coverage but cannot detect an over-broad glob, because a wrongly-matched source
file also reports zero.

#### Scenario: Lint respects ignores

- **WHEN** `biome lint .` runs
- **THEN** it SHALL NOT report diagnostics for files under `dist/`, `**/dist/`, or `openspec/changes/archive/**`.

#### Scenario: Formatter does not reformat the tree

- **WHEN** `biome check --changed --write` runs in Phase 0
- **THEN** it SHALL NOT reformat files, because the formatter is disabled.

#### Scenario: The build/config override matches no source file

- **WHEN** enumerating every file matched by the build/config override block
- **THEN** none of them SHALL lie under any `src/` directory

#### Scenario: The build/config override covers non-obvious build entry points

- **WHEN** the override is applied
- **THEN** it SHALL match `packages/electron/vite.main.config.ts`, `packages/electron/vite.preload.config.ts`, `packages/client/scripts/vite-build.mjs`, and `packages/electron/scripts/download-git-windows.mjs`

#### Scenario: Specification matches configuration for overrides

- **WHEN** comparing this specification's asserted override set against `biome.json`
- **THEN** every override this specification asserts SHALL exist in `biome.json`

### Requirement: Severity-driven scope behavior

The configuration SHALL rely on Biome severity to separate soft from hard gating.
`warn`-severity rules SHALL NOT cause a non-zero exit unless `--error-on-warnings`
is passed; `error`-severity rules SHALL always cause a non-zero exit. A single
`biome.json` SHALL serve the changed-files, whole-repo-CI, and explicit-cleanup
scopes by varying only the invocation flags.

#### Scenario: CI soft warn

- **WHEN** CI runs `biome lint .` and the only violations are warn-tier
- **THEN** the command SHALL exit 0 and the violations SHALL appear as annotations, not failures.

#### Scenario: Goal-loop hard gate on changed files

- **WHEN** the goal loop runs `biome check --changed --error-on-warnings` and a changed file has a warn-tier violation
- **THEN** the command SHALL exit non-zero, signalling the judge to continue.

### Requirement: Deterministic quality oracle script

The project SHALL provide a `quality:changed` npm script that runs
`biome check --changed --error-on-warnings --write`, then `tsc --noEmit`, then
`npm test`, and exits with the first non-zero status. The existing `lint`
(`tsc --noEmit`) script SHALL remain unchanged. The project SHALL also provide
`lint:biome`, `fix:changed`, and `quality:report` scripts.

#### Scenario: Oracle passes on clean diff

- **WHEN** `quality:changed` runs and changed files are Biome-clean, types compile, and tests pass
- **THEN** it SHALL exit 0.

#### Scenario: Oracle fails on dirty diff

- **WHEN** `quality:changed` runs and a changed file has an unfixable warn-tier or error-tier violation, or a type error, or a failing test
- **THEN** it SHALL exit non-zero.

### Requirement: Code-quality skill with analyze-fix-test procedure

The project SHALL provide a `.pi/skills/code-quality/SKILL.md` skill describing
an analyze → fix → test procedure with two modes: a changed-files mode for the
goal loop and a whole-repo mode for explicit cleanup. The skill SHALL encode the
guardrails: changed-files scope by default, a test gate (`tsc --noEmit` + `npm test`)
after every fix batch with revert-on-red, safe fixes auto-applied while unsafe and
manual fixes are surfaced as a report, and no edits to files outside the diff. The
skill SHALL provide the goal-text templates a judge model consumes.

#### Scenario: Skill drives the goal loop

- **WHEN** a user sets a goal using the skill's daily-driver template
- **THEN** the agent SHALL run `quality:changed`, fix reported issues on changed files only, and the judge SHALL mark the goal achieved once the script exits 0.

#### Scenario: Skill forbids scope creep

- **WHEN** the agent fixes issues under the skill
- **THEN** it SHALL NOT modify files outside the current diff and SHALL revert a fix batch if the test gate goes red.

### Requirement: Ratchet graduation and CI integration

Rules SHALL progress one-way through severities (`off → warn → error`). A rule
SHALL graduate from `warn` to `error` only after a probe reports zero violations
outside grandfathered overrides. That probe SHALL set the rule to `"error"` in a
copy of `biome.json` and run a plain `biome lint .`; it SHALL NOT use
`--only=<rule>`, which force-enables the rule and bypasses `overrides` severity
(see "The graduation probe uses the real configuration, not `--only`"). CI SHALL run
`biome lint .` after the existing `tsc` lint step so that error-tier rules gate
regressions while warn-tier rules annotate without failing the build.

Site counts used to plan or verify a graduation SHALL be taken from Biome's own
reported diagnostic total. When sites are enumerated by extracting locations
from Biome output, the extraction SHALL cover every file extension Biome lints —
including `.cjs`, `.mjs`, and `.cts` — and the extracted count SHALL be
reconciled against Biome's reported total. A discrepancy SHALL be resolved by
finding the missing site, and SHALL NOT be explained away as a duplicate
diagnostic.

#### Scenario: Tier A regression blocked after graduation

- **WHEN** a Tier A rule has graduated to `error` and a PR reintroduces a violation of it
- **THEN** the CI Biome step SHALL exit non-zero and block the PR.

#### Scenario: Extraction undercount is caught

- **WHEN** an enumeration of diagnostic sites yields fewer sites than Biome's reported diagnostic total
- **THEN** the discrepancy SHALL be resolved by locating the missing site
- **AND** the enumeration SHALL NOT be reconciled by assuming a duplicate diagnostic

### Requirement: Undeclared-dependency findings reach zero at repo-root scope

`noUndeclaredDependencies` SHALL report zero findings when run at repo-root
scope, which is the scope CI uses and the scope the ratchet's graduation
criterion evaluates.

The oracle SHALL be a plain `npx biome lint . --max-diagnostics=20000`, filtered
to the `lint/correctness/noUndeclaredDependencies` category, with the rule
enabled at `error` in the base config. The oracle SHALL NOT be an
`--only=correctness/noUndeclaredDependencies` probe, because that flag bypasses
`overrides` and would report findings for every file this change deliberately
resolves by override.

Repo-root scope is load-bearing and distinct from `packages/` scope: `biome lint .`
additionally reaches root `scripts/`, `examples/`, `tests/e2e/`, `qa/scripts/`,
`.pi/skills/**/scripts/`, `.pi/flows/**`, and `openspec/changes/**/spike/`.
Measuring `packages/` alone understates the finding count.

Findings SHALL be resolved by declaration wherever the importing file is
published, and by override or ignore only where the importing file is never
published. No finding in shipped code SHALL be resolved by suppression.

#### Scenario: Repo-root probe reports zero

- **WHEN** running `npx biome lint . --max-diagnostics=20000` at repo root
- **THEN** it SHALL report zero diagnostics in the `lint/correctness/noUndeclaredDependencies` category

#### Scenario: The rule is enabled in the base configuration

- **WHEN** reading `biome.json`
- **THEN** `linter.rules.correctness.noUndeclaredDependencies` SHALL be `"error"`

#### Scenario: An `--only` probe is not a valid oracle for an override-resolved rule

- **WHEN** running `npx biome lint --only=correctness/noUndeclaredDependencies` against a file covered by a build/config override that disables the rule
- **THEN** the finding SHALL still be reported, demonstrating that `--only` bypasses override severity
- **AND** the same file under a plain `biome lint` invocation SHALL report no finding

#### Scenario: Root tooling dependencies are declared as devDependencies

- **WHEN** a script under root `scripts/` imports a package, and that script is not listed in the root `package.json` `files` array
- **THEN** the package SHALL be declared in the root `devDependencies`
- **AND** it SHALL NOT be declared in the root `dependencies`, because the root is itself a published metapackage and would otherwise ship the dependency to consumers that never receive the script

#### Scenario: Non-published trees are ignored, not declared

- **WHEN** a finding originates in `examples/`, `openspec/changes/**/spike/`, `.pi/flows/**`, `tests/e2e/`, `qa/scripts/`, or `.pi/skills/**/scripts/`
- **THEN** it SHALL be resolved by a Biome ignore or override rather than by adding a dependency declaration

### Requirement: Declared ranges are satisfied by the resolving version

When a dependency declaration is added, its range SHALL be satisfied by the
version that currently resolves in the workspace.

Where the same dependency is already declared elsewhere in the repository, that
range SHALL be reused **only if** the resolving version satisfies it. Where an
existing range is not satisfied by the resolving version, the existing range
SHALL NOT be propagated; a range based on the resolving version SHALL be used
instead.

Where sibling workspaces declare different ranges that the resolving version all
satisfy, the range with the **highest lower bound** SHALL be used. Semver range
comparison is not a total order, so "narrowest" is defined concretely as
greatest-minimum: given `>=3.0.0`, `^3.0.0`, and `^3.9.0` with `3.10.0`
resolving, `^3.9.0` wins.

#### Scenario: Reused range must be satisfied

- **WHEN** adding a declaration for a dependency already declared elsewhere in the repository
- **THEN** the reused range SHALL be satisfied by the version resolving in `node_modules`

#### Scenario: Unsatisfiable existing ranges are not propagated

- **WHEN** an existing declaration's range is not satisfied by the resolving version
- **THEN** that range SHALL NOT be copied into the new declaration

#### Scenario: Highest lower bound wins among disagreeing siblings

- **WHEN** sibling workspaces declare several ranges for one dependency and the resolving version satisfies more than one
- **THEN** the range with the greatest lower bound SHALL be chosen

#### Scenario: wouter resolves to the highest-minimum sibling range

- **WHEN** declaring `wouter` for `packages/automation-plugin`, given siblings declaring `>=3.0.0`, `^3.0.0`, and `^3.9.0`, with `3.10.0` resolving
- **THEN** the declared range SHALL be `^3.9.0`

### Requirement: Global unhandled-rejection observability

The client bundle and the Electron main process SHALL each install a global
unhandled-rejection handler at startup, before any application work begins. The
handler SHALL report the rejection through the package's existing logging path
and SHALL NOT suppress, swallow, or rate-limit it into silence.

This makes an escaped rejection an observable event rather than a silent drop,
which is the precondition for asserting anything falsifiable about promise
handling.

#### Scenario: Escaped rejection in the client is observable

- **WHEN** a promise rejects in the client bundle with no local handler attached
- **THEN** the global handler SHALL fire and report the rejection through the existing logging path
- **AND** the rejection SHALL be observable to an automated test as an `unhandledrejection` event

#### Scenario: Escaped rejection in Electron main is observable

- **WHEN** a promise rejects in the Electron main process with no local handler attached
- **THEN** the `process.on("unhandledRejection", …)` handler SHALL fire and report it through the existing logging path

#### Scenario: The handler does not swallow

- **WHEN** the global handler processes a rejection
- **THEN** it SHALL emit a record identifying the rejection reason
- **AND** it SHALL NOT terminate the reporting path silently or replace the reason with a generic placeholder

### Requirement: Promise discards state their handling

A discarded promise SHALL NOT be written as a bare `void <promise>`. Every
promise-valued expression whose result is not awaited, returned, or aggregated
SHALL attach an explicit rejection handler, written as `void <promise>.catch(<handler>)`.

Every such handler SHALL have a non-empty body that routes to the package's
existing logging path. An empty handler (`.catch(() => {})`) satisfies the
linter while preserving the defect and is therefore prohibited.

A global unhandled-rejection handler is a safety net, not a substitute for this
requirement: the net records that a rejection escaped but cannot record whether
the author considered it.

#### Scenario: Bare void discard is rejected in review

- **WHEN** a change introduces `void somePromise()` with no attached rejection handler
- **THEN** the change SHALL be treated as not satisfying this requirement

#### Scenario: Empty catch handler is rejected

- **WHEN** a change introduces `.catch(() => {})` or an equivalently empty handler body
- **THEN** the change SHALL be treated as not satisfying this requirement, even though the lint diagnostic is cleared

#### Scenario: Compliant discard

- **WHEN** a fire-and-forget call is genuinely correct
- **THEN** it SHALL be written `void p.catch(<handler>)` where the handler reports through the existing logging path

### Requirement: Every lint diagnostic site has exactly one owning change

For a rule progressing through the ratchet, every diagnostic site reported by
`biome lint .` at repository root SHALL be claimed by exactly one change. The
per-change claimed counts SHALL sum to the repo-root total, with no site claimed
twice and no site left unclaimed.

A change that hands sites to a sibling SHALL record the handoff in the
receiving change's own artifacts. A handoff described only in the sending
change's documents leaves the sites unowned and SHALL be treated as incomplete.

#### Scenario: Ledger sums to the repo-root total

- **WHEN** the claimed site counts for a rule are summed across all changes that claim it
- **THEN** the sum SHALL equal the count reported by `biome lint .` at repository root

#### Scenario: Handoff not recorded by the receiver

- **WHEN** change A states that sites move to change B, but change B's artifacts do not claim them
- **THEN** those sites SHALL be treated as unclaimed and the rule SHALL NOT be eligible for graduation

### Requirement: An import cycle is broken only by removing an edge

For the `suspicious/noImportCycles` rule, a cycle SHALL be considered broken only
when a static import edge is genuinely removed from the graph — by extracting the
shared value into a third module, inverting the dependency, or merging two modules
that are one unit.

Converting a static import to a dynamic `import()` (including `React.lazy`) SHALL
NOT be treated as breaking a cycle. Biome traverses dynamic import edges: the rule
skips only `node_modules` and `JsImportPhase::Type`, and a dynamic specifier is
registered as `JsImportPhase::Default`, so the `ignoreTypes` filter cannot skip it.
A `lazy()` edge therefore still closes the cycle and still reports a diagnostic.

This is recorded because the technique is superficially convincing — a lazy import
defers *evaluation*, which is the intuition the rule appears to encode — and
because two independent designs for this rule's cleanup selected it before the
mechanism was checked. A code-split may still be desirable on its own merits; it is
simply not a cycle fix.

Type-only edges ARE ignored, so a cycle composed entirely of `import type` edges
produces no diagnostic and is out of scope for the ratchet.

#### Scenario: Dynamic import does not clear the diagnostic

- **WHEN** a two-module cycle is closed by `() => import("./b.js")` rather than a static import
- **THEN** `biome lint --only=lint/suspicious/noImportCycles` SHALL still report the cycle
- **AND** the change SHALL be treated as not having broken that cycle

#### Scenario: Edge removal clears the diagnostic

- **WHEN** the value that closes a cycle is extracted into a third module that both former participants import
- **THEN** every diagnostic belonging to that cycle SHALL clear
- **AND** the reported count SHALL drop by the number of edges the cycle contained

#### Scenario: Type-only cycle is not claimed

- **WHEN** a cycle consists solely of `import type` edges
- **THEN** the rule SHALL report no diagnostic for it
- **AND** it SHALL NOT be counted against the rule's graduation

### Requirement: A cycle fix preserves import-time evaluation semantics

Breaking a cycle changes module evaluation order. A change that removes a cycle
edge SHALL establish, before editing, whether any module in the affected cycle
reads an imported binding from another module in that same cycle **at import
time** — that is, at module scope rather than inside a function, component, or
hook body.

The relevant property is this cross-edge import-time read, NOT the mere presence
of module-scope side effects. Module-scope work that closes only over literals or
external packages (a `createContext(null)`, a `new Set([...])` of constants) is
not order-sensitive across a cycle edge and SHALL NOT by itself require a
test-first obligation.

Where a cross-edge import-time read does exist, the change SHALL characterise the
existing behaviour with a test before altering the edge, because reordering is
observable only in that case.

A cycle fix SHALL be verified against a production bundle build, not `tsc --noEmit`
or the unit-test entry point alone: neither fails on a cycle, and neither exercises
the production module-evaluation order in which such a defect surfaces.

#### Scenario: Cross-edge import-time read is characterised first

- **WHEN** a module in a cycle reads a binding imported from another module in the same cycle at module scope
- **THEN** the change SHALL add a test capturing the current behaviour before the edge is altered

#### Scenario: Order-insensitive module-scope work needs no test-first step

- **WHEN** the only module-scope work in a cycle closes over literals or external packages
- **THEN** the change SHALL record that no cross-edge import-time read exists
- **AND** it SHALL NOT be required to add a per-module characterisation test on that basis

#### Scenario: Bundle build is part of the oracle

- **WHEN** a change removes one or more import-cycle edges
- **THEN** verification SHALL include a production bundle build that exits zero
- **AND** `tsc --noEmit` passing alone SHALL NOT be accepted as evidence the fix is safe

### Requirement: This change claims every `noImportCycles` site

Per the site-ownership ledger, this change SHALL claim all 17 `noImportCycles`
diagnostics reported by `biome lint .` at repository root, leaving none for a
sibling change. The 17 diagnostics are edges — the rule emits one per participating
import, not one per cycle — and they decompose into four disjoint strongly-connected
components:

| SCC | Package | Modules | Diagnostics |
|---|---|---|---|
| editor-pane/diff | `packages/client` | 5 | 5 |
| preview/tool-renderers | `packages/client` | 6 | 8 |
| flows-plugin agent card/detail | `packages/flows-plugin` | 2 | 2 |
| server auth/tunnel | `packages/server` | 2 | 2 |

Because this change claims the full repo-root total, `noImportCycles` becomes
eligible for `warn → error` graduation on its completion, with no handoff to record.

#### Scenario: Claimed count equals the repo-root total

- **WHEN** the sites claimed by this change are counted
- **THEN** the total SHALL equal the 17 diagnostics reported by `biome lint .` at repository root
- **AND** no `noImportCycles` site SHALL remain unclaimed by any change

#### Scenario: Completion leaves the rule at zero

- **WHEN** this change is complete
- **THEN** `biome lint --only=lint/suspicious/noImportCycles . --max-diagnostics=20000` SHALL report zero warnings
- **AND** a reduced-but-nonzero count SHALL be treated as incomplete, not as partial progress

#### Scenario: Per-cut count movement is verified

- **WHEN** an individual cycle fix within this change is applied
- **THEN** the reported diagnostic count SHALL drop by that cycle's edge count
- **AND** a cut whose count movement differs from its prediction SHALL be re-diagnosed rather than followed by a further cut

### Requirement: A performance oracle must exercise the code it claims to cover

When a change cites an existing performance or load harness as evidence that a
modification did not regress behaviour, it SHALL first verify that the harness
actually executes the modified code paths. The claim SHALL name the specific
sites the harness exercises, not the files or subsystems they belong to.

A harness that does not execute a site cannot fail because of that site, so
citing it as coverage for that site is false assurance. Where a modified site is
genuinely performance-sensitive and the harness does not reach it, the change
SHALL either extend the harness to exercise that path or state plainly that no
automated oracle covers the site.

File-level coverage claims SHALL NOT be used as a proxy for site-level coverage.

#### Scenario: Harness cited for a path it never executes

- **WHEN** a change cites a load harness as the no-regression oracle for a modified site
- **AND** the harness never invokes that site, because the message, entrypoint, or lifecycle call that reaches it is never issued
- **THEN** the coverage claim SHALL be treated as unsupported
- **AND** the change SHALL either extend the harness to reach the site or record that the site has no automated oracle

#### Scenario: Coverage claimed at file granularity

- **WHEN** a change claims a harness "covers" a file because the harness imports or constructs something in it
- **THEN** the claim SHALL be re-derived at site granularity before it is relied on

#### Scenario: Harness exercises the site

- **WHEN** the harness demonstrably invokes the modified site within its measured window
- **THEN** the harness MAY be cited as the no-regression oracle for that site

### Requirement: Lint fix vocabulary must match the site, not the rule name

A change that clears a lint rule across many sites SHALL verify that each site
exhibits the defect the rule names before applying the rule's fix vocabulary. A
type-aware rule can flag a site for a reason other than the defect its name
describes, including inference artifacts where no value of the flagged kind
exists at all.

Where a site does not exhibit the named defect, the change SHALL apply the fix
appropriate to the actual code and SHALL NOT apply a vocabulary fix that
silences the diagnostic while implying a defect that was never present.

#### Scenario: Diagnostic is an inference artifact

- **WHEN** a floating-promise diagnostic is raised on a call to a function that returns no promise
- **THEN** the fix SHALL correct the type or annotation so the diagnostic is accurate
- **AND** the fix SHALL NOT be an `await` on a non-promise, which is a no-op that documents a defect that does not exist

#### Scenario: Site exhibits the named defect

- **WHEN** a flagged site does exhibit the defect the rule names
- **THEN** the rule's normal fix vocabulary SHALL apply

### Requirement: A promise fix in a test must not weaken the test

When a promise-handling defect is fixed inside a test file, the fix SHALL
preserve what the test proves. Rejection-suppressing fixes — `void`, a `.catch`
handler, or any construct that prevents a rejection from failing the test — SHALL
NOT be used in test files, because they suppress the failure the test exists to
detect.

Where a test deliberately leaves a promise in flight, the fix SHALL settle the
promise without altering the interleaving the test depends on, and SHALL match
the promise's actual polarity: asserting rejection on a promise that resolves
changes what the test proves and is a regression.

A touched test SHALL still fail when the behaviour it covers is broken.

#### Scenario: Suppressing fix applied in a test

- **WHEN** a floating-promise diagnostic in a test file is cleared with `void` or a `.catch` handler
- **THEN** the fix SHALL be rejected, because a rejected promise in a test must fail that test

#### Scenario: Polarity mismatch

- **WHEN** a deliberately in-flight promise that resolves is settled with a rejection assertion
- **THEN** the fix SHALL be rejected, because the assertion changes what the test proves

#### Scenario: Touched test retains its teeth

- **WHEN** a test's promise handling has been modified
- **THEN** breaking the behaviour that test covers SHALL still cause the test to fail

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

### Requirement: The owned enforcers gate where a gate actually runs

The repo-convention, byte-cap, and i18n enforcers SHALL be invoked by `ship-it`
step 4.4, not by `quality:changed`. `quality:changed` has no automated caller —
it is absent from `.github/workflows/`, from `ship-it`, and from `ship-change`,
and is invoked only by the `code-quality` skill's interactive dev loop — so
wiring gating checks there would produce a gate that gates nothing. The existing
`quality:changed` definition SHALL remain unchanged by this change.

#### Scenario: Enforcers run on the ship path

- **WHEN** `ship-it` reaches step 4.4
- **THEN** `check-conventions.mjs --base origin/develop`, the `kb dox lint` byte-arm gate, `i18n:lint --strict`, and `i18n:parity` all run
- **AND** a non-zero exit from any of them stops the ship before the review checkpoint

#### Scenario: quality:changed is not silently redefined

- **WHEN** the change's diff is inspected
- **THEN** the `quality:changed` script definition is unmodified
- **AND** no claim is made that it gates the new enforcers

#### Scenario: Enforcers stay independently runnable

- **WHEN** a developer runs any enforcer directly from the command line
- **THEN** it behaves the same as when `ship-it` invokes it

### Requirement: An enforcer is repaired before it is wired

A check SHALL NOT be wired into a gate while it is broken. Every enforcer this
change wires SHALL be verified to run correctly against the current tree first,
and its violation count re-derived rather than quoted from a proposal.

#### Scenario: Broken enforcer repaired first

- **WHEN** `i18n-parity.mjs` exits non-zero because it reads a path removed by the client reorganisation
- **THEN** its path is repaired and the script verified to exit 0
- **AND** only then is it wired into step 4.4

#### Scenario: Advisory enforcer is made gating explicitly

- **WHEN** `i18n-lint.mjs` is wired
- **THEN** it is invoked with `--strict`, because it exits 0 regardless of findings without that flag

#### Scenario: An over-broad enforcer is narrowed, not adopted wholesale

- **WHEN** an enforcer's default exit code covers more failure kinds than the change intends to gate
- **THEN** the gate consumes its machine-readable output and fails only on the intended kind
- **AND** the enforcer's unrelated pre-existing findings are not adopted as blocking

#### Scenario: Counts are re-derived, not quoted

- **WHEN** a violation count is used to size the work
- **THEN** it is measured against the current tree at implementation time

### Requirement: The oracle grows beyond static analysis with a semantic reviewer

The quality oracle SHALL be understood as syntactic (Biome), type-level (`tsc`),
behavioural (`vitest`), convention-level (the step-4.4 enforcers), and semantic
(the `local-review-gate` checkpoint). The semantic layer SHALL NOT be part of any
deterministic npm script, because it requires the change's intent and a green
integrated tree.

#### Scenario: Semantic layer stays out of the deterministic scripts

- **WHEN** `quality:changed` runs
- **THEN** no model-backed reviewer is invoked
- **AND** the script remains deterministic and offline-runnable

#### Scenario: Documentation names all five layers

- **WHEN** `docs/code-quality.md` is read
- **THEN** it describes the syntactic, type-level, behavioural, convention-level, and semantic layers
- **AND** it states where each layer is invoked

