## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Ratchet graduation and CI integration

Rules SHALL progress one-way through severities (`off → warn → error`). A rule
SHALL graduate from `warn` to `error` only after `biome lint . --only=<rule>`
reports zero violations outside grandfathered overrides. CI SHALL run
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
