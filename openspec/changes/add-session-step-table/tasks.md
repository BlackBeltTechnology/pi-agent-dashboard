# Tasks

## 0. Scope gate + shared-type change (do first — both widen beyond one module)

- [ ] 0.1 In-scope filter: extract only sessions whose `cwd` resolves under this repo, including `.worktrees/*`. Measured target: **2,264 in scope, 908 excluded, 0 missing `cwd`**. Read the header — do not infer scope from the session directory name (that undercounts by ~340). A session with no `cwd` is excluded, not defaulted to in-scope; `trajectory.ts` defaults a missing header cwd to `""`.
- [ ] 0.2 Change `packages/session-distiller/src/types.ts` `ToolResult.isError` from `boolean` to `boolean | undefined`, and stop `trajectory.ts:53` coercing absence to `false`.
- [ ] 0.2a **The coercion does not live only in `trajectory.ts`.** `signals.ts` tests `!r.isError` at lines 44, 56, 65, 69 — with an optional field, `!undefined === true`, so an absent flag reads as **verified-good** in `passingCheck`, `episodeVerifiedGood`, and `detectFaults`. Making the type optional without touching these RELOCATES the bug one call site deeper instead of fixing it. Each site must distinguish `=== false` from absent. Write the failing test at each site first.
- [ ] 0.2b `trajectory.test.ts:36` asserts `expect(c3?.result?.isError).toBe(false)` strictly. If that fixture omits `isError`, this assertion flips to `undefined` and fails. Check the fixture and update the assertion deliberately — do not weaken it to `toBeFalsy()`, which is the very conflation being removed.
- [ ] 0.2c External consumers of this type: `packages/shared/src/state-replay.ts:142`, `packages/flows-plugin/.../flow-reducer.ts:269`, `packages/server/src/session-routes.ts:64`, `packages/authoring-toolkit/.../extract_session.ts:454`. Audit each for the same `!isError` truthiness pattern.
- [ ] 0.3 This is a cross-package change beyond the original single-module scope, taken deliberately: absence is destroyed at the type level, so no care inside the new module can recover it. **Amend the proposal's "no runtime behaviour change" non-goal accordingly** — distiller fault/episode classification genuinely changes for results lacking the field, which is a bug fix, not a neutral refactor.

## 1. Pin the schema before writing the emitter

- [ ] 1.1 Add `StepRow`, `EpisodeRow`, and `FEATURE_SCHEMA_VERSION` to `packages/session-distiller/src/types.ts`, matching the delta spec's field table exactly.
- [ ] 1.2 Write the failing test first: a fixture session (hand-built `RawEvent[]`) → expected `StepRow[]`. Verify it fails before any emitter exists.
- [ ] 1.3 Run `doubt-driven-review` on the field set. The schema is the interface every downstream consumer binds to; changing it later invalidates every fitted model.

## 2. Extractor over the existing trajectory layer

- [ ] 2.1 Create `packages/session-distiller/src/steptable.ts`. Drive `readSession` → `buildTrajectory` → `pairToolCalls` → `segment`. No new parsing, no new pairing.
- [ ] 2.2 Add a test asserting the module contains no raw-line `JSON.parse` and no local call/result pairing.
- [ ] 2.3 Emit one `StepRow` per `ToolPair`. Take `is_error` from `ToolResult.isError`; emit `is_error = null, unpaired = true` when the result is missing.
- [ ] 2.4 **Tri-state `isError`.** With task 0.2 landed, emit `is_error = null, errorFieldPresent = false` for a paired result whose `isError` is absent. Test first with a fixture result that omits the field.
- [ ] 2.5 Duplicate `toolCallId`: `pairToolCalls` is a `Map`, so last-write-wins can pair a call to an unrelated result. Detect the collision and mark the row `unpaired = true, is_error = null` rather than labelling it confidently.
- [ ] 2.6 Report the `isError` field-presence rate per tool and per `doctrineEra`.

## 3. Features

- [ ] 3.1 `argKind` — coarse enum from the tool + arguments (bash head verb, read/write/edit target kind, search vs fetch). Enumerated, never free text.
- [ ] 3.2 `pathKey` — stable hash of the normalized target path. Test: two different absolute paths that share a basename hash differently; the same path hashes identically across runs.
- [ ] 3.3 Episode-running counters: `stepsSinceEpisodeStart`, `priorErrorsInEpisode`, `repeatPathReadCount`.
- [ ] 3.4 `kbBeforeGrep` — per-episode ordering of the first `kb_*` call vs the first `rg`/`grep` invocation, as the three-valued enum.
- [ ] 3.5 `isTestInvocation` — shell tools only, `arguments.command`/`code` only, matched at a **command-segment position**. Write the negative test first: a `write` call whose file content contains `npm test` MUST NOT match. This exact bug inflated the planning baseline 5.2×.
- [ ] 3.5a Enumerate accepted runners and wrappers explicitly in source. Scoped to this repo: `npm test`, `npm run test:*`, `vitest`, `playwright test`, via `npx`/`pnpm`. **`node` and `pnpm dlx` are NOT wrappers** — `node scripts/*.mjs` is ubiquitous non-test usage here and would produce systematic false positives. Print the list in the report so an unlisted runner is visibly under-counted.
- [ ] 3.5b Score the detector against a hand-labelled sample of command strings; publish its precision/recall. Every episode outcome depends on this one function and it is the component that already failed once.
- [ ] 3.5c npm-script indirection: `npm run quality:changed` **contains** `&& npm test` in its definition, and this repo's `npm test` expands to `HOME=$(mktemp …) NODE_OPTIONS=… vitest run`. Decide and document whether the detector matches the literal invoked command or the expanded script body, and add both as fixtures — the wrong choice silently mis-classifies a lint run as a test run.
- [ ] 3.5d Record that excluding `node` as a wrapper also excludes `node --test` (Node's native runner) and that `bun test` is unlisted. Neither appears in this repo today, so the hand-labelled sample cannot detect the gap — note it as a known limitation of a repo-scoped list rather than a general rule.
- [ ] 3.6 `verdictObservable` — false when the command pipes without `set -o pipefail` (exit status severed) and no runner summary line survives in the output.
- [ ] 3.7 `thinkingChars`.
- [ ] 3.6 Provenance: `model` (honouring mid-session `model_change`), `startedAt`, `project`, `harnessArm`.

## 4. Episode labels

- [ ] 4.1 Terminal outcome label: `red-green` / `red-only` / `green-only` / `unobservable` / `no-signal`, ordering-sensitive.
- [ ] 4.2 Test: an episode whose passing run precedes its failing run labels `red-only`.
- [ ] 4.3 Test: an episode with no test invocation labels `no-signal` and is excluded from success-rate stats.
- [ ] 4.4 Test: a failing run piped through `tee`/`tail` with no `pipefail` labels `unobservable`, NOT `green`. Absence of failure output is never evidence of success.
- [ ] 4.5 Report the unobservable rate broken down by pipe shape (`tee` / `grep` / `tail` / raw). Planning measurement: 626/629 invocations piped, 0 with `pipefail`, 42.7% of verdicts unrecoverable.
- [ ] 4.6 `labelSource` on every label: `direct` | `log-reread` | `none`. Recovery is allowed ONLY from a later re-read of the *same* log artifact.
- [ ] 4.7 Negative test: a destroyed invocation followed by a *different* test run with a readable verdict stays `unobservable`. This exact shortcut inflated the planning recovery estimate from 9.1% to 71.1%.
- [ ] 4.8 Negative test: an assistant prose claim ("all tests pass") produces no label. Measured agreement with recovered truth was 2/5 — tiny sample, but below chance and mechanistically expected, since the old recipe returned exit 0 + empty grep on failure.
- [ ] 4.9 `doctrineEra` field: pre/post the `AGENTS.md` `pipefail` fix. Every outcome statistic in the report breaks down by it.

## 5. Text-free invariant (security gate)

- [ ] 5.1 Emitter-level guard: reject any field value that is not an id, enum, hash, number, or bool, or that exceeds a short length bound. Fail loudly, do not silently truncate.
- [ ] 5.2 Adversarial test: fixture session carrying an `auth.json`-shaped token, a home-directory absolute path, and a file body. Assert none of those substrings appear in any of the three outputs.
- [ ] 5.2a The determinism fixture-hash test proves C1 only — a deterministic extractor that leaks a path still hashes stably. Add a **separate content assertion** over the emitted files: no `/Users`, no `/home`, no recognisable command string. Determinism and sanitisation are independent properties and need independent tests.
- [ ] 5.3 Invoke `security-hardening` on the emitter. The corpus is the whole threat surface; this invariant is the only control.

## 6. Corpus selection, harness tagging, incrementality

- [ ] 6.1 Inclusion threshold on tool-call count (default 20), flag-overridable. Report included/excluded counts. Do not filter by file size.
- [ ] 6.2 **`harnessArm` from the manifest, not a path guess.** Read `scripts/ab-context/arms.json` and match each session's recorded `cwd` against the declared arm paths. Abort loudly if the manifest is missing. Exclude tagged sessions by default and report the count.
- [ ] 6.2a Regression test for the planning error: the heuristic "`--private-tmp--` cwd = harness run" was **backwards**. Verified: `arms.json` puts arm B at `.worktrees/ab-trimmed` (26 sessions, would have been tagged `project=pi-agent-dashboard` and *included*), while the 608 `--private-tmp--` sessions are ordinary scratch work (`cwd: /private/tmp`, mixed models) that would have been *excluded*. No arm marker exists in any session JSONL (grep-verified) — cwd matching is the only signal.
- [ ] 6.2b **Exact cwd equality, not prefix.** Arm B's path is a subpath of arm A's, so `startsWith` tags arm-B sessions as arm A. But most-specific-first is also insufficient: `.worktrees/ab-trimmed` **no longer exists on disk** (arm B is historical), while five unrelated worktrees do (`os-fit-attachments-for-display`, `os-fix-pi-install-node26-and-omit-dev-build`, `os-fix-settings-mobile-layout`, `os-serialize-bridge-message-pump`, `private-invoicebot-plugin`). Every feature-branch session prefix-matches arm A and would be mislabelled as a harness arm. Require **exact** cwd equality against an arm path; anything else → `harnessArm = null`, included.
- [ ] 6.2d Compare arm paths by their **repo-relative suffix**, not the absolute strings in `arms.json` — those are machine-specific, so a different checkout location matches nothing and silently tags every session `null`. Match arm B by path string even though its worktree is deleted; the historical sessions still exist.
- [ ] 6.2c Incremental state tracks per-file identity (path, size, mtime), not a single max timestamp. `watermark.ts:60` uses strict `tsMs > sinceMs` and prefers the filename timestamp over mtime, so a resumed or copied session is skipped **permanently** — re-anchoring the scan directory does not fix that.
- [ ] 6.3 Reuse `watermark.ts` for incremental runs; `--full` forces re-extract; a `featureSchemaVersion` mismatch forces re-extract automatically.
- [ ] 6.3b `extractorVersion` on every row; refuse to append across mixed versions. The tables are a pure function of (immutable JSONL × extractor version) — never hand-patched, so any future labelling bug is fixed by re-running, not by repairing data.
- [ ] 6.4 Determinism test over a **frozen fixture corpus committed to the repo** — never the live sessions dir, which grows daily and cannot produce a stable hash. Pin JSON key order, number formatting, and a **total** row sort (`startedAt` ties at same-second granularity; add `sessionId` + `stepIndex` tiebreakers).
- [ ] 6.5 `doctrineEra` boundary: pin to the commit SHA that lands the `AGENTS.md` `pipefail` fix, as a constant covered by `extractorVersion`. Do NOT derive it from live `git log` — output would then depend on repo history rather than on (JSONL × extractorVersion). Well-defined only because task 0.1 scopes the corpus to this repo.
- [ ] 6.6 Define the relationship between `featureSchemaVersion` and `extractorVersion` — one governs the field set, the other the derivation logic, and either changing invalidates existing rows. Prefer collapsing to a single monotonic version unless a reason to split survives review.
- [ ] 6.7 **Key the incremental store by version.** Per-file identity `(path, size, mtime)` has no version dimension, so after a version bump the tuples still match and prior rows are silently reused — defeating the forced re-extract that C2/C7 promise. The store must be namespaced or wiped by version.
- [ ] 6.8 `mtime` is VCS-fragile: `git pull` / `tar -x` / worktree creation reset it, forcing a wasteful (but safe) full re-extract; a same-size edit with equal mtime is missed (unsafe). Document the trade-off, or hash file content when size is unchanged.
- [ ] 6.9 Treat "0 sessions with missing `cwd`" as provisional. `jsonl-reader.ts` `sessionHeader()` returns `undefined` when the first event is not a well-formed `session` record (crash-truncated or hand-edited file), and `buildTrajectory` then defaults `cwd` to `""`. Count and report these rather than assuming zero.

## 7. Reconcile against the exploratory baseline

- [ ] 7.1 Run the extractor over the same ~300 substantial sessions the proposal's baseline scan used.
- [ ] 7.2 Produce a reconciliation table: exploratory regex estimate vs typed-field truth, per measure. The `is_error` row is expected to move most (regex gave 1.3% strict / ~7.5% loose).
- [ ] 7.3 Confirm or refute the headline findings — correction density ≈0.8% of user turns, grep-before-kb ≈69% of sessions, `isError` ≈3.5% of calls, red→green ≈9.7% of sessions, class balance ≈1:1. Record the corrected numbers; if any flips, say so plainly in the report and update the proposal's Why.
- [ ] 7.4 Re-run the contaminated detector alongside the correct one and publish both counts. If the corrected extractor does not reproduce the 5.2× gap on test invocations, the detector is still wrong.

## 8. Report

- [ ] 8.1 `report.md`: label densities, class balance, per-month and per-model breakdown, threshold in force, included/excluded/harness counts, bytes scanned, wall time.
- [ ] 8.2 Univariate correlation of each doctrine feature against the episode outcome label.
- [ ] 8.3 Mandatory header: observational, single-subject, non-stationary corpus; not causal; `scripts/ab-context` is the causal instrument. Test asserts the disclaimer is present whenever a correlation section is.

## 9. Performance

- [ ] 9.1 Stream per session; never hold the corpus in memory. Invoke `performance-optimization` with the full-corpus cold pass as the measured budget.
- [ ] 9.2 Assert and document a peak-RSS bound; print bytes scanned and elapsed time.

## 10. CLI, docs, ship

- [ ] 10.1 Add the `--step-table` path to `main.ts` with its flags. Dry-run stays the default posture of the CLI.
- [ ] 10.2 Update `packages/session-distiller/src/AGENTS.md` and `packages/session-distiller/AGENTS.md` with a row for `steptable.ts` (purpose, key exports, `See change: add-session-step-table`).
- [ ] 10.3 Delegate any `docs/` prose to `DocScribe` in caveman style; the main agent edits only the source-tree rows.
- [ ] 10.4 `npm test` green; run `review-code` on the diff before commit.

## 11. Retroactive recovery (bounded — do not over-invest)

- [ ] 11.1 Implement `log-reread` recovery only: scan forward within the episode for a call whose arguments reference the same log path, and parse a verdict from its result. Planning yield: 25/275 = 9.1%.
- [ ] 11.2 Do NOT implement re-execution-based recovery (checkout + re-run). It is blocked on `make-test-suite-deterministic`; a nondeterministic suite cannot reproduce a historical verdict, and a wrong recovered label is worse than a missing one.
- [ ] 11.3 Record but do not act on the two external channels (git commit → CI run for pushed SHAs; per-episode diff). Note them in the report as future work with their coarseness stated.

## 11b. Behavioural inference (red-only, stratified, abstaining)

- [ ] 11b.1 Feature `readLog` — a later call within the episode references the log path this invocation wrote. Planning measurement: P(readLog|red) 57.3% vs P(readLog|green) 3.4%, **lift 16.9**. This is the whole signal.
- [ ] 11b.2 Do NOT add `editSrc` / `editTest` / `readAny` as red features. Measured lifts 0.77 / 0.92 / 0.92 — the intuition "it failed so it edits code" is refuted by the data.
- [ ] 11b.3 Fit and evaluate with **session-level** k-fold CV (no session in both folds). Planning result: accuracy 76.5% vs 51.1% majority baseline, AUC 0.749, precision 94.6%, recall 57.3%.
- [ ] 11b.4 Emit `red` only above a threshold calibrated to ≥90% held-out precision; abstain otherwise. Never emit behavioural `green`. Use a **nested** split — threshold on an inner fold, precision on an outer fold never used for tuning.
- [ ] 11b.4a Set a minimum per-cell positive count below which the behavioural channel is **suppressed entirely**. Nesting fixes the methodology but not the sample: at a few dozen positives split across folds and eras, per-cell counts hit single digits and the interval spans most of [0,1]. Correct-but-useless statistics are their own failure mode.
- [ ] 11b.4b Report `readLog` lift separately per `doctrineEra`. The pre-fix `AGENTS.md` recipe *instructs* tee-then-grep, so the lift may reflect recipe compliance as much as failure investigation. State this as an unresolved confound — a post-fix collapse is consistent with the compliance explanation but does not establish it (C5 forbids the causal claim).
- [ ] 11b.4c **Falsification rule, decided in advance:** if the lift is present only in the era where the recipe mandated re-reading the log, the feature is dropped rather than emitted with a hedge. A stated confound is not a substitute for a decision rule.
- [ ] 11b.4d Fold **temporally**, not randomly. Random k-fold over one developer's sessions leaks era and learning effects across folds; nested CV corrects threshold overfit but not temporal leakage, so precision would still be overstated.
- [ ] 11b.4e The report must distinguish "suppressed (n below minimum)" from "no signal found". Suppression biases toward common signals, and silently collapsing the two hides exactly the rare failure modes worth studying.
- [ ] 11b.5 **Stratify by log availability.** 63.5% of directly-labelled invocations wrote a log, but only 28.8% of destroyed ones did. Pooling makes `readLog` unfireable on 71.2% of the target set and silently biases it toward green — the original false-green bug, reconstructed statistically. Fit and report per stratum.
- [ ] 11b.6 In the no-log stratum, the only usable feature is `rerun` (P(rerun|red) 66.7% vs P(rerun|green) 41.9%, lift 1.59) and the base rate is different (20.5% red vs 51.1% pooled). Pooling hid both facts. Expect low coverage here and accept it.
- [ ] 11b.7 Report combined recovery coverage, and state the overlap: behavioural-red and log-reread both require a log artifact, so their coverage is NOT additive.

## 12. Tests folded from test-plan.md (L1 — vitest, `packages/session-distiller/src/__tests__/`)

All rows are `automated` in the manifest. Harness exemplars are existing sibling tests in the same directory.

- [ ] 12.1 Inclusion threshold boundary: fixtures with 19/20/21 tool calls · run with default threshold 20 · 19 excluded, 20 and 21 included, report states threshold + 1 excluded. See `main.test.ts`. (test-plan #E1)
- [ ] 12.2 Threshold override: same fixtures · `--min-tool-calls 21` · only the 21-call session included. See `main.test.ts`. (test-plan #E2)
- [ ] 12.3 Scope filter: cwd = repo root / repo `.worktrees/os-x` / a sibling dir that merely prefixes the repo path / `/private/tmp` · extractor runs · first two included, other two excluded, excluded count 2. See `watermark.test.ts`. (test-plan #E3)
- [ ] 12.4 Missing cwd: session whose first line is a `message` not a `session` header · extractor runs · excluded and counted, not admitted via `buildTrajectory`'s `cwd = ""` default. See `trajectory.test.ts`. (test-plan #E4)
- [ ] 12.5 `isError` tri-state: results with `true` / `false` / absent property / no result at all · extractor runs · `true` / `false` / `null`+`errorFieldPresent=false` / `null`+`unpaired=true`, denominator counts only the first two. See `trajectory.test.ts`. (test-plan #E5)
- [ ] 12.6 Absent `isError` is not verified-good: episode whose terminal result omits the field · `episodeVerifiedGood` evaluated · returns not-verified-good, proving `!undefined` did not pass it. See `signals.test.ts`. (test-plan #E6)
- [ ] 12.7 Duplicate `toolCallId`: two results with the same id · trajectory built · row is `unpaired=true`, `is_error=null`, not a confident last-write-wins label. See `trajectory.test.ts`. (test-plan #E7)
- [ ] 12.8 Detector position: `write` whose content contains `npm test`; `bash` `echo npm test`; `bash` `npm test` · extractor runs · only the third counts. Regression against the 5.2× planning inflation. See `segment.test.ts`. (test-plan #E8)
- [ ] 12.9 Env-prefix and chaining: `CI=1 npm test -- --run`; `cd pkg && npx vitest run` · extractor runs · both count. See `segment.test.ts`. (test-plan #E9)
- [ ] 12.10 npm-script indirection: `npm run quality:changed` whose body contains `&& npm test` · extractor runs · classified per the documented rule, fixture pins which rule was chosen. See `segment.test.ts`. (test-plan #E10)
- [ ] 12.11 Interpreter is not a wrapper: `node scripts/split-large-agents.mjs` · extractor runs · no test invocation. See `segment.test.ts`. (test-plan #E11)
- [ ] 12.12 Arm exact match: cwd = arm A exactly / arm B path exactly / `.worktrees/os-fix-settings-mobile-layout` / unrelated · extractor runs · A, B (despite the deleted worktree), `null`+included, `null`. See `watermark.test.ts`. (test-plan #E12)
- [ ] 12.13 Checkout independence: `arms.json` holding another machine's absolute roots · extractor runs · arms still match by repo-relative suffix, no all-`null` collapse. See `watermark.test.ts`. (test-plan #E13)
- [ ] 12.14 Outcome ordering: verdict sequences [green,red] / [red,green] / [red] / none · labels computed · `red-only` / `red-green` / `red-only` / `no-signal`. See `signals.test.ts`. (test-plan #E14)
- [ ] 12.15 Destroyed verdict never green: failing run piped to `tee` without `pipefail`, `isError:false`, no summary line · labels computed · `verdictObservable=false`, episode `unobservable`. See `signals.test.ts`. (test-plan #E15)
- [ ] 12.16 Empty grep is not green: test run piped to `grep FAIL` with zero output · labels computed · verdict stays unobservable. See `signals.test.ts`. (test-plan #E16)
- [ ] 12.17 Doctrine era split: sessions before and after the pinned boundary · extractor runs · distinct `doctrineEra`, every outcome statistic broken down by it. See `main.test.ts`. (test-plan #E17)
- [ ] 12.18 Schema completeness: any fixture corpus · extractor runs · every step row carries the full pinned field set incl. `errorFieldPresent`/`verdictObservable`/`labelSource`/`extractorVersion`/`doctrineEra`; every episode row carries its pinned set. See `trajectory.test.ts`. (test-plan #E18)
- [ ] 12.19 pathKey behaviour: two paths sharing a basename; the same path twice · two runs · stable across runs, distinct across paths, normalisation pinned by fixture. See `segment.test.ts`. (test-plan #E19)
- [ ] 12.20 Total row order: two sessions with identical second-granularity `startedAt` · two runs · byte-identical output, ties broken by `sessionId`+`stepIndex`. See `watermark.test.ts`. (test-plan #E20)
- [ ] 12.21 Version mismatch: output dir at version N · run at N+1 · refuses to append, full re-extract, no mixed-version rows. See `watermark.test.ts`. (test-plan #E21)
- [ ] 12.22 Version-keyed store: store at version N with unchanged `(path,size,mtime)` · run at N+1 · prior rows not reused despite matching tuples. See `watermark.test.ts`. (test-plan #E22)
- [ ] 12.23 Out-of-order session: file whose filename timestamp precedes the watermark · incremental run · extracted, not permanently skipped by the strict `>`. See `watermark.test.ts`. (test-plan #E23)
- [ ] 12.24 No borrowed verdicts: destroyed invocation followed by a different readable test run · labels computed · stays `unobservable`. Regression against the 71.1% planning error. See `signals.test.ts`. (test-plan #E24)
- [ ] 12.25 Prose excluded: destroyed invocation followed by "all tests pass" · labels computed · no label from prose. See `signals.test.ts`. (test-plan #E25)
- [ ] 12.26 Direct wins: invocation with both a readable verdict and behavioural signals · labels computed · `labelSource=direct`, inference not applied. See `signals.test.ts`. (test-plan #E26)
- [ ] 12.27 Never behavioural green: destroyed invocation with no inspection, re-run, or edits · inference runs · stays `unobservable`, no `green` at any confidence. See `signals.test.ts`. (test-plan #E27)
- [ ] 12.28 Unavailable ≠ 0: destroyed invocation whose command wrote no log · inference runs · `readLog` unavailable, scored by the no-log stratum or abstained. See `signals.test.ts`. (test-plan #E28)
- [ ] 12.29 Cold-pass bound: frozen fixture corpus incl. one deliberately large session · timed run · peak RSS below the stated bound (blocked on C1). See `main.test.ts`. (test-plan #P1)
- [ ] 12.30 Manifest required: `arms.json` missing/unreadable · extractor runs · aborts explicitly, no silent all-unset `harnessArm`. See `main.test.ts`. (test-plan #X1)
- [ ] 12.31 Malformed lines: session with 3 unparseable lines among valid ones · extractor runs · valid events extracted, malformed count reported, no crash. See `jsonl-reader.test.ts`. (test-plan #X2)
- [ ] 12.32 Planted-secret scan: fixture with an `auth.json`-shaped token, a `/Users/...` path, a file body, a raw command · extractor runs · none appear in any output, asserted by content scan independent of the determinism hash. See `main.test.ts`. (test-plan #X3)
- [ ] 12.33 Emitter guard: a row field assigned a long non-enum, non-hash string · emit attempted · fails loudly, row not written, not truncated. See `route.test.ts`. (test-plan #X4)
- [ ] 12.34 mtime churn: fixture corpus with all mtimes reset · incremental run · full re-extract, no stale rows reused. See `watermark.test.ts`. (test-plan #X5)
- [ ] 12.35 Determinism: frozen fixture corpus · two runs plus a committed hash · identical to each other and to the committed hash. See `main.test.ts`. (test-plan #X6)
- [ ] 12.36 Disclaimer present: report containing a correlation section · report generated · confounding disclaimer present and `scripts/ab-context` named; correlation without disclaimer fails. See `distill.test.ts`. (test-plan #R1)
- [ ] 12.37 Suppressed ≠ no-signal: behavioural cell below the minimum · report generated · reads "suppressed (n<min)", never "no signal" (blocked on C2). See `distill.test.ts`. (test-plan #R2)
- [ ] 12.38 Detector accuracy: committed hand-labelled command-string sample · report generated · detector precision and recall appear in the report. See `distill.test.ts`. (test-plan #R3)
- [ ] 12.39 Baseline reconciliation: frozen fixture corpus · report generated · contaminated vs corrected detector counts tabled; failure to reproduce the ~5.2× gap on the fixture fails the check. See `main.test.ts`. (test-plan #R4)

## 13. Fixture infrastructure (prerequisite for 12.20 / 12.23 / 12.29 / 12.35 / 12.39)

- [ ] 13.1 Commit a **frozen fixture session corpus** under `packages/session-distiller/src/__tests__/fixtures/`. The live sessions directory grows daily and cannot produce a stable hash, so the determinism contract is untestable without this. Include one deliberately large session for the RSS bound.
- [ ] 13.2 Commit a **hand-labelled command-string sample** for scoring the test-invocation detector. Prerequisite for task 12.38.

## 14. QA / manual

- [ ] 14.1 Full cold extract over the real ~2,264 in-scope sessions (~1.2 GB, unavailable in CI) · single local run · wall time, bytes scanned and peak RSS reported. (test-plan: manual-only)
- [ ] 14.2 Read `report.md` looking for a doctrine feature whose correlation with `red-green` is large enough to be worth an ab-context arm — that candidate is the handoff to the next change. Human judgment, no automatable observable. (test-plan: manual-only)
