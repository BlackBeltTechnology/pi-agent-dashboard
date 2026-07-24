# session-guideline-fast-vs-research-ab — A/B Model Comparison

A/B test: `@fast` vs `@research` model for the SessionGuideline subagent. Tests whether cheaper model (`@fast`) matches quality of default `@research` on one guideline-production task. Inform, not replace — one sample, N=1.

Subagent: `SessionGuideline` (`.pi/agents/SessionGuideline.md`), wraps skill `session-to-guideline`.

## Setup

- Input session: `019f8680` (pi-agent-dashboard, 2026-07-21, 249 KB JSONL transcript).
- 8-section output template. Only `model:` override differed between arms.
- Arm A (`@fast`): `deepseek/deepseek-v4-flash`.
- Arm B (`@research`): `anthropic/claude-opus-4-8`.
- Outputs: `Prompt stories/ab-fast/guideline.md`, `Prompt stories/ab-research/guideline.md`.

## Metrics

| Metric | @fast | @research |
|---|---|---|
| Output size | 10.3 KB / 1527 words | 9.2 KB / 1395 words |
| Sections produced | 8/8 | 8/8 |
| Structure fidelity | full template | full template |
| Correct core insight | yes | yes |
| Steering→guardrail rows | 3 | 5 |
| Prompt-quality critique | none | rewrote weak prompt |
| Concrete symbol evidence | medium | high |

Core insight both arms nailed: `memoryMode="policy-only"` → problem = retention/eviction loss, NOT context bloat.

## @fast strengths

- Richer narrative. Per-phase timestamps + durations.
- Fenced reproduce-it command block.
- Recommended a "memory pressure debug" skill.

## @research strengths (judgment sections the skill flags as slop-prone)

- 5 guardrails vs 3. Each a distinct AI failure mode:
  1. abstract-mechanism bias
  2. "shrink what loads" misframe
  3. SQLite-superset assumption
  4. unverified-tool risk
  5. undocumented-doc
- Self-critiqued prompts. Caught vague `"what i current memory usage?"` and rewrote stronger. @fast only praised the same prompt.
- Denser evidence. Named both eviction functions `removeSyncedMemories` and `removeExactSyncedMemories`. Named `DELETE FROM memories` SQL. Named `fifo-evict` anti-pattern.
- Proposed exact project-memory string to save.

## Verdict

- Both structurally valid and factually correct.
- Bulk backfill of many sessions → `@fast` fine + cheaper. Matches skill's `@compact` fallback note.
- One-off quality-sensitive distillation → `@research` clearly stronger on insight sections (steering→guardrail synthesis, prompt critique, evidence density). Less generic output.
- Confirms subagent's `model: "@research"` default is correct.
