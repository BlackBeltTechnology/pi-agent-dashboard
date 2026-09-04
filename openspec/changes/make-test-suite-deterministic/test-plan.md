# Test Plan — make-test-suite-deterministic

Stage: proposal/design · Generated: 2026-08-05 · Amended: 2026-08-01 (approved scope amendment)

Gate: HARD — resolved. Two slots were unfillable and were answered before writing:
the 3-consecutive-run gate executes **locally by the implementer** (→ `manual-only`),
and the fixed-tick guard ships as **script + CI step + vitest wrapper**, mirroring
`check-skill-frontmatter.mjs` (→ `L1` for the wrapper, `ci` for the step).

**Amendment:** defect-A rows (E1–E9, X1–X4 — skill-frontmatter gitignore exclusion)
were REMOVED: the defect was already fixed by `71ea6e593` before implementation
started (evidence: `SHIP_IT_BLOCKED.md`). Folded-test pointers for new suites were
repinned to `scripts/__tests__/fixed-tick-waits.test.mjs` and
`scripts/__tests__/vitest-workers.test.ts`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E10 | Fixed-tick barrier is rejected | EP (invalid partition) | L1 | automated | fixture test file containing `await new Promise((r) => setTimeout(r, 0));` in test-body scope followed by `expect(...)` | the guard's analyze fn | returns 1 violation naming the fixture file and line |
| E11 | Deliberate timer opts out per occurrence | EP (valid partition) | L1 | automated | fixture with the opt-out comment on the line directly above the awaited timer | the guard's analyze fn | returns 0 violations |
| E12 | File-level opt-out does not waive later violations | BVA (2nd occurrence) | L1 | automated | fixture with one annotated occurrence AND one un-annotated barrier later in the same file | the guard's analyze fn | returns exactly 1 violation, naming the un-annotated line only |
| E13 | Client suite compliant when guard lands | census | L1 | automated | the real `packages/client/src` tree at merge commit | the guard's analyze fn over the client suite | returns 0 violations |
| E14 | Guard hard-fails, not warns | exit-code | ci | automated | a fixture tree containing one un-annotated barrier | `node scripts/check-fixed-tick-waits.mjs <fixture>` | exit code non-zero and the file is named on stderr |
| E15 | Worker target single source of truth | census | L1 | automated | all `vitest.config.ts` under `packages/*` + `scripts/` | static scan for a `maxWorkers` literal other than `1` | 0 configs restate the parallel target as a literal |
| E16 | Deliberately serial projects stay serial | decision-table (7 rows) | L1 | automated | the 7 serial configs — `electron`, `image-fit-extension`, `kb-extension`, `mockup-loop`, `nano-banana`, `video-production`, `video-transcription` | static scan | each declares `maxWorkers: 1` explicitly AND does not import the shared worker module |
| E17 | Adopting the module adds no dependency edge | invariant | L1 | automated | every `vitest.config.ts` importing the worker module | static scan of import specifiers + `package.json` references | all imports are relative; no `package.json` references the module; no new workspace edge |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Consolidation changes no effective worker count | A/B equality | L1 | automated | every project config, resolved after adoption vs the pre-change census (task 1.3) | parallel configs resolve to the shared target; serial to `1` — equal, not merely similar | single resolution pass |
| P2 | Suite stays non-flaky under contention | soak (3 consecutive full runs) | — | manual-only | full `npm test` on a loaded developer machine, 3 times | 3/3 exit 0 | ~15 min, run by the implementer |
| P3 | Guard cost is negligible | threshold | L1 | automated | the real client suite | guard analyze wall-clock | < 2 s |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | FileReader paste assertions poll | state-convergence | L1 | automated | paste event carrying 2 `image/png` blobs | `handlePaste` under an artificially delayed `FileReader` (decode resolved on a later macrotask than the old 2-tick barrier) | `pendingImages` converges to length 2 via `waitFor`; no dependence on tick count |
| F2 | Converted tests preserve behaviour | A/B equivalence | L1 | automated | each of the 10 converted files | test-id census at merge-base vs converted | same test ids, same count; no assertion added or removed |
| F3 | Mock-internal yield is preserved | state-transition (illegal edge) | L1 | automated | `PairLanding.test.tsx` with its `postJson` mock yield intact | the pairing poll → approved transition | phase converges `polling → done`, confirm-code render committed; the awaited timer + its opt-out annotation are still present in the file |
| F4 | Client async assertion polls, not ticks | state-convergence | L1 | covered | any converted file's async effect | run with `maxWorkers` forced high on a loaded box | no `expected … got 0` one-shot race; assertions resolve within `asyncUtilTimeout` — covered by the `waitFor` conversion itself plus the P2 3-run gate; no dedicated test |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X5 | Standalone CI step and vitest wrapper agree | consistency | ci | automated | the real repo | run `node scripts/check-fixed-tick-waits.mjs` and the vitest wrapper | identical violation sets; identical pass/fail verdict |

---

## Coverage summary

- Requirements covered: 1/1 remaining delta scenario set (parallel-test-execution)
- Scenarios by class: edge 8 · perf 3 · frontend 4 · error 1 — **16 total** (was 29 pre-amendment)
- Scenarios by level: L1 13 · ci 2 · manual-only 1 (P2) · covered-by-construction 1 (F4)
- Scenarios by disposition: automated 14 · manual-only 1 · covered 1

No L2/L3 rows: this change touches only test tooling and test sources. Nothing
alters a rendered surface, an installed artifact, or a runtime process, so a
Playwright or qa-VM scenario would assert nothing this change can break.

## New infra needed

- `scripts/check-fixed-tick-waits.mjs` + its CI step + a vitest wrapper —
  mirroring the existing `check-skill-frontmatter.mjs` triple. Chosen at the
  HARD gate; not a new *level*, an additional guard in the existing `ci` + `L1`
  tiers.
- A repo-root `vitest.workers.ts` worker-target module imported by relative path
  from every parallel vitest config.
