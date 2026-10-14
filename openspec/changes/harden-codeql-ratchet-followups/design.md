## Context

Shipped design: `openspec/specs/codeql-local-ratchet/spec.md`; D7 there says
prune/accept "refuse when the current snapshot id differs" and that "any number
of prunes and accepts can follow one run" because the snapshot excludes the
baseline. Evidence: archived `add-local-codeql-ratchet/evidence/local-vs-github.md`
(pre-switch gap: 29 GitHub-only) and the post-switch measurement above
(29 local-only, 0 CI-only).

## Decisions

### D1 — Baseline hash in `last-run.json`
`last-run.json` gains `baselineHash` = sha256 of the baseline file bytes at the
time the run compared against it (absent when no baseline, e.g. seed). `requireFreshRun`
additionally compares it with the current file; mismatch → exit 2 "baseline
changed since the recorded run; re-run first". `--prune`/`--accept` rewrite
`last-run.json` atomically with the new hash after writing the baseline, under
the existing lock. `--triage` does not use the record and is unchanged.
Missing `baselineHash` (old record) → accepted, fail-open.
Alternative: include the baseline in the snapshot id. Rejected: it makes every
prune/accept invalidate the run, undoing "repeatable after one run".

### D2 — Gap investigation (decision gate)
Run at one commit, on the same machine, local analysis with variations; compare
with the CI SARIF of that commit by (rule, file, line): (1) `database create`
file counts per extension vs the CI SARIF `artifacts`; (2) with/without
`LGTM_INDEX_FILTERS`; (3) `--threat-model` default vs `remote`; (4) the
action's init log of the CI run (suite, threat model, extractor options).
Stop at the first variation that reproduces CI's 150. Then ask the user:
(a) align local with CI, or (b) keep local stricter and document. No config
change before that answer.

## Risks / Trade-offs

- [Hash churn: a formatter touching the baseline] → the script is the only
  writer and writes deterministic bytes; a hand edit is exactly what is refused.
- [Investigation inconclusive] → outcome (b) with the measurements recorded.
