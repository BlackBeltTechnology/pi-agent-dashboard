# Test Plan — add-craft-media-workflows

Stage: design   Generated: 2026-10-15

Levels used: L1 = vitest in `packages/craft-apps/src/__tests__/` (offline lint by default; real-binary rows run under the existing `CRAFT_E2E` opt-in). No L2/L3: the change ships skills only — no process/install surface beyond the existing package, no rendered UI. Agent-judgement behaviour (an LLM following the skill) has no deterministic harness → `manual-only`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | craft-app-skills: Skills declared in the package manifest | BVA (count) | L1 | automated | `packages/craft-apps/package.json` after the change | `packaging.test.ts` reads `pi.skills` and packs the tarball | `pi.skills` length = 18 and tarball holds exactly 18 `.pi/skills/*/SKILL.md`, including the 4 workflow dirs |
| E2 | craft-media-workflow-skills: Media workflow skills shipped | EP (per skill) | L1 | automated | the 4 workflow `SKILL.md` | workflow lint describe | each frontmatter `name` == dir name, description > 60 chars and contains ≥ 1 double-quoted phrasing of ≥ 6 chars |
| E3 | craft-app-skills: One skill per app (scoping) | decision-table (skill kind × lint) | L1 | automated | skill set = router + 13 apps + 4 workflows | full `skills.test.ts` run | app-only checks (`getApp`, required headings, 2–4 recipes, fixture load) iterate exactly 13 app skills; no `getApp("craft-…")` throw; suite green |
| E4 | craft-app-skills: Router skill (workflow table + Craft jobs) | EP | L1 | automated | `craft-studio/SKILL.md` | router lint | body contains all 4 workflow names, `hyperframes-showreel`, a "Craft jobs" heading, `craft-jobs/<slug>/`, `job.json`, and the slug rule text `[a-z0-9-]` |
| E5 | Step contract and verification gate | decision-table (step produces media / text / nothing) | L1 | automated | each workflow's step table | workflow lint | every step naming a media output (`.wav`/`.mov`/`.mp4`) is followed by a `pi-craft verify` line before the next step; every step naming `.srt`/`.json` output is followed by a `check:` fence |
| E6 | Step contract — delivery gate | EP | L1 | automated | final step of each workflow | workflow lint | delivery `pi-craft verify` line contains `--codec video=h264`, `--codec audio=aac` and `--frame-diff` |
| E7 | Recipes are verified (workflow skills) | EP | L1 | automated | all `recipe:` fences in the 4 workflow skills | existing "recipes are verified" describe extended to workflow names | every recipe's last command line matches `^pi-craft verify\b`; a `check:` fence is not treated as a recipe |
| E8 | Step contract — srt skill-level check | BVA (cue count 0 / 1) | L1 | automated | fixture `empty.srt` (0 cues) and `one.srt` (1 cue `00:00:01,000 --> 00:00:02,000`) | run the `check:` snippet extracted from `craft-video-post` under `bash -e` | exit ≠ 0 for `empty.srt`; exit 0 for `one.srt` |
| E9 | Step contract — hits skill-level check | decision-table (schema ok/bad × hits empty/non-empty) | L1 | automated | 3 fixtures: `{schema:"music-hits/1",hits:[{t:1.0,tier:"big"}]}`, same with `hits:[]`, same with `schema:"music-hits/0"` | run the `check:` snippet extracted from `craft-beat-cut` | exit 0 only for the first fixture; ≠ 0 for the other two |
| E10 | Resumable jobs (skill content) | EP | L1 | automated | each workflow `SKILL.md` | workflow lint | contains a resume step mentioning `job.json`, recorded inputs and downstream re-run, and a link to the router "Craft jobs" section; does not restate the slug rule (link, not copy) |
| E11 | Soft references (skill content) | decision-table (sibling × workflow) | L1 | automated | per-workflow sibling map: W1 {veo-generator, footage-redaction, video-transcription, hyperframes-showreel}, W2 {music-analysis, music-edit-to-length, beat-sync-video}, W3 {video-transcription, speaker-id}, W4 {video-transcription or speaker-id} | workflow lint on step 0 | step 0 names every mapped sibling, its package (`video-production` / `video-transcription` / `music-production`), and a degraded path or "stop"; W1 and W3 name `pi-transcribe`, W3 names `pi-voiceid` |
| E12 | FilmCraft and HyperFrames responsibilities | EP | L1 | automated | `craft-video-post/SKILL.md` | workflow lint | names `hyperframes-showreel`, has an alpha branch gated by `pi-craft verify` with `--alpha`, and a full-frame segment branch with a `--size` gate |
| E13 | Step contract — retry cap | EP | L1 | automated | each workflow `SKILL.md` | workflow lint | failed-gate text states `describe` re-discovery and a maximum of 2 retries, then stop |
| E14 | Skill drift check (workflow union) | EP (known id) | L1 | automated | workflow skills' `pi-craft <app> exec` lines + per-workflow app map in `helpers/skills.ts` | offline drift lint | every quoted command id resolves in the union of the mapped apps' fixtures (e.g. `playhead.set` → filmcraft) |
| E15 | Skill drift check (workflow union, negative) | EP (unknown id) | L1 | automated | synthetic workflow body quoting `pi-craft filmcraft exec run --cmd timeline.fooBar` | drift checker invoked on the synthetic body | failure message names the skill and `timeline.fooBar`; sibling CLI lines (`pi-transcribe …`, `npx hyperframes …`) are not checked |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|

None — the spec sets no latency/throughput budget; spike timings are cited for feasibility only.

### Frontend-quirk

None — no UI surface.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Recipes are verified — opt-in split | decision-table (`CRAFT_E2E` × workflow opt-in) | L1 | automated | sibling packages/services absent on the runner | run `skills-recipes.test.ts` with `CRAFT_E2E=1` and the workflow opt-in env unset | app-skill recipes run; every workflow recipe describe is reported skipped, not failed |
| X2 | Step contract — audio hand-off gate (real binaries) | fault-injection (wrong duration) | L1 | automated | `craft-podcast-master` mix recipe fed a 4.0 s source while the picture length is 5.0 s | run the recipe under `CRAFT_E2E=1` + workflow opt-in | final `pi-craft verify --duration 5±0.05` exits 1; recipe fence exits non-zero (bash -e), no later step output written |
| X3 | Step contract — workflow recipes end-to-end (real binaries) | happy path per workflow | L1 | automated | provisioned FilmCraft/SoundCraft/EffectCraft + sample media | run each workflow's recipe fences under `CRAFT_E2E=1` + workflow opt-in | every recipe exits 0 with all `pi-craft verify` assertions passing |
| X4 | Soft references — transcription missing (agent) | fault-injection (absent sibling) | — | manual-only | `video-transcription` not installed | pi session asks `craft-video-post` for captions | [judgment: agent names `video-transcription` package and offers to continue without captions — LLM behaviour, no deterministic harness] |
| X5 | Soft references — essential sibling missing (agent) | fault-injection (absent sibling) | — | manual-only | `music-production` not installed | pi session runs `craft-beat-cut` | [judgment: agent names `music-production` and stops, no guessed beat times] |
| X6 | Resumable jobs — resume after interruption (agent) | state-transition (interrupt after mix) | — | manual-only | W1 job whose `job.json` has a passing mix report | re-run the same job | [judgment: agent starts at assembly and reuses `NN-mix/` output] |
| X7 | Resumable jobs — changed input invalidates downstream (agent) | state-transition (input mtime change) | — | manual-only | completed W1 job; one footage input replaced | re-run the same job | [judgment: agent re-runs assembly and every later step] |
| X8 | W1 full run on a 30 s sample (task 3.2) | end-to-end | — | manual-only | 30 s sample with captions + music | pi session runs `craft-video-post` | [judgment: every verify report in `job.json` passes and the delivery looks/sounds right] |

---

## Coverage summary

- Requirements covered: 10/10 (5 ADDED in `craft-media-workflow-skills`, 5 MODIFIED in `craft-app-skills`)
- Scenarios by class: edge 15 · perf 0 · frontend 0 · error 8
- Scenarios by level: L1 18 · L2 0 · L3 0 · — 5
- Scenarios by disposition: automated 18 · manual-only 5

## New infra needed

- none — extends existing `skills.test.ts`, `packaging.test.ts`, `skills-drift.test.ts`, `skills-recipes.test.ts` and `helpers/skills.ts`; adds small srt/hits fixtures under `src/__tests__/fixtures/`.
