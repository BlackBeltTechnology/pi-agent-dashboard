# Test Plan — add-session-step-table

Stage: apply   Generated: 2026-08-06

## ⚠ Clarifications needed (3)

- [ ] **C1** — Blocks P1/P2. No peak-RSS threshold exists anywhere in the change; the spec says "a stated bound" without stating one. The bound cannot be derived from file size (whole-file Buffer + parsed event graph + retained `Trajectory` are live together). Candidates: measure the largest in-scope session first and set the bound at 2× that measurement, or fix a flat 512 MB ceiling, or drop the assertion and only report the number.
- [ ] **C2** — Blocks B4/B5. The minimum per-cell positive count that suppresses the behavioural channel is required by the spec but never given a value. Candidates: 10 positives per cell, 20, or "suppress unless the Wilson interval half-width is below 0.15".
- [ ] **C3** — Blocks E17. `doctrineEra` is pinned to "the commit that lands the `pipefail` fix", but that edit is uncommitted, so the SHA does not exist yet and `git log -S "set -o pipefail" -- AGENTS.md` returns nothing. The planning commit resolves this; until it lands, the era boundary has no referent.

> Resolve before the blocked scenarios (marked below) can be authored.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Corpus filter is a measured parameter | BVA | L1 | automated | fixture sessions with exactly 19, 20, 21 tool calls | extractor runs with default threshold 20 | the 19-call session is excluded; 20 and 21 are included; report states threshold 20 and counts 1 excluded |
| E2 | Corpus filter overridable | EP | L1 | automated | same fixture; `--min-tool-calls 21` | extractor runs | only the 21-call session is included; report states threshold 21 |
| E3 | Scope is this repository's sessions | EP | L1 | automated | sessions with cwd = repo root, repo/`.worktrees/os-x`, repo + `-other` sibling dir, `/private/tmp` | extractor runs | first two included; the sibling whose path merely *prefixes* the repo path is excluded; `/private/tmp` excluded; excluded count = 2 |
| E4 | Missing cwd is excluded, not defaulted | EP | L1 | automated | session file whose first line is a `message`, not a `session` header | extractor runs | session excluded and counted under "missing cwd"; NOT extracted via the `cwd = ""` default in `buildTrajectory` |
| E5 | `isError` tri-state | decision-table | L1 | automated | four paired results: `isError:true`, `isError:false`, property absent, plus one call with no result | extractor runs | rows are `is_error=true` / `false` / `null`+`errorFieldPresent=false` / `null`+`unpaired=true`; error-rate denominator counts only the first two |
| E6 | `isError` absent is not success in `signals.ts` | decision-table | L1 | automated | episode whose terminal tool result omits `isError` | `episodeVerifiedGood` is evaluated | returns not-verified-good; asserts `!undefined === true` did NOT make it pass |
| E7 | Ambiguous pairing | decision-table | L1 | automated | two tool results carrying the same `toolCallId` | trajectory is built | affected row is `unpaired=true`, `is_error=null`; last-write-wins does NOT yield a confident label |
| E8 | Test invocation at command position only | decision-table | L1 | automated | a `write` call whose file content contains `npm test`; a `bash` call `echo npm test`; a `bash` call `npm test` | extractor runs | only the third records a test invocation; regression against the 5.2× planning inflation |
| E9 | Env-prefixed and chained commands | EP | L1 | automated | `CI=1 npm test -- --run`; `cd pkg && npx vitest run` | extractor runs | both record a test invocation |
| E10 | npm-script indirection | decision-table | L1 | automated | `npm run quality:changed` (whose script body contains `&& npm test`) | extractor runs | classified per the documented rule, and the fixture pins which rule was chosen — a lint run is not silently counted as a test run |
| E11 | General interpreters are not wrappers | EP | L1 | automated | `node scripts/split-large-agents.mjs` | extractor runs | no test invocation recorded |
| E12 | Harness arms exact match | decision-table | L1 | automated | sessions with cwd = arm A exactly, arm B path exactly, `.worktrees/os-fix-settings-mobile-layout`, and an unrelated dir | extractor runs | arm A → A, arm B → B (even though that worktree no longer exists on disk), the non-arm worktree → `null` **and included**, unrelated → `null` |
| E13 | Arm paths are checkout-independent | EP | L1 | automated | `arms.json` with absolute paths from a different machine root | extractor runs | arms still match via repo-relative suffix; no silent all-`null` outcome |
| E14 | Episode outcome ordering | state-transition | L1 | automated | episode with verdicts [green, red]; another [red, green]; another [red]; another with no test call | labels computed | `red-only`, `red-green`, `red-only`, `no-signal` respectively |
| E15 | Destroyed verdict never inferred green | state-transition | L1 | automated | failing run piped `\| tee log` with no `pipefail`, result `isError:false`, no summary line | labels computed | step is `verdictObservable=false`; episode `unobservable`; never `green` |
| E16 | Empty grep output is not green | EP | L1 | automated | test run piped to `grep FAIL` producing zero output | labels computed | verdict stays unobservable |
| E17 | Doctrine era recorded | state-transition | L1 | automated | sessions timestamped before and after the pinned era boundary | extractor runs | rows carry distinct `doctrineEra`; every outcome statistic in the report is broken down by it — [NEEDS CLARIFICATION: input — see C3, the boundary SHA does not exist until the planning commit lands] |
| E18 | Step + episode schema pinned | EP | L1 | automated | any fixture corpus | extractor runs | every step row carries all C7 fields incl. `errorFieldPresent`, `verdictObservable`, `labelSource`, `extractorVersion`, `doctrineEra`; every episode row carries its pinned field set |
| E19 | pathKey stability and distinctness | EP | L1 | automated | two different absolute paths sharing a basename; the same path in two sessions | extractor runs twice | same path → identical key across runs; different paths → different keys; normalisation of `src/x.ts` vs `./src/x.ts` vs absolute is pinned by fixture |
| E20 | Row order is total | BVA | L1 | automated | two sessions with identical `startedAt` to the second | extractor runs twice | byte-identical output; `sessionId`+`stepIndex` break the tie deterministically |
| E21 | Version mismatch forces re-extract | state-transition | L1 | automated | output dir populated at `featureSchemaVersion` N | extractor runs at version N+1 | refuses to append; performs a full re-extract; no mixed-version rows persist |
| E22 | Incremental store is version-keyed | state-transition | L1 | automated | store populated at version N with unchanged `(path,size,mtime)` tuples | extractor runs at version N+1 | prior rows are NOT reused despite matching tuples |
| E23 | Out-of-order session not skipped | state-transition | L1 | automated | session file whose filename timestamp precedes the persisted watermark (simulating resume/copy) | incremental run | session is extracted, not permanently skipped by the strict `>` comparison |
| E24 | Recovered verdict not borrowed | decision-table | L1 | automated | destroyed invocation followed by a *different* test invocation with a readable verdict | labels computed | destroyed one stays `unobservable`; does not inherit the neighbour's verdict (regression against the 71.1% planning error) |
| E25 | Prose claims excluded | EP | L1 | automated | destroyed invocation followed by assistant text "all tests pass" | labels computed | no label produced from the prose |
| E26 | Direct labels win | decision-table | L1 | automated | invocation with a directly readable verdict that also has behavioural signals | labels computed | `labelSource=direct`; behavioural inference not applied |
| E27 | Behavioural never emits green | decision-table | L1 | automated | destroyed invocation with no log inspection, no re-run, no edits | inference runs | remains `unobservable`; no `green` label at any confidence |
| E28 | Unavailable feature is not zero | decision-table | L1 | automated | destroyed invocation whose command wrote no log artifact | inference runs | `readLog` recorded unavailable; scored by the no-log stratum model or abstained — NOT scored as `readLog=0` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Bounded cold-pass cost | threshold | L1 | automated | frozen fixture corpus incl. one deliberately large session | peak RSS below the stated bound — [NEEDS CLARIFICATION: threshold — see C1] | single full run |
| P2 | Real-corpus cold pass | soak | — | manual-only | the live ~2,264 in-scope sessions (~1.2 GB), unavailable in CI | wall time + bytes scanned + peak RSS reported — [NEEDS CLARIFICATION: threshold — see C1] | single full run, local |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Harness manifest required | fault-injection (abort) | L1 | automated | `arms.json` missing or unreadable | extractor runs | aborts with an explicit error; does NOT emit rows with every `harnessArm` unset |
| X2 | Malformed JSONL tolerated and counted | fault-injection (corrupt) | L1 | automated | session file with 3 unparseable lines among valid ones | extractor runs | valid events extracted; malformed count surfaced in the report; no crash |
| X3 | Text-free invariant under adversarial input | fault-injection (planted) | L1 | automated | fixture containing an `auth.json`-shaped token, a `/Users/...` absolute path, a file body, and a raw command string | extractor runs | none of those substrings appear in `steps.jsonl`, `episodes.jsonl`, or `report.md` — asserted by content scan, independent of the determinism hash |
| X4 | Emitter guard rejects free text | fault-injection (schema abuse) | L1 | automated | a row field assigned a long non-enum, non-hash string | emit is attempted | fails loudly; the row is not written and is not silently truncated |
| X5 | mtime churn is safe, not silent | fault-injection (VCS) | L1 | automated | fixture corpus whose mtimes are all reset (simulating `git pull` / `tar -x`) | incremental run | full re-extract occurs (wasteful but correct); no stale rows reused |
| X6 | Determinism under repeat | state-convergence | L1 | automated | frozen fixture corpus | extractor runs twice, and against a committed hash | both outputs hash identically and match the committed fixture hash |

### Reporting / methodology

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| R1 | Report states its own limits | EP | L1 | automated | any run whose report contains a correlation section | report generated | the confounding disclaimer is present in the same document and `scripts/ab-context` is named; a report with a correlation and no disclaimer fails the test |
| R2 | Suppression distinguishable from no-signal | decision-table | L1 | automated | behavioural cell with positives below the minimum | report generated | the row reads "suppressed (n<min)", never "no signal" — [NEEDS CLARIFICATION: input — see C2, the minimum is unset] |
| R3 | Detector accuracy published | EP | L1 | automated | hand-labelled sample of command strings committed as a fixture | report generated | precision and recall for the test-invocation detector appear in the report |
| R4 | Reconciliation against planning baseline | EP | L1 | automated | the frozen fixture corpus | report generated | a table compares the contaminated detector's counts against the corrected detector's; a run failing to reproduce the ~5.2× gap on the fixture fails the check |
| R5 | Report is decision-useful to a human | judgment | — | manual-only | the real-corpus report | a human reads it looking for a doctrine feature worth an ab-context arm | [judgment: "does this surface a candidate worth testing" — no automatable observable] |

---

## Coverage summary

- Requirements covered: 20/20 spec requirements have at least one scenario
- Scenarios by class: edge 28 · perf 2 · error 6 · reporting 5
- Scenarios by level: L1 39 · L2 0 · L3 0 · — 2
- Scenarios by disposition: automated 39 · manual-only 2

No L2/L3 rows: this change ships a library module and a CLI flag with no rendered UI
and no cross-OS install surface. Routing a scenario to `qa/` or Playwright here would be
level-inflation, not coverage.

## New infra needed

- **A frozen fixture corpus committed to the repository.** E20/E23/X6/P1/R4 all require a
  session corpus that does not change between runs; the live `~/.pi/agent/sessions`
  directory grows daily and cannot produce a stable hash. This does not exist today and is
  a prerequisite for the determinism contract, not an optional convenience.
- **A hand-labelled command-string sample** (R3) for scoring the test-invocation detector.
