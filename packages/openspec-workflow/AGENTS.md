# DOX — packages/openspec-workflow

Files in this directory. One row per source file. Pure-skill package (OpenSpec-lifecycle helpers).

| File | Purpose |
|------|---------|
| `.pi/skills/fix-worktree-opsx-skills-not-created/SKILL.md` | Skill. Fix worktree missing generated openspec-* (opsx) skills. `worktreeInit` must call `npx @fission-ai/openspec init`; bare `openspec` = squatted 0.0.0 npm stub that inits nothing. |
| `.pi/skills/pre-scaffold-openspec-coherence-check/SKILL.md` | Skill. Pre-scaffold checks before new openspec change: archive sweep, active sweep, current-code verify, slot-props contract, registry check. Avoid re-proposing archived work. |
| `.pi/skills/reverse-spec-from-code/SKILL.md` | Reverse-generate `openspec/specs/<cap>/spec.md` from spec-less code to enrich `kb_search`. Discovery subagent clusters dir→capabilities; parallel blind generators follow contract across file boundaries; parallel auditors ground each spec against code; scratch in gitignored `.reverse-spec-scratch/`; promote to `openspec/specs/` only on confirm. Step 6.5 HARD `openspec validate` gate before promote. |
| `.pi/skills/reverse-spec-from-code/prompts/auditor.md` | Auditor subagent prompt. Reads generated spec + code, emits strict JSON `{hallucinated_requirements,missing_behaviors,format_ok,verdict}`. Code is oracle. verdict=revise on any hallucination or central missing behavior. |
| `.pi/skills/reverse-spec-from-code/prompts/discovery.md` | Discovery subagent prompt. Clusters `{TARGET_DIR}` into kebab-case capabilities via `kb agents`/grep, flags existing `openspec/specs/<cap>`. Emits strict JSON manifest `{capabilities:[...]}`. |
| `.pi/skills/reverse-spec-from-code/prompts/generator.md` | Generator subagent prompt (v3). Blind (code only). Follow contract across boundaries; describe CURRENT code; full-form `# <cap> Specification`. FORMAT hard-gate rule keeps cheap models `openspec validate`-clean. |
| `.pi/skills/spec-coherence-check/SKILL.md` | Skill: sweep active proposals for staleness, conflicts, obsolescence against codebase + archived changes. Produces gap-analysis report + priority queue. |
| `.pi/skills/spec-coherence-check/references/proposal-queue-schema.md` | JSON schema for `.pi/proposal-queue.json`. |
| `README.md` | Package overview. OpenSpec-lifecycle helper skills for pi sessions. Pure-skill package (manifest only, no `extension.ts`). Reusable in any OpenSpec + pi project. |
