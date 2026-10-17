## 0. Gating probes (record outcome in design.md; each fixes the matching workflow recipe)

- [x] 0.1 FilmCraft: `captions.import` / `captions.newTrack` + export with burned or muxed captions (discover via `describe`); fallback = EffectCraft-rendered caption overlays
- [x] 0.2 SoundCraft: any LUFS-target normalize/limiter command; default path = ffmpeg `loudnorm` then `pi-craft verify --loudness`
- [x] 0.3 FilmCraft: placing edits at beat times (`sequence.addEdit` vs `playhead.set` + `source.*`) from a `music-hits/1` file; fix the offset of video-time `hits[].t` onto the sequence; decide recipe-only vs one helper script under `.pi/skills/craft-beat-cut/scripts/` (design D5)
- [x] 0.4 EffectCraft: template round-trip (`templates.*` / `file.newFromTemplate` / `essential.importTemplate`, set text values) → `render --format prores --prores 4444 --channels rgba` passes `--alpha`; else W4 uses the plain text-layer path
- [x] 0.5 HyperFrames (`hyperframes-showreel`): can it render a mov with alpha; outcome selects overlay vs full-frame segment path (segment branch adds a `--size` conformance gate)
- [x] 0.6 FilmCraft/SoundCraft: chapter-marker command for W3 (discover via `describe`); fallback = sidecar chapters text file

## 1. Shared

- [x] 1.1 `craft-studio` router: workflow table (4 rows + FilmCraft/HyperFrames and beat-cut/showreel splits) + "Craft jobs" section (D4)
- [x] 1.2 `package.json` `pi.skills` 14 → 18; `helpers/skills.ts`: keep `SKILL_NAMES` = router + apps, add `WORKFLOW_SKILL_NAMES`; `packaging.test.ts` counts 14 → 18; `skills-recipes.test.ts` runs workflow recipes only under a separate opt-in env; `skills-drift.test.ts` covers workflow skills with the app union
- [x] 1.3 Workflow lint set (new describe in `skills.test.ts`): quoted user phrasing in description; every step names output + gate; step 0 has sibling + runtime probes; resume step + router "Craft jobs" link present; delivery gate has `--codec` and `--frame-diff`; every recipe ends with `pi-craft verify`; quoted command ids resolve against the union of the driven apps' fixtures (per-workflow app map in `helpers/skills.ts`; only `pi-craft <app> exec` lines are drift-checked, sibling CLIs are not)

## 2. Workflows (each: write skill → execute once end-to-end against provisioned binaries on sample media → fix)

- [x] 2.1 `craft-video-post` (W1)
- [x] 2.2 `craft-beat-cut` (W2)
- [x] 2.3 `craft-podcast-master` (W3)
- [x] 2.4 `craft-motion-titles` (W4)

## 3. Docs + QA

- [x] 3.1 README section + `AGENTS.md` rows
- [ ] 3.2 `review-code`

## 4. Tests (folded from test-plan.md)

- [x] 4.1 extend `packaging.test.ts` E23 (test-plan #E1); exemplar: see `packages/craft-apps/src/__tests__/packaging.test.ts`; triple: package.json after the change · packaging test reads `pi.skills` + packs tarball · 18 declared and exactly 18 `.pi/skills/*/SKILL.md` incl. the 4 workflow dirs
- [x] 4.2 workflow lint describe in `skills.test.ts` (test-plan #E2); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: 4 workflow SKILL.md · workflow lint · frontmatter name == dir, description > 60 chars with ≥ 1 double-quoted phrasing of ≥ 6 chars
- [x] 4.3 app-only lint scoping in `skills.test.ts` (test-plan #E3); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: router + 13 apps + 4 workflows · full skills.test.ts run · app-only checks iterate exactly 13 app skills, no `getApp` throw, suite green
- [x] 4.4 router lint in `skills.test.ts` (test-plan #E4); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: craft-studio SKILL.md · router lint · contains the 4 workflow names, `hyperframes-showreel`, a "Craft jobs" heading, `craft-jobs/<slug>/`, `job.json`, slug rule `[a-z0-9-]`
- [x] 4.5 step-gate lint in `skills.test.ts` (test-plan #E5); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: each workflow step table · workflow lint · media-output steps followed by `pi-craft verify` before next step; srt/json-output steps followed by a `check:` fence
- [x] 4.6 delivery-gate lint in `skills.test.ts` (test-plan #E6); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: final step of each workflow · workflow lint · delivery verify line has `--codec video=h264`, `--codec audio=aac`, `--frame-diff`
- [x] 4.7 extend "recipes are verified" describe in `skills.test.ts` to workflow names (test-plan #E7); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: workflow `recipe:` fences · recipes-verified lint · last command line matches `^pi-craft verify`; `check:` fences not treated as recipes
- [x] 4.8 srt check-snippet test (new fixtures `empty.srt`, `one.srt` under `src/__tests__/fixtures/`) (test-plan #E8); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: empty.srt (0 cues) and one.srt (1 cue) · run the `check:` snippet from craft-video-post under bash -e · non-zero exit for empty, 0 for one cue
- [x] 4.9 hits check-snippet test (3 `music-hits` fixtures) (test-plan #E9); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: valid hits / `hits:[]` / `schema:"music-hits/0"` · run the `check:` snippet from craft-beat-cut · exit 0 only for the valid fixture
- [x] 4.10 resume lint in `skills.test.ts` (test-plan #E10); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: each workflow SKILL.md · workflow lint · resume step mentions `job.json`, recorded inputs, downstream re-run, links router "Craft jobs"; slug rule not restated
- [x] 4.11 soft-reference lint in `skills.test.ts` (per-workflow sibling map in `helpers/skills.ts`) (test-plan #E11); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: per-workflow sibling map · lint step 0 · names every mapped sibling, its package and a degraded path or stop; W1/W3 name `pi-transcribe`, W3 names `pi-voiceid`
- [x] 4.12 HyperFrames-branch lint in `skills.test.ts` (test-plan #E12); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: craft-video-post SKILL.md · workflow lint · names `hyperframes-showreel`, alpha branch gated by `pi-craft verify --alpha`, full-frame branch with `--size` gate
- [x] 4.13 retry-cap lint in `skills.test.ts` (test-plan #E13); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: each workflow SKILL.md · workflow lint · failed-gate text states `describe` re-discovery and max 2 retries, then stop
- [x] 4.14 offline workflow drift check (app union) — offline variant lives in `skills.test.ts` per `skills-drift.test.ts` header (test-plan #E14); exemplar: see `packages/craft-apps/src/__tests__/skills-drift.test.ts`; triple: workflow `pi-craft <app> exec` lines + per-workflow app map · offline drift lint · every quoted id resolves in the union of mapped apps' fixtures
- [x] 4.15 negative drift-check test on a synthetic workflow body (test-plan #E15); exemplar: see `packages/craft-apps/src/__tests__/skills-drift.test.ts`; triple: synthetic body quoting `timeline.fooBar` · drift checker run · failure names the skill and `timeline.fooBar`; sibling CLI lines (`pi-transcribe`, `npx hyperframes`) not checked
- [x] 4.16 workflow-recipe opt-in split in `skills-recipes.test.ts` (test-plan #X1); exemplar: see `packages/craft-apps/src/__tests__/skills-recipes.test.ts`; triple: sibling packages absent · `CRAFT_E2E=1`, workflow opt-in env unset · app recipes run, every workflow recipe describe reported skipped, not failed
- [x] 4.17 wrong-duration gate run (real binaries) (test-plan #X2); exemplar: see `packages/craft-apps/src/__tests__/skills-recipes.test.ts`; triple: craft-podcast-master mix recipe fed 4.0 s source vs 5.0 s picture · run under `CRAFT_E2E=1` + workflow opt-in · `pi-craft verify --duration 5±0.05` exits 1, fence exits non-zero, no later output written
- [x] 4.18 workflow recipes end-to-end (real binaries) (test-plan #X3); exemplar: see `packages/craft-apps/src/__tests__/skills-recipes.test.ts`; triple: provisioned FilmCraft/SoundCraft/EffectCraft + sample media · run each workflow's recipe fences under `CRAFT_E2E=1` + workflow opt-in · every recipe exits 0 with all verify assertions passing

## 5. Manual verification (post-merge)

- [ ] 5.1 Manual: agent offered continue-without-captions when `video-transcription` is absent in a `craft-video-post` caption request (test-plan #X4, test-plan: manual-only)
- [ ] 5.2 Manual: agent names `music-production` and stops when it is absent in `craft-beat-cut` (test-plan #X5, test-plan: manual-only)
- [ ] 5.3 Manual: re-run of an interrupted W1 job starts at assembly and reuses the verified mix (test-plan #X6, test-plan: manual-only)
- [ ] 5.4 Manual: re-run after replacing a footage input re-runs assembly and every later step (test-plan #X7, test-plan: manual-only)
- [ ] 5.5 Manual: pi session runs W1 on a 30 s sample with captions and music; every verify report in `job.json` passes (test-plan #X8, test-plan: manual-only)
