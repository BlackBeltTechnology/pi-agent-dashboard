# Test Plan — make-test-suite-deterministic

Stage: proposal/design   Generated: 2026-08-05

Gate: HARD — resolved. Two slots were unfillable and were answered before writing:
the 3-consecutive-run gate executes **locally by the implementer** (→ `manual-only`),
and the fixed-tick guard ships as **script + CI step + vitest wrapper**, mirroring
`check-skill-frontmatter.mjs` (→ `L1` for the wrapper, `ci` for the step).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Gitignored residue never collected | EP (ignored partition) | L1 | automated | repo tree containing `packages/electron/resources/bundled-extensions/**/SKILL.md` (13 files) on disk | `collectSkillManifests(REPO_ROOT)` | returned array contains 0 paths under `bundled-extensions/`; total count equals the count with the directory absent |
| E2 | Gitignored dir with unlisted name | EP (name-independence) | L1 | automated | fixture repo with `.gitignore` line `generated-x/` and `generated-x/s/SKILL.md` | `collectSkillManifests(fixtureRoot)` | `generated-x/s/SKILL.md` NOT in result, with no edit to `SKIP_DIRS` |
| E3 | Untracked-but-not-ignored still checked | EP (valid partition) | L1 | automated | fixture repo with untracked `packages/p/.pi/skills/new/SKILL.md`, matched by no ignore rule | `collectSkillManifests(fixtureRoot)` | path IS in result |
| E4 | Degraded mode retains basename exclusion | decision-table (git×basename) | L1 | automated | fixture with `dist/s/SKILL.md`, `.worktrees/w/s/SKILL.md`, `node_modules/n/SKILL.md`, and a gitignored `generated-x/s/SKILL.md`; git-ignore probe forced to fail | `collectSkillManifests(fixtureRoot)` | `dist`, `.worktrees`, `node_modules` paths excluded; `generated-x` path IS collected (documented degradation); result length > 0; no throw |
| E5 | Single batched git invocation | counting | L1 | automated | fixture repo with 40 `SKILL.md` across 12 directories | `collectSkillManifests` with the git spawn stubbed and call-counted | spawn call count === 1 |
| E6 | Path normalization | EP (separator) | L1 | automated | `"packages\\electron\\resources\\x\\SKILL.md"` | the exported normalization fn | returns `"packages/electron/resources/x/SKILL.md"` (asserted directly, so it is covered on posix CI) |
| E7 | Guard output unchanged vs fresh checkout | A/B equivalence | L1 | automated | the real repo, `bundled-extensions/` present | `analyzeRepository()` | `findings` identical (deep-equal) to the run with `bundled-extensions/` moved aside |
| E8 | Repo is error-free (existing, must stay green) | regression | L1 | automated | real repo, `bundled-extensions/` present on disk | existing `has no budget warning outside the exempt skills` test | `overBudget` === `[]` |
| E9 | All skill manifests parse (existing) | regression | L1 | automated | real repo | existing YAML-parse assertion over collected manifests | every collected manifest parses; 0 errors |
| E10 | Fixed-tick barrier is rejected | EP (invalid partition) | L1 | automated | fixture test file containing `await new Promise((r) => setTimeout(r, 0));` in test-body scope followed by `expect(...)` | the guard's analyze fn | returns 1 violation naming the fixture file and line |
| E11 | Deliberate timer opts out per occurrence | EP (valid partition) | L1 | automated | fixture with the opt-out comment on the line directly above the awaited timer | the guard's analyze fn | returns 0 violations |
| E12 | File-level opt-out does not waive later violations | BVA (2nd occurrence) | L1 | automated | fixture with one annotated occurrence AND one un-annotated barrier later in the same file | the guard's analyze fn | returns exactly 1 violation, naming the un-annotated line only |
| E13 | Client suite compliant when guard lands | census | L1 | automated | the real `packages/client/src` tree at merge commit | the guard's analyze fn over the client suite | returns 0 violations |
| E14 | Guard hard-fails, not warns | exit-code | ci | automated | a client tree containing one un-annotated barrier | `node scripts/check-fixed-tick-waits.mjs` | exit code non-zero and the file is named on stderr |
| E15 | Worker target single source of truth | census | L1 | automated | all 28 `vitest.config.ts` under `packages/*` + `scripts/` | static scan for a `maxWorkers` literal other than `1` | 0 configs restate the parallel target as a literal |
| E16 | Deliberately serial projects stay serial | decision-table (7 rows) | L1 | automated | the 7 serial configs — `electron`, `image-fit-extension`, `kb-extension`, `mockup-loop`, `nano-banana`, `video-production`, `video-transcription` | static scan | each declares `maxWorkers: 1` explicitly AND does not import the shared worker module |
| E17 | Adopting the module adds no dependency edge | invariant | L1 | automated | every `package.json` whose `vitest.config.ts` imports the worker module | diff of `dependencies` + `devDependencies` vs the merge-base | no added entries; no new workspace edge |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Consolidation changes no effective worker count | A/B equality | L1 | automated | every project config, resolved before and after the module is adopted | resolved `maxWorkers` per project is **equal**, not merely similar | single resolution pass |
| P2 | Suite stays non-flaky under contention | soak (3 consecutive full runs) | — | manual-only | full `npm test` on a loaded developer machine, 3 times | 3/3 exit 0 | ~15 min, run by the implementer |
| P3 | Guard cost is negligible | threshold | L1 | automated | the real client suite | guard analyze wall-clock | < 2 s |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | FileReader paste assertions poll | state-convergence | L1 | automated | paste event carrying 2 `image/png` blobs | `handlePaste` under an artificially delayed `FileReader` (decode resolved on a later macrotask than the old 2-tick barrier) | `pendingImages` converges to length 2 via `waitFor`; no dependence on tick count |
| F2 | Converted tests preserve behaviour | A/B equivalence | L1 | automated | each of the 10 converted files | run at merge-base vs converted | same test ids, same count, same pass set; no assertion added or removed |
| F3 | Mock-internal yield is preserved | state-transition (illegal edge) | L1 | automated | `PairLanding.test.tsx` with its `postJson` mock yield intact | the pairing poll → approved transition | phase converges `polling → done`, confirm-code render committed; the awaited timer at line 54 is still present in the file |
| F4 | Client async assertion polls, not ticks | state-convergence | L1 | automated | any converted file's async effect | run with `maxWorkers` forced high on a loaded box | no `expected … got 0` one-shot race; assertions resolve within `asyncUtilTimeout` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Guard degrades safely without git | fault-injection (abort) | L1 | automated | `git` binary absent from PATH | `collectSkillManifests(REPO_ROOT)` | no throw; returns > 0 manifests; basename exclusions still applied |
| X2 | Guard degrades safely on git error | fault-injection (non-zero exit) | L1 | automated | `git check-ignore` stubbed to exit 128 with stderr | `collectSkillManifests(REPO_ROOT)` | no throw; every candidate treated as not-ignored; basename prune intact |
| X3 | Git stall does not hang the guard | fault-injection (delay) | L1 | automated | `git check-ignore` stubbed to stall beyond the guard's budget | `collectSkillManifests(REPO_ROOT)` | guard falls back to degraded mode rather than hanging the run |
| X4 | Guard survives an unreadable file | fault-injection (EACCES) | L1 | automated | a `SKILL.md` whose read throws `EACCES` | `analyzeRepository()` | that file is reported as an error finding; the walk completes; other findings unaffected |
| X5 | Standalone CI step and vitest wrapper agree | consistency | ci | automated | the real repo | run `node scripts/check-fixed-tick-waits.mjs` and the vitest wrapper | identical violation sets; identical pass/fail verdict |

---

## Coverage summary

- Requirements covered: 17/17 delta scenarios (8 skill-frontmatter, 9 parallel-test-execution)
- Scenarios by class: edge 17 · perf 3 · frontend 4 · error 5 — **29 total**
- Scenarios by level: L1 25 · L2 0 · L3 0 · ci 2 · manual-only 1 · (P1 counted in L1)
- Scenarios by disposition: automated 28 · manual-only 1

No L2/L3 rows: this change touches only test tooling and test sources. Nothing
alters a rendered surface, an installed artifact, or a runtime process, so a
Playwright or qa-VM scenario would assert nothing this change can break.

## New infra needed

- `scripts/check-fixed-tick-waits.mjs` + its CI step + a vitest wrapper —
  mirroring the existing `check-skill-frontmatter.mjs` triple. Chosen at the
  HARD gate; not a new *level*, an additional guard in the existing `ci` + `L1`
  tiers.
- A git-spawn seam in `check-skill-frontmatter.mjs` so E5/X1/X2/X3 can stub and
  count invocations without manipulating PATH.
