# Test Plan — harden-codeql-ratchet-followups

Stage: design   Generated: 2026-10-17

No clarifications: every Triple below fills from the delta spec + design D1/D2.

Harness: `scripts/__tests__/codeql-local-cli.test.mjs` (fake `CODEQL_BIN` +
temp git repos via `scripts/__tests__/fixtures/codeql-harness.mjs`). "Run" = a
plain analysis against a seeded baseline; `last-run.json` = `stateDirOf(repo)/last-run.json`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Prune/accept modes — hand-edited baseline refused | state-transition (illegal edge) | L1 | automated | seeded baseline with 1 entry; a run reports 1 new key; then the entry's `count` is raised by hand in `codeql-baseline.json` | `--accept <new key> --reason "false-positive: constant input"`, and separately `--prune` | each exits 2; stderr contains "re-run"; `codeql-baseline.json` byte-identical to the hand-edited bytes |
| E2 | Prune/accept modes — legacy record without a hash | decision table (hash absent) | L1 | automated | a run, then `baselineHash` deleted from `last-run.json` | `--prune` | exit 0/1 per verdict as before; stderr contains a note that the baseline binding was not checked; afterwards `last-run.json` carries a `baselineHash` |
| E3 | Prune/accept modes — baseline edited during the analysis | state-transition (concurrent edit) | L1 | automated | seeded baseline; fake `codeql` rewrites one entry's `reason` in `codeql-baseline.json` during `database analyze` | run, then `--prune` | the prune exits 2; baseline equals the mid-run edited bytes |
| E4 | Prune/accept modes — triage between run and accept | state-transition (legal chain) | L1 | automated | seeded baseline with one `untriaged` entry; a run reports 1 new key | `--triage <entry> --reason "false-positive: x"`, then `--accept <new key> --reason "false-positive: y"` | the accept exits 0 and prints a passing verdict; both reasons present in the baseline |
| E5 | Prune/accept modes — triage does not launder a hand edit | state-transition (illegal chain) | L1 | automated | a run, then one entry's `count` raised by hand | `--triage` of an untriaged entry, then `--prune` | the prune exits 2; baseline byte-identical to the post-triage bytes |
| E6 | Prune/accept modes — triage after a legacy run | decision table (hash absent × hand edit) | L1 | automated | a run; `baselineHash` deleted from `last-run.json`; one entry hand-edited | `--triage` of an untriaged entry | `last-run.json` still has no `baselineHash` |
| E7 | Prune/accept modes — reformatting does not invalidate | EP (canonical-equal class) | L1 | automated | a run; baseline rewritten with 4-space indent and entries in reverse order, same values | `--prune` | prune proceeds (exit 0) with no "re-run" refusal |
| E8 | Prune/accept modes — boundary of "JSON formatting" | BVA (smallest semantic change) | L1 | automated | a run; one entry's `reason` changed only by an inner double space (`"false-positive:  x"`) | `--prune` | exit 2 (string content is not formatting) |
| E9 | Prune/accept modes — seed records its hash | state-transition (seed → prune) | L1 | automated | no baseline | `--write-baseline`, then `--prune` | `last-run.json` has `baselineHash`; the prune exits 0 and stderr has no legacy note |
| E10 | Prune/accept modes — repeatable after one run | state-transition (prune → accept → accept) | L1 | automated | a run reporting 2 new keys and 1 stale entry | `--prune`, `--accept` key 1, `--accept` key 2 | all three succeed; the last prints a passing verdict; `last-run.json.baselineHash` equals sha256 of the canonical form of the final baseline |
| E11 | Prune/accept modes — plain run records the canonical hash | EP (nominal) | L1 | automated | seeded baseline with 2 entries | plain run | `last-run.json.baselineHash` = sha256 of `serializeBaseline(parsed baseline)` |
| E12 | Prune/accept modes — triage without a record | EP (record absent) | L1 | automated | seeded baseline, no prior run (no `last-run.json`) | `--triage` of an untriaged entry | exit 0; `last-run.json` still absent |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Prune/accept modes — refusal leaves the baseline unchanged | fault-injection (corrupt input) | L1 | automated | after a run, `codeql-baseline.json` truncated to invalid JSON | `--prune` | exit 2; stderr "is not valid JSON"; file byte-identical; `last-run.json` unchanged |
| M1 | proposal — local/CI gap investigation (D2 steps 0–3) | measurement | — | manual-only | real CodeQL + CI SARIF of one post-switch commit | run D2 steps 0–2 | `evidence/local-vs-ci.md` records method, pack shas, set diffs per variation (a)–(g), and the 29 lost server results [judgment: root-cause reasoning — no automatable observable] |
| M2 | proposal — outcome (a)/(b) decision documented | review | — | manual-only | M1 evidence | user picks (a) or (b) | `docs/code-quality.md` known-limitation section states measured relationship + decision; an (a) is re-planned as its own delta [judgment] |

---

## Coverage summary

- Requirements covered: 1/1 MODIFIED requirement (all 7 new + 2 changed scenarios), plus proposal investigation items
- Scenarios by class: edge 12 · perf 0 · frontend 0 · error 1 · manual 2
- Scenarios by level: L1 13 · L2 0 · L3 0
- Scenarios by disposition: automated 13 · manual-only 2

## New infra needed

- `scripts/__tests__/fixtures/fake-codeql.mjs`: optional plan field (e.g.
  `analyzeWrites: { path, content }`) that writes a file during
  `database analyze`, for E3. Small extension of the existing fake; no new harness.
