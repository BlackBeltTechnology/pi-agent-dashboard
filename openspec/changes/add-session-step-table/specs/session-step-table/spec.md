# session-step-table — delta

## ADDED Requirements

### Requirement: Scope is this repository's sessions
The extractor SHALL process only sessions whose recorded `cwd` resolves under this
repository, including its `.worktrees/*`. Sessions from other projects SHALL be excluded
and counted.

#### Scenario: Foreign-project sessions are excluded
- **WHEN** a session's `cwd` is outside this repository
- **THEN** it SHALL NOT be extracted, and the report SHALL state how many sessions were excluded for this reason

#### Scenario: Worktree sessions are in scope
- **WHEN** a session's `cwd` is a `.worktrees/*` directory of this repository
- **THEN** it SHALL be extracted

#### Scenario: Missing cwd is excluded, not defaulted
- **WHEN** a session header carries no `cwd`
- **THEN** the session SHALL be excluded and counted, rather than treated as in-scope by an empty-string default

### Requirement: `ToolResult.isError` becomes optional in the shared type
`packages/session-distiller/src/types.ts` SHALL declare `isError?: boolean`, and
`trajectory.ts` SHALL preserve the field's absence instead of coercing it to `false`.
Existing distiller consumers SHALL be updated to handle the optional field.

#### Scenario: Absence survives normalization
- **WHEN** a raw tool result carries no `isError` property
- **THEN** the normalized `ToolResult` SHALL report the field as absent, not `false`

#### Scenario: Existing distiller behaviour is preserved
- **WHEN** the distiller's fault detection runs after the type change
- **THEN** its existing tests SHALL pass unchanged, with absence treated as "not a known error" rather than as a successful result

### Requirement: Reuse the distiller trajectory layer
The step-table extractor SHALL obtain events via `readSession` and normalize them via
`buildTrajectory` / `pairToolCalls` / `segment`. It SHALL NOT implement its own JSONL
parsing, tool-call/result pairing, or episode segmentation.

#### Scenario: No second parser
- **WHEN** the extractor module is inspected
- **THEN** it SHALL contain no `JSON.parse` over raw session lines and no re-implementation of call/result pairing
- **AND** it SHALL import those functions from `jsonl-reader.ts`, `trajectory.ts`, and `segment.ts`

### Requirement: Error labels come from the typed field, which is tri-state
Step-level error labelling SHALL read `ToolResult.isError`. Text pattern matching on tool
output SHALL NOT be used to decide the primary `is_error` label. The field has three
relevant states — `true`, `false`, and **absent** — and absent SHALL NOT be collapsed to
`false`.

#### Scenario: Regex proxy rejected
- **WHEN** a tool result has `isError === false` but its text contains the word "error"
- **THEN** the emitted row SHALL have `is_error = false`

#### Scenario: Unpaired call is not silently a success
- **WHEN** a `ToolCall` has no matching `ToolResult`
- **THEN** the row SHALL record `is_error = null` and `unpaired = true`, and SHALL NOT be counted as either class in the report

#### Scenario: Missing field is not a success
- **WHEN** a paired `ToolResult` carries no `isError` property at all
- **THEN** the row SHALL record `is_error = null` and `errorFieldPresent = false`, and SHALL be counted in neither class
- **AND** the report SHALL publish the field-presence rate per tool and per `doctrineEra`

#### Scenario: Ambiguous pairing is not confidently labelled
- **WHEN** two tool results claim the same `toolCallId`
- **THEN** the affected row SHALL record `unpaired = true` with `is_error = null` rather than adopting the last-written result

### Requirement: Harness arms are derived from the harness manifest
`harnessArm` SHALL be derived by matching a session's recorded `cwd` against the arm paths
declared in `scripts/ab-context/arms.json`. It SHALL NOT be inferred from a session
directory name or a path substring guess. If the manifest is absent, the extractor SHALL
fail loudly rather than emit rows with every `harnessArm` unset.

#### Scenario: Arm-B worktree sessions are tagged despite looking like the main project
- **WHEN** a session's `cwd` is the arm-B path declared in `arms.json` (a worktree inside the repo)
- **THEN** it SHALL be tagged with that arm and excluded from the default report, even though its project name matches the main repo

#### Scenario: Unrelated scratch sessions are not tagged
- **WHEN** a session's `cwd` is a temporary directory that appears in no arm of `arms.json`
- **THEN** `harnessArm` SHALL be unset and the session SHALL NOT be excluded as a harness run

#### Scenario: Missing manifest fails loudly
- **WHEN** `arms.json` cannot be read
- **THEN** the extractor SHALL abort with an explicit error rather than silently treating the corpus as arm-free

#### Scenario: Nested arm paths match the most specific arm
- **WHEN** one arm's path is a subpath of another arm's path (arm B lives inside arm A's tree)
- **THEN** a session under the inner path SHALL be tagged with the inner arm
- **AND** a prefix match that would attribute it to the outer arm SHALL be treated as a defect

#### Scenario: Unmatched sessions are included, not excluded
- **WHEN** a session's `cwd` matches no declared arm
- **THEN** `harnessArm` SHALL be null and the session SHALL be included in the default report

### Requirement: Step row schema
`steps.jsonl` SHALL emit one row per tool call with at least these fields:

| Field | Type | Meaning |
|---|---|---|
| `sessionId`, `episodeIndex`, `stepIndex` | string / int / int | provenance + ordering |
| `featureSchemaVersion` | int | schema version of this row |
| `tool` | string | tool name |
| `argKind` | string | coarse arg class (e.g. bash-head verb, read/write/edit target kind) |
| `pathKey` | string \| null | stable hash of the target path — never the path itself |
| `stepsSinceEpisodeStart` | int | position within the episode |
| `priorErrorsInEpisode` | int | running error count before this step |
| `repeatPathReadCount` | int | how many times this `pathKey` was already read in the episode |
| `kbBeforeGrep` | enum | `kb-first` \| `grep-first` \| `n/a` for this episode |
| `thinkingChars` | int | length of the preceding `thinking` block |
| `isTestInvocation` | bool | the call runs the test suite |
| `is_error` | bool \| null | from `ToolResult.isError` |
| `unpaired` | bool | no result found |
| `errorFieldPresent` | bool | whether `isError` existed on the paired result |
| `verdictObservable` | bool | false when the test verdict was destroyed |
| `labelSource` | enum | `direct` \| `log-reread` \| `behavioural` \| `none` |
| `model`, `startedAt`, `project`, `harnessArm`, `doctrineEra`, `extractorVersion` | string / enum | provenance for weighting / exclusion |

`episodes.jsonl` SHALL carry a schema pinned in the same way: `sessionId`,
`episodeIndex`, `outcome`, `labelSource`, `testInvocationCount`, `stepCount`,
`unobservableCount`, plus the same provenance and version columns.

#### Scenario: Schema version present on every row
- **WHEN** any row is emitted
- **THEN** it SHALL carry `featureSchemaVersion`
- **AND** a change to the field set SHALL require incrementing it

#### Scenario: Both tables are pinned
- **WHEN** `episodes.jsonl` is emitted
- **THEN** its field set SHALL be fixed by the spec in the same way as `steps.jsonl`, not left to the implementation

### Requirement: Text-free invariant
No emitted row SHALL contain transcript text: no prompt, assistant message, thinking
content, tool output, file content, diff, command string, or absolute path. Paths SHALL
appear only as `pathKey`, a stable hash.

#### Scenario: Planted secret cannot reach the output
- **WHEN** a session turn contains an `auth.json`-shaped token, a home-directory absolute path, and a file body
- **THEN** none of those substrings SHALL appear anywhere in `steps.jsonl`, `episodes.jsonl`, or `report.md`

#### Scenario: Free-text field additions are blocked
- **WHEN** a row field holds a value longer than a fixed short bound and is not an enum, id, or hash
- **THEN** the emitter SHALL fail loudly rather than write the row

### Requirement: Test invocation is detected at the command position only
A tool call SHALL count as a test invocation only when the tool is a shell-executing tool
and a **command segment** of its `command`/`code` argument begins with a test runner.
Matching against the serialized arguments object, against file content, or anywhere
within a command string SHALL NOT be used.

#### Scenario: File content mentioning a test runner is not a test run
- **WHEN** a `write` call's content, or a script's source text, contains `npm test` or `vitest`
- **THEN** no test invocation SHALL be recorded for that call

#### Scenario: Environment-prefixed and chained commands still match
- **WHEN** a command is `CI=1 npm test -- --run` or `cd pkg && npx vitest run`
- **THEN** a test invocation SHALL be recorded

#### Scenario: The runner set is enumerated, not implied
- **WHEN** the detector is implemented
- **THEN** the accepted runners and the accepted wrappers SHALL be an explicit list in the source
- **AND** the report SHALL state that list, so a corpus containing an unlisted runner is visibly under-counted rather than silently labelled `no-signal`

#### Scenario: General-purpose interpreters are not test wrappers
- **WHEN** a command is `node scripts/some-script.mjs` or another general interpreter invocation
- **THEN** it SHALL NOT be recorded as a test invocation

#### Scenario: The detector's own accuracy is measured
- **WHEN** the extractor is first run
- **THEN** the detector SHALL be scored against a hand-labelled sample of command strings, and its precision and recall SHALL appear in the report
- **AND** a detector that cannot beat the recorded planning failure SHALL block the change

### Requirement: Episode outcome label
`episodes.jsonl` SHALL emit one row per segmented episode carrying a terminal outcome
label derived from objective signals: `red-green` (a failing test run later followed by a
passing one), `red-only`, `green-only`, `unobservable`, or `no-signal` (no test
invocation).

#### Scenario: Ordering matters
- **WHEN** an episode's only passing test run precedes its only failing test run
- **THEN** the label SHALL be `red-only`, not `red-green`

#### Scenario: Episodes without tests are not counted as successes
- **WHEN** an episode invokes no test command
- **THEN** its label SHALL be `no-signal` and it SHALL be excluded from success-rate statistics in the report

### Requirement: Destroyed verdicts are labelled, never guessed
When a test invocation's verdict cannot be read from either channel — exit status
(unusable when the command pipes without `pipefail`) or summary text (discarded by
`tail`/`grep`) — the step SHALL record `verdictObservable = false` and the episode SHALL
be labelled `unobservable`. The extractor SHALL NOT infer a verdict from the absence of
failure output.

#### Scenario: Piped run without pipefail is not read as green
- **WHEN** a failing test run is piped through `tee` or `tail` with no `set -o pipefail`, so the result carries `isError === false` and no summary line
- **THEN** the step SHALL be `verdictObservable = false`
- **AND** it SHALL NOT be labelled `green`

#### Scenario: Empty grep output is not a green verdict
- **WHEN** a test run piped to `grep` for failure patterns produces no output
- **THEN** the verdict SHALL remain unobservable rather than being inferred as passing

#### Scenario: Unobservable rate is reported
- **WHEN** the report is generated
- **THEN** it SHALL state the count and percentage of test invocations whose verdict was unobservable, broken down by pipe shape

### Requirement: Labels are derived, never stored as ground truth
The emitted tables SHALL be a **pure function** of the immutable session JSONL plus the
extractor version. Rows SHALL NOT be hand-edited, patched in place, or back-filled from a
previous run. Every row SHALL carry `extractorVersion`, and every label SHALL carry
`labelSource` naming the channel it came from.

#### Scenario: A corrected extractor re-labels the whole corpus
- **WHEN** a labelling bug is found and the extractor is fixed
- **THEN** a full re-extract SHALL be sufficient to correct every historical row
- **AND** no manual dataset repair step SHALL be required

#### Scenario: Mixed extractor versions are refused
- **WHEN** the output directory contains rows from more than one `extractorVersion`
- **THEN** the extractor SHALL refuse to append and SHALL require a full re-extract

### Requirement: Recovered verdicts are separated from observed ones
Where a destroyed verdict is recovered from a later re-read of the same log artifact, the
row SHALL record `labelSource = "log-reread"` and remain distinguishable from
`labelSource = "direct"`. Verdicts SHALL NOT be borrowed from a different test execution,
and the model's own prose assertion SHALL NOT be used as a label.

#### Scenario: A neighbouring test run is not a recovery
- **WHEN** a destroyed invocation is followed by a *different* test invocation with a readable verdict
- **THEN** the destroyed invocation SHALL remain `unobservable` and SHALL NOT inherit the neighbour's verdict

#### Scenario: Prose claims are excluded
- **WHEN** the assistant states "all tests pass" after an invocation whose verdict was destroyed
- **THEN** that statement SHALL NOT produce a label

### Requirement: Behavioural inference may only add failures, never successes
A destroyed verdict MAY be inferred from the assistant's subsequent **actions** (not its
prose), and SHALL then carry `labelSource = "behavioural"` with a calibrated confidence.
The inference SHALL be one-directional: it may assign `red`, and SHALL NEVER assign
`green`. Absence of failure-investigating behaviour is not evidence of success.

#### Scenario: Inaction never yields a pass
- **WHEN** a destroyed invocation is followed by no log inspection, no re-run, and no edits
- **THEN** the verdict SHALL remain `unobservable`, and SHALL NOT be inferred `green`

#### Scenario: Behavioural labels are calibrated and abstaining
- **WHEN** the behavioural inference is applied
- **THEN** it SHALL emit a label only above a threshold calibrated to a stated minimum precision on held-out sessions, and SHALL abstain otherwise
- **AND** the achieved precision, recall, and coverage SHALL appear in the report

#### Scenario: The threshold is not chosen on the folds it is scored on
- **WHEN** the precision threshold is selected
- **THEN** it SHALL be chosen on an inner split and reported on an outer split never used for tuning
- **AND** the report SHALL present interval estimates, not bare point estimates, given the small positive count

#### Scenario: Too few positives suppresses the channel entirely
- **WHEN** the positive count in any evaluation cell falls below a stated minimum
- **THEN** the behavioural channel SHALL be suppressed and no behavioural labels emitted, rather than reported with an interval spanning most of the unit range

#### Scenario: A recipe-confounded feature is reported per era
- **WHEN** a behavioural feature could be explained by a documented workflow instruction rather than by failure
- **THEN** its lift SHALL be reported separately per `doctrineEra`, so compliance and distress can be told apart

#### Scenario: Direct labels always win
- **WHEN** an invocation has a directly readable verdict
- **THEN** behavioural inference SHALL NOT be applied to it

### Requirement: Behavioural features are stratified by availability
A behavioural feature that is structurally unavailable for a subpopulation SHALL NOT be
treated as a zero-valued observation for that subpopulation. The inference SHALL be fitted
and applied within strata defined by feature availability, and the report SHALL state the
stratum sizes.

#### Scenario: Log-dependent features do not leak into no-log runs
- **WHEN** a test invocation wrote no log artifact, so no later call can reference one
- **THEN** a log-inspection feature SHALL be recorded as unavailable, not as absent-and-therefore-passing
- **AND** the invocation SHALL be scored by a stratum-specific model or abstained on

#### Scenario: Calibration is validated on the matching stratum
- **WHEN** precision is reported for the behavioural inference
- **THEN** it SHALL be computed per stratum, not pooled across strata with different base rates

#### Scenario: Recovered rows are excludable
- **WHEN** a consumer requests direct-observation labels only
- **THEN** filtering on `labelSource` SHALL be sufficient, with no re-extraction required

### Requirement: Doctrine era is recorded
Each row SHALL carry a `doctrineEra` field distinguishing sessions recorded before the
`AGENTS.md` `pipefail` test-doctrine fix from those recorded after it, because the two
periods have different label-generating processes.

#### Scenario: Eras are not silently pooled
- **WHEN** the report presents any outcome statistic
- **THEN** it SHALL break the statistic down by `doctrineEra`

### Requirement: Corpus filter is a measured parameter, not a magic number
Session inclusion SHALL be governed by an explicit, documented threshold on **tool-call
count** (default 20), configurable by flag. File size SHALL NOT be the inclusion
criterion.

#### Scenario: Threshold is reported and overridable
- **WHEN** the extractor runs
- **THEN** `report.md` SHALL state the threshold in force and the count of sessions included and excluded by it
- **AND** a flag SHALL change the threshold without a code edit

### Requirement: Harness runs are tagged and excludable
Sessions originating from `scripts/ab-context` (or otherwise carrying an experiment arm)
SHALL be tagged with `harnessArm` and SHALL be excludable by flag, so ablation runs
cannot silently contaminate observational statistics.

#### Scenario: Ablation arms do not pollute the default report
- **WHEN** the corpus contains harness sessions run with doctrine removed
- **THEN** the default report SHALL exclude them and SHALL state how many were excluded

### Requirement: Deterministic and incremental
Two runs over an unchanged corpus SHALL produce byte-identical `steps.jsonl` and
`episodes.jsonl`. A re-run SHALL process only sessions newer than the persisted
watermark, and SHALL support a full re-extract by flag.

#### Scenario: Byte-identical repeat run
- **WHEN** the extractor is run twice with no new sessions and no schema change
- **THEN** the two outputs SHALL hash identically

#### Scenario: Serialization is pinned, not incidental
- **WHEN** rows are written
- **THEN** JSON key order, number formatting, and row sort order SHALL be explicitly fixed
- **AND** the determinism test SHALL compare against a committed fixture hash, not only against a second in-process run

#### Scenario: An out-of-order session is not skipped forever
- **WHEN** a session file appears whose start timestamp precedes the persisted watermark
- **THEN** it SHALL still be extracted rather than permanently skipped by a max-timestamp comparison
- **AND** incremental state SHALL track per-file identity (path, size, mtime), not only a single high-water timestamp

#### Scenario: Row order is total
- **WHEN** rows are sorted for output
- **THEN** the sort key SHALL be total — timestamp alone is insufficient because same-second ties are possible; `sessionId` and `stepIndex` SHALL break ties

#### Scenario: The fixture hash is taken over a frozen corpus
- **WHEN** the determinism test runs
- **THEN** it SHALL operate on a fixture corpus committed to the repository, never on the live sessions directory, which grows between runs

#### Scenario: Schema bump forces full re-extract
- **WHEN** `featureSchemaVersion` differs from the persisted one
- **THEN** the extractor SHALL re-extract the full corpus rather than append mismatched rows

### Requirement: Report states its own limits
`report.md` SHALL present label densities, class balance, per-month and per-model
breakdowns, and univariate correlations between doctrine features and the episode outcome
label. It SHALL carry a header stating that these are observational correlations from a
single-subject, non-stationary corpus and are not causal evidence, and it SHALL name
`scripts/ab-context` as the causal instrument.

#### Scenario: No unqualified causal claim
- **WHEN** the report presents a correlation between a doctrine feature and outcome
- **THEN** the confounding disclaimer SHALL be present in the same document
- **AND** no wording SHALL assert that a feature *causes* the outcome

### Requirement: Bounded cold-pass cost
A full cold extraction over the corpus SHALL stream sessions rather than hold the corpus
in memory, SHALL keep peak RSS under a stated bound, and SHALL report wall time and bytes
scanned.

#### Scenario: Memory bound respected on the full corpus
- **WHEN** a full re-extract runs over the whole session directory
- **THEN** peak RSS SHALL stay under the documented bound
- **AND** the run SHALL print bytes scanned, sessions included/excluded, and elapsed time
