## MODIFIED Requirements

### Requirement: Prune, accept and seed modes
After an analysis the script SHALL record the run's snapshot id, keys, counts,
results and a hash of the canonical serialization of the baseline the run's
verdict was computed from; after `--write-baseline` the recorded hash SHALL be
that of the written baseline. JSON formatting or entry-order changes SHALL NOT
change the hash.
`--prune` SHALL lower every entry to its current count and remove
entries whose count reaches 0, never raising a count or changing a reason.
`--accept <ruleId> <file> <lineHash> --reason <text>` SHALL set a key that has
results in excess of its baseline count in the last run to its current count
with the given reason, which SHALL be a valid non-`untriaged` reason and, for
an existing entry, SHALL differ from its current reason after whitespace
normalization (trim, runs of whitespace collapsed to one space). Both SHALL refuse
(exit 2, baseline unchanged) when no run is recorded, the snapshot id changed
since it, or the baseline file no longer hashes to the recorded baseline hash
(a record without a hash SHALL be accepted with a note on stderr), SHALL be
repeatable after one run (each write re-records the baseline hash), and SHALL print the ratchet
verdict recomputed against the updated baseline, exiting 0 when no new results
remain and 1 when some do.
`--triage <ruleId> <file> <lineHash> --reason <text>` SHALL replace the reason
of an existing entry whose reason is `untriaged` with a valid non-`untriaged`
reason, leaving its count unchanged, without an analysis run but under the
lock, and SHALL refuse (exit 2) a missing key or any other entry. After its
write, `--triage` SHALL re-record the baseline hash only when a run is recorded
whose hash matches the baseline as it was before the triage.
`--prune`
SHALL print every removed or lowered entry whose reason is not `untriaged`. `--write-baseline` SHALL refuse when a baseline exists; otherwise it
SHALL run an analysis with the script's built-in default pack versions and
write a baseline whose header records the CLI and pack versions of that run
and whose entries are all current keys with reason `untriaged`. Written
baselines SHALL be sorted by file, rule id and line hash.

#### Scenario: Prune removes a fixed alert
- **WHEN** a baselined key has no current results and `--prune` runs
- **THEN** the entry SHALL be removed and every other entry SHALL be unchanged

#### Scenario: Prune reports lost reasons
- **WHEN** `--prune` removes an entry whose reason is `github-dismissed (#12, false positive): x`
- **THEN** it SHALL print that entry with its reason

#### Scenario: Prune never raises
- **WHEN** a key's current count exceeds its baseline and `--prune` runs
- **THEN** that entry's count SHALL be unchanged

#### Scenario: Several accepts after one run
- **WHEN** a run reports two new keys and `--accept` is invoked for each with reason `false-positive: constant input`
- **THEN** both SHALL be recorded with their current counts, and the second invocation SHALL print a passing verdict

#### Scenario: Accept refuses stale or invalid input
- **WHEN** `--accept` names a key without excess results, uses reason `untriaged`, an empty or unprefixed reason, the entry's current reason, or an `operator-authz:` reason on `js/request-forgery`, or a source file changed since the last run
- **THEN** the script SHALL exit non-zero and leave the baseline unchanged

#### Scenario: Triage an untriaged entry
- **WHEN** `--triage` names an entry with reason `untriaged` and reason `false-positive: constant input`
- **THEN** that entry's reason SHALL change, its count SHALL stay the same, and a following `--check-baseline-diff` SHALL pass and print the changed reason

#### Scenario: Triage refuses a triaged entry
- **WHEN** `--triage` names an entry whose reason is not `untriaged`
- **THEN** the script SHALL exit 2 and leave the baseline unchanged

#### Scenario: Seed run writes header and entries
- **WHEN** `--write-baseline` runs with no baseline present
- **THEN** the written baseline SHALL record the CLI and pack versions of the run and contain every current key with reason `untriaged`, and a following plain run SHALL pass

#### Scenario: Seed refuses to overwrite
- **WHEN** `--write-baseline` runs while `codeql-baseline.json` exists
- **THEN** it SHALL exit non-zero and leave the file unchanged

#### Scenario: Hand-edited baseline is refused
- **WHEN** an entry of the baseline file is edited by hand after an analysis run and `--accept` or `--prune` is invoked
- **THEN** the script SHALL exit 2 asking to re-run the analysis and leave the baseline unchanged

#### Scenario: Legacy run record without a hash
- **WHEN** `last-run.json` has no baseline hash
- **THEN** `--prune` and `--accept` SHALL proceed as before and print a note that the baseline binding was not checked

#### Scenario: Baseline edited during the analysis
- **WHEN** the baseline file is edited by hand while an analysis run is in progress and `--accept` or `--prune` is invoked after it
- **THEN** the script SHALL exit 2 and leave the baseline unchanged

#### Scenario: Triage between run and accept
- **WHEN** an analysis run is followed by `--triage` of an untriaged entry and then `--accept` of a new key
- **THEN** the accept SHALL succeed

#### Scenario: Triage does not launder a hand edit
- **WHEN** the baseline is edited by hand after a run, then `--triage` runs, then `--prune` runs
- **THEN** the prune SHALL exit 2 and leave the baseline unchanged

#### Scenario: Triage after a legacy run does not launder a hand edit
- **WHEN** `last-run.json` has no baseline hash, the baseline is edited by hand, then `--triage` runs
- **THEN** `last-run.json` SHALL still have no baseline hash

#### Scenario: Reformatting does not invalidate a run
- **WHEN** the baseline file's JSON formatting or entry order changes after a run and `--prune` is invoked
- **THEN** the prune SHALL proceed

#### Scenario: Prune or accept after a seed run
- **WHEN** `--write-baseline` runs and is followed by `--prune`
- **THEN** the prune SHALL proceed without the legacy note
