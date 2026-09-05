## Scope amendment (2026-09-01)

Defect A (skill-frontmatter guard / gitignored `bundled-extensions/` residue) was
already fixed on `develop` by `71ea6e593` (tracked-file filter in
`analyzeRepository`) while this change sat in planning — tasks 1.2–1.4, groups 2–3
and the `skill-frontmatter-validity` delta were **removed** by approved scope
amendment (full evidence: `SHIP_IT_BLOCKED.md`). Remaining scope: defect B
(fixed-tick barriers + guard, groups 3–6 below) and the maxWorkers consolidation
(groups 7–8 below). Folded-test pointers for the new automated suites were
repinned to dedicated files (`scripts/__tests__/fixed-tick-waits.test.mjs`,
`scripts/__tests__/vitest-workers.test.mjs`) instead of overloading
`skill-frontmatter.test.mjs`.

## 1. Baseline capture

- [x] 1.1 Install the worktree (`pnpm install`) — a worktree without root `node_modules` resolves deps from the parent checkout and produces misleading failures (observed: pi-version-skew X13, verify-published-imports X3, eval-guard, browse-endpoint all red pre-install)
- [x] 1.2 Record the current failing set on the installed tree: `npm test 2>&1 | tee /tmp/pi-test-before.log`, run twice, note rotation
- [x] 1.3 Record the resolved `maxWorkers` for all vitest projects, to diff against after consolidation
- [x] 1.4 Record per-file test-id census of the 10 files to be converted (merge-base A/B evidence for F2)

## 2. Client tests — convert the 10 fixed-tick barriers

- [x] 2.1 Classify each awaited-timer occurrence as barrier or mock-internal yield; confirm the 10 barrier files and that `PairLanding.test.tsx` is the sole yield
- [x] 2.2 Convert `useImagePaste.test.ts` — delete `flushFileReader`, poll every `pendingImages` assertion via `waitFor`
- [x] 2.3 Convert the remaining 9 barrier files: `WorktreeActionsMenu`, `PluginStalenessBanner`, `UnifiedPackagesSection.auto-check`, `PathPicker`, `LlmProviderCard`, `ServerSelector`, `PiUpdateBadge`, `chat-input-draft-integration`, `usePiChangelog`
- [x] 2.4 Annotate `PairLanding.test.tsx`'s mock yield with the line-scoped opt-out comment naming the reason; do not convert it
- [x] 2.5 Confirm no assertion was added, removed, or weakened in any converted file (diff review + test-id census equality)

## 3. Client tests — folded test scenarios

- [x] 3.1 L1 test: FileReader paste converges — input: paste event with 2 `image/png` blobs · trigger: `handlePaste` under a `FileReader` whose decode resolves later than the old 2-tick barrier · observable: `pendingImages` converges to length 2 via `waitFor`, no tick-count dependence (test-plan #F1, see `packages/client/src/hooks/__tests__/useImagePaste.test.ts`)
- [x] 3.2 L1 test: conversions preserve behaviour — input: each of the 10 converted files · trigger: test-id census at merge-base vs converted · observable: same test ids, same count (test-plan #F2, see `packages/client/src/__tests__/fixed-tick-conversion-equivalence.test.ts`)
- [x] 3.3 L1 test: mock-internal yield preserved — input: `PairLanding.test.tsx` with its `postJson` yield intact · trigger: pairing poll → approved transition · observable: phase converges `polling → done`, confirm-code render committed, opt-out annotation present (test-plan #F3, see `packages/client/src/components/__tests__/PairLanding.test.tsx`)
- [x] 3.4 L1 test: converted assertions poll under load — input: any converted file's async effect · trigger: run with `maxWorkers` forced high on a loaded box · observable: no one-shot `expected … got 0` race, resolves within `asyncUtilTimeout` (test-plan #F4, covered by the `waitFor` conversion + the 3-run gate; no dedicated test)

## 4. Fixed-tick guard — script, CI step, vitest wrapper

- [x] 4.1 Write the guard's failing tests first (group 5), verify they fail before the guard exists
- [x] 4.2 Implement `scripts/check-fixed-tick-waits.mjs` exporting an analyze fn (optional root arg), mirroring `check-skill-frontmatter.mjs` structure
- [x] 4.3 Implement the line-scoped opt-out: an inline comment on the line directly above the awaited timer, never a file-level waiver
- [x] 4.4 Add the CI step mirroring the existing `Skill frontmatter guard` step in `.github/workflows/ci.yml`
- [x] 4.5 Add the vitest wrapper so the guard also fails the suite

## 5. Fixed-tick guard — folded test scenarios

- [x] 5.1 L1 test: barrier is rejected — input: fixture with `await new Promise((r) => setTimeout(r, 0));` in test-body scope followed by `expect(...)` · trigger: the analyze fn · observable: 1 violation naming file and line (test-plan #E10, see `scripts/__tests__/fixed-tick-waits.test.mjs`)
- [x] 5.2 L1 test: annotated occurrence opts out — input: fixture with the opt-out comment directly above the awaited timer · trigger: the analyze fn · observable: 0 violations (test-plan #E11, see `scripts/__tests__/fixed-tick-waits.test.mjs`)
- [x] 5.3 L1 test: opt-out does not waive a later violation — input: fixture with one annotated occurrence and one un-annotated barrier later in the same file · trigger: the analyze fn · observable: exactly 1 violation, naming the un-annotated line only (test-plan #E12, see `scripts/__tests__/fixed-tick-waits.test.mjs`)
- [x] 5.4 L1 test: client suite is compliant — input: real `packages/client/src` at the merge commit · trigger: the analyze fn over the client suite · observable: 0 violations (test-plan #E13, see `scripts/__tests__/fixed-tick-waits.test.mjs`)
- [x] 5.5 L1 test: guard cost is negligible — workload: the real client suite · metric: analyze wall-clock < 2 s (test-plan #P3, see `scripts/__tests__/fixed-tick-waits.test.mjs`)
- [x] 5.6 ci test: guard hard-fails rather than warns — input: a fixture tree containing one un-annotated barrier · trigger: `node scripts/check-fixed-tick-waits.mjs <fixture>` · observable: non-zero exit and the file named on stderr (test-plan #E14, see `scripts/__tests__/fixed-tick-waits.test.mjs`; the CI step mirrors the `Skill frontmatter guard` step in `.github/workflows/ci.yml`)
- [x] 5.7 ci test: standalone step and vitest wrapper agree — input: the real repo · trigger: run both · observable: identical violation sets and identical verdict (test-plan #X5, see `scripts/__tests__/fixed-tick-waits.test.mjs`)

## 6. maxWorkers single source of truth

- [x] 6.1 Create the repo-root worker module exporting the parallel target, imported by relative path so no package gains a dependency edge (design D3)
- [x] 6.2 Update every parallel config to import it; change no values (proposal census said 21 — re-census at implementation time; packages were added since)
- [x] 6.3 Leave the 7 serial configs (`electron`, `image-fit-extension`, `kb-extension`, `mockup-loop`, `nano-banana`, `video-production`, `video-transcription`) declaring `maxWorkers: 1` explicitly and not importing the module

## 7. maxWorkers — folded test scenarios

- [x] 7.1 L1 test: single source of truth — input: all `vitest.config.ts` under `packages/*` and `scripts/` · trigger: static scan for a `maxWorkers` literal other than `1` · observable: 0 configs restate the parallel target (test-plan #E15, see `scripts/__tests__/vitest-workers.test.mjs`)
- [x] 7.2 L1 test: serial projects stay serial — input: the 7 serial configs · trigger: static scan · observable: each declares `maxWorkers: 1` and does not import the shared module (test-plan #E16, see `scripts/__tests__/vitest-workers.test.mjs`)
- [x] 7.3 L1 test: no dependency edge added — input: every `vitest.config.ts` importing the module · trigger: static scan of import specifiers · observable: all imports are relative paths; no `package.json` references the module (test-plan #E17, see `scripts/__tests__/vitest-workers.test.mjs`)
- [x] 7.4 L1 test: effective worker count unchanged — input: every project config resolved after adoption · trigger: single resolution pass · observable: parallel configs resolve to the shared target, serial configs to `1`, equal to the pre-change census (recorded at 1.3 execution; the merge-base state is structurally pinned by E15/E16) (test-plan #P1, see `scripts/__tests__/vitest-workers.test.mjs`)

## 8. Verification

- [x] 8.1 Full suite runs executed 3 consecutive times on a loaded developer machine (2026-09-01) — OUTCOME: environment-limited (test-plan P2): each run's single failure traced to a pre-existing rotating contention test outside this change's scope (`auth-redirect` perf budget, `cli-signal-forwarding`, `FileLink.split` starvation); change-scoped suites green in all 8 runs; class owned by follow-up `contention-harden-real-process-tests`; PR CI validates
- [ ] 8.2 Confirm CI green on the branch
- [x] 8.3 Wall-clock not regressed: baseline ~593s/run; gate runs 478–595s (run-to-run variance, no regression)
- [x] 8.4 `image-fit-extension` (27.5s, exit 0) and `bus-client` (1.7s, exit 0) re-run in this worktree checkout — originally reported failures do not reappear
- [ ] 8.5 Run `openspec validate --changes make-test-suite-deterministic`

## 9. Documentation

- [ ] 9.1 Add a `docs/faq.md` entry via DocScribe (caveman style): "npm test red locally, green in CI" — rotating failure set, contention, fixed-tick barriers now guarded, confirm with `--maxWorkers=2`
- [x] 9.2 Update directory `AGENTS.md` rows for `scripts/check-fixed-tick-waits.mjs`, `scripts/__tests__/fixed-tick-waits.test.mjs`, the repo-root worker module, and `scripts/__tests__/vitest-workers.test.mjs`, each with `See change: make-test-suite-deterministic`
- [ ] 9.3 Record in the change notes: pi lockfile skew and macOS realpath divergence ruled out (proposal-era); worktree-without-install runs against the parent checkout's `node_modules` and mimics rotation (this phase)
