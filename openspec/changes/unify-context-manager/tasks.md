# Tasks: unify-context-manager (umbrella roadmap)

Each task creates one phase change, with proposal, specs, design and tasks, via
`plan-proposal`. Phases are ordered by dependency. A phase change is "created"
when `openspec validate <name>` passes and its artifacts are committed.
Implementation happens inside each phase change, not here.

## 0. Pre-phase research

- [x] 0.1 Triage question-method study: decomposed atomic questions, structured state and learned aggregation, re-run against the 50-window bake-off (`/tmp/von-spike`). Record the result in `docs/research/unified-context-manager-exploration.md` §17. Verify: the research doc carries a comparison table with LOOCV AUC per method.
- [x] 0.2 MAP card-writing quality spike on the accepted windows. Verify: a research-doc section with judged card and trigger quality (done with a blinded cross-family LLM judge plus deterministic trigger replay, and a hand spot-check of 10 regenerated cards: 4 accept, 4 edit, 2 reject; see research doc §19).

## 1. Phase changes

- [ ] 1.1 Create `context-manager-kernel` (package scaffold, capture tap, `packages/kb` scopes `lessons|sessions|web`, single injection owner with a byte-stable pinned tier, `context_search`/`context_get`, alias deactivation via `pi.setActiveTools`, overlap refusal while old packages are installed, `contextManager.enabled` flag, abstention score floor for `context_search`). Verify: `openspec validate context-manager-kernel` passes.
- [ ] 1.2 Create `context-manager-forks` (hermes 0.9.9 + blackhole 0.5.6 port with NOTICE/headers, drop list from design D1, boundary compaction D3, pi peer floor 0.87.0, `skill_manage`, session index D9). Verify: `openspec validate context-manager-forks` passes and the design names the dropped LOC.
- [ ] 1.3 Create `context-manager-lessons-and-cues` (lesson file format D4 incl. `anchors`/`supersedes`/`valid_*`/`trust`, anchor staleness via kb verdicts, supersede-on-write and delta-only updates, poisoning controls, `lesson` tool with replay gate and PII scrub, trigger matcher and channels A–E D5, stats DB, `followed` metric, prompt-trigger spike). Verify: `openspec validate context-manager-lessons-and-cues` passes and the specs include a hot-path latency budget.
- [ ] 1.4 Create `context-manager-exec-and-web` (clean-room `exec` contract D7, curl/HTTP guard as a `guard` lesson, web tap D8 with the untrusted-content scanner). Verify: `openspec validate context-manager-exec-and-web` passes and the design states the clean-room provenance rule.
- [ ] 1.5 Create `context-manager-lesson-miner` (`/lessons mine`, `/lessons import-hermes`, the D10 pipeline under `maxConcurrentSubagents`, auto-accept threshold plus review, labelled dataset, System-1 adapter D11 with remote, managed-local and laya-ts modes and the LLM fallback). Verify: `openspec validate context-manager-lesson-miner` passes.
- [ ] 1.6 Create `context-manager-plugin-cutover` (unified dashboard plugin D12, `bundled-recommended-extensions` delta dropping context-mode, uninstall action with confirmation, doctrine/AGENTS.md tool-name update, alias removal after one release, rollback steps). Verify: `openspec validate context-manager-plugin-cutover` passes.

## 2. Evaluation gates (block 1.6 cutover)

- [ ] 2.1 Build the repo-specific memory eval from session logs (design in research doc §19): Tier R (offline retrieval: does the manager deliver the earlier-session evidence at the later decision point within the injection budget; false-injection rate on negative cases) from time-split recurring faults, user-flagged recurrences ("stuck again") and explicit cross-session references; Tier O (outcome replay in the `docker/` harness, memory off / old stack / unified) on a verified subset. Verify: case counts and a Tier R baseline for the old stack are recorded in the research doc.
- [ ] 2.2 A/B every injection tier (pinned, cue-fired, pull) with `scripts/ab-context/` against memory-off, plus Tier R/O from 2.1. A tier that is not non-inferior on success and does not reduce steps or tokens ships disabled. Verify: per-tier verdicts recorded in the research doc before 1.6 is applied.

## 3. Close-out

- [ ] 3.1 After phase 6 ships, re-measure the per-turn payload (`packages/context-budget`), RSS (pi plus child processes) and the tool count against the proposal's baseline. Verify: numbers are recorded in the research doc.
- [ ] 3.2 Archive `consolidate-retrieval-planes` (superseded) and this umbrella. Verify: both are moved under `openspec/changes/archive/`.
