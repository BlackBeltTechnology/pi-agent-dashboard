## 1. Baseline capture

- [ ] 1.1 Record the current failing set: `npm test 2>&1 | tee /tmp/pi-test-before.log`, run twice, and note that the failing files differ between runs
- [ ] 1.2 Record `node scripts/check-skill-frontmatter.mjs` output while `packages/electron/resources/bundled-extensions/` is present on disk (expect 2 warnings, 80 checked)
- [ ] 1.3 Record the resolved `maxWorkers` for all 28 vitest projects, to diff against after consolidation
- [ ] 1.4 Confirm `packages/electron/resources/bundled-extensions/` is stale residue, not regenerated — no build step writes it (`forge.config.ts:109`)

## 2. Skill-frontmatter guard — git-ignore exclusion layer

- [ ] 2.1 Add a git-spawn seam to `scripts/check-skill-frontmatter.mjs` so tests can stub and count `git check-ignore` invocations without PATH manipulation
- [ ] 2.2 Export the path-normalization function so it is directly unit-testable
- [ ] 2.3 Write the failing tests for group 3 first, verify they fail against the current implementation
- [ ] 2.4 Implement: keep `SKIP_DIRS` as the descent prune, add a single batched `git check-ignore --stdin` filter over collected candidates, posix-normalize paths before passing them to git, and fall back to prune-only on any git failure (design D1)
- [ ] 2.5 Verify the existing 24 assertions in `scripts/__tests__/skill-frontmatter.test.mjs` still pass

## 3. Skill-frontmatter guard — folded test scenarios

- [ ] 3.1 L1 test: gitignored residue never collected — input: repo tree with 13 `SKILL.md` under `bundled-extensions/` on disk · trigger: `collectSkillManifests(REPO_ROOT)` · observable: 0 returned paths under `bundled-extensions/`, total equals the count with the dir absent (test-plan #E1, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 3.2 L1 test: gitignored dir with an unlisted basename — input: fixture with `.gitignore` line `generated-x/` and `generated-x/s/SKILL.md` · trigger: `collectSkillManifests(fixtureRoot)` · observable: path absent from result with no `SKIP_DIRS` edit (test-plan #E2, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 3.3 L1 test: untracked-but-not-ignored is still checked — input: fixture with untracked `packages/p/.pi/skills/new/SKILL.md` matched by no ignore rule · trigger: `collectSkillManifests(fixtureRoot)` · observable: path present in result (test-plan #E3, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 3.4 L1 test: degraded mode retains basename exclusion — input: fixture with `dist/`, `.worktrees/`, `node_modules/` and gitignored `generated-x/` manifests, git probe forced to fail · trigger: `collectSkillManifests(fixtureRoot)` · observable: first three excluded, `generated-x` collected, length > 0, no throw (test-plan #E4, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 3.5 L1 test: exactly one batched git invocation — input: fixture with 40 manifests across 12 dirs · trigger: `collectSkillManifests` with the git spawn stubbed and counted · observable: spawn count === 1 (test-plan #E5, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 3.6 L1 test: path normalization — input: `"packages\\electron\\resources\\x\\SKILL.md"` · trigger: the exported normalization fn · observable: returns the posix-separated path, asserted directly so it is covered on posix CI (test-plan #E6, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 3.7 L1 test: output identical to a fresh checkout — input: real repo with `bundled-extensions/` present · trigger: `analyzeRepository()` · observable: `findings` deep-equals the run with the directory moved aside (test-plan #E7, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 3.8 L1 test: repo is error-free with residue present — input: real repo, `bundled-extensions/` on disk · trigger: existing `has no budget warning outside the exempt skills` · observable: `overBudget` === `[]` (test-plan #E8, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 3.9 L1 test: all collected manifests parse — input: real repo · trigger: YAML-parse assertion over collected manifests · observable: 0 parse errors (test-plan #E9, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 3.10 L1 test: git absent from PATH — fault: no `git` binary · trigger: `collectSkillManifests(REPO_ROOT)` · observable: no throw, > 0 manifests, basename exclusions still applied (test-plan #X1, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 3.11 L1 test: git exits non-zero — fault: `git check-ignore` stubbed to exit 128 · trigger: `collectSkillManifests(REPO_ROOT)` · observable: no throw, all candidates treated as not-ignored, prune intact (test-plan #X2, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 3.12 L1 test: git stalls — fault: `git check-ignore` stubbed to exceed the guard's budget · trigger: `collectSkillManifests(REPO_ROOT)` · observable: falls back to degraded mode rather than hanging (test-plan #X3, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 3.13 L1 test: unreadable manifest — fault: a `SKILL.md` read throws `EACCES` · trigger: `analyzeRepository()` · observable: reported as an error finding, walk completes, other findings unaffected (test-plan #X4, see `scripts/__tests__/skill-frontmatter.test.mjs`)

## 4. Client tests — convert the 10 fixed-tick barriers

- [ ] 4.1 Classify each of the 11 awaited-timer occurrences as barrier or mock-internal yield; confirm exactly 10 barriers and that `PairLanding.test.tsx:54` is the sole yield
- [ ] 4.2 Convert `useImagePaste.test.ts` — delete `flushFileReader`, poll every `pendingImages` assertion via `waitFor`
- [ ] 4.3 Convert the remaining 9 barrier files: `WorktreeActionsMenu`, `PluginStalenessBanner`, `UnifiedPackagesSection.auto-check`, `PathPicker`, `LlmProviderCard`, `ServerSelector`, `PiUpdateBadge`, `chat-input-draft-integration`, `usePiChangelog`
- [ ] 4.4 Annotate `PairLanding.test.tsx:54` with the line-scoped opt-out comment naming the reason; do not convert it
- [ ] 4.5 Confirm no assertion was added, removed, or weakened in any converted file

## 5. Client tests — folded test scenarios

- [ ] 5.1 L1 test: FileReader paste converges — input: paste event with 2 `image/png` blobs · trigger: `handlePaste` under a `FileReader` whose decode resolves later than the old 2-tick barrier · observable: `pendingImages` converges to length 2 via `waitFor`, no tick-count dependence (test-plan #F1, see `packages/client/src/hooks/__tests__/useImagePaste.test.ts`)
- [ ] 5.2 L1 test: conversions preserve behaviour — input: each of the 10 converted files · trigger: run at merge-base vs converted · observable: same test ids, same count, same pass set (test-plan #F2, see `packages/client/src/hooks/__tests__/useImagePaste.test.ts`)
- [ ] 5.3 L1 test: mock-internal yield preserved — input: `PairLanding.test.tsx` with its `postJson` yield intact · trigger: pairing poll → approved transition · observable: phase converges `polling → done`, confirm-code render committed, timer still present at line 54 (test-plan #F3, see `packages/client/src/components/__tests__/PairLanding.test.tsx`)
- [ ] 5.4 L1 test: converted assertions poll under load — input: any converted file's async effect · trigger: run with `maxWorkers` forced high on a loaded box · observable: no one-shot `expected … got 0` race, resolves within `asyncUtilTimeout` (test-plan #F4, see `packages/client/src/hooks/__tests__/useImagePaste.test.ts`)

## 6. Fixed-tick guard — script, CI step, vitest wrapper

- [ ] 6.1 Write the guard's failing tests first (group 7), verify they fail before the guard exists
- [ ] 6.2 Implement `scripts/check-fixed-tick-waits.mjs` exporting an analyze fn, mirroring `check-skill-frontmatter.mjs` structure
- [ ] 6.3 Implement the line-scoped opt-out: an inline comment on the line directly above the awaited timer, never a file-level waiver
- [ ] 6.4 Add the CI step mirroring the existing `Skill frontmatter guard` step in `.github/workflows/ci.yml`
- [ ] 6.5 Add the vitest wrapper so the guard also fails the suite

## 7. Fixed-tick guard — folded test scenarios

- [ ] 7.1 L1 test: barrier is rejected — input: fixture with `await new Promise((r) => setTimeout(r, 0));` in test-body scope followed by `expect(...)` · trigger: the analyze fn · observable: 1 violation naming file and line (test-plan #E10, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 7.2 L1 test: annotated occurrence opts out — input: fixture with the opt-out comment directly above the awaited timer · trigger: the analyze fn · observable: 0 violations (test-plan #E11, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 7.3 L1 test: opt-out does not waive a later violation — input: fixture with one annotated occurrence and one un-annotated barrier later in the same file · trigger: the analyze fn · observable: exactly 1 violation, naming the un-annotated line only (test-plan #E12, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 7.4 L1 test: client suite is compliant — input: real `packages/client/src` at the merge commit · trigger: the analyze fn over the client suite · observable: 0 violations (test-plan #E13, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 7.5 L1 test: guard cost is negligible — workload: the real client suite · metric: analyze wall-clock < 2 s (test-plan #P3, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 7.6 ci test: guard hard-fails rather than warns — input: a client tree containing one un-annotated barrier · trigger: `node scripts/check-fixed-tick-waits.mjs` · observable: non-zero exit and the file named on stderr (test-plan #E14, see the `Skill frontmatter guard` step in `.github/workflows/ci.yml`)
- [ ] 7.7 ci test: standalone step and vitest wrapper agree — input: the real repo · trigger: run both · observable: identical violation sets and identical verdict (test-plan #X5, see the `Skill frontmatter guard` step in `.github/workflows/ci.yml`)

## 8. maxWorkers single source of truth

- [ ] 8.1 Create the repo-root worker module exporting the parallel target, imported by relative path so no package gains a dependency edge (design D3)
- [ ] 8.2 Update the 21 parallel configs to import it; change no values
- [ ] 8.3 Leave the 7 serial configs (`electron`, `image-fit-extension`, `kb-extension`, `mockup-loop`, `nano-banana`, `video-production`, `video-transcription`) declaring `maxWorkers: 1` explicitly and not importing the module

## 9. maxWorkers — folded test scenarios

- [ ] 9.1 L1 test: single source of truth — input: all 28 `vitest.config.ts` under `packages/*` and `scripts/` · trigger: static scan for a `maxWorkers` literal other than `1` · observable: 0 configs restate the parallel target (test-plan #E15, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 9.2 L1 test: serial projects stay serial — input: the 7 serial configs · trigger: static scan · observable: each declares `maxWorkers: 1` and does not import the shared module (test-plan #E16, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 9.3 L1 test: no dependency edge added — input: every `package.json` whose vitest config imports the module · trigger: diff against merge-base · observable: no added dependency entries, no new workspace edge (test-plan #E17, see `scripts/__tests__/skill-frontmatter.test.mjs`)
- [ ] 9.4 L1 test: effective worker count unchanged — input: every project config resolved before and after adoption · trigger: single resolution pass · observable: resolved `maxWorkers` per project is equal, not merely similar (test-plan #P1, see `scripts/__tests__/skill-frontmatter.test.mjs`)

## 10. Verification

- [ ] 10.1 Full suite green on a loaded developer machine, run 3 consecutive times, all exit 0 (test-plan: manual-only)
- [ ] 10.2 Confirm CI green on the branch and that CI worker counts are unchanged from `/tmp/pi-test-before.log`
- [ ] 10.3 Confirm wall-clock has not regressed against the baseline captured in 1.1
- [ ] 10.4 Re-run `packages/image-fit-extension` and `packages/bus-client` inside a worktree checkout; confirm the originally reported failures do not reappear
- [ ] 10.5 Run `openspec validate --changes make-test-suite-deterministic`

## 11. Documentation

- [ ] 11.1 Add a `docs/faq.md` entry via DocScribe (caveman style): "npm test red locally, green in CI" — rotating failure set, contention, confirm with `--maxWorkers=2`
- [ ] 11.2 Add a `docs/faq.md` entry via DocScribe: stale `packages/electron/resources/bundled-extensions/` is residue from a removed build step and is safe to delete
- [ ] 11.3 Update directory `AGENTS.md` rows for `scripts/check-skill-frontmatter.mjs`, the new guard script, the repo-root worker module, and `packages/client/vitest.config.ts`, each with `See change: make-test-suite-deterministic`
- [ ] 11.4 Record in the change notes that the pi lockfile skew and the macOS realpath divergence were both investigated and ruled out
