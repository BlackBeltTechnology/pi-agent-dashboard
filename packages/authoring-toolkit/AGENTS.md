# DOX — packages/authoring-toolkit

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `.pi/skills/faq-mine/SKILL.md` | Skill (v2.0): mine `docs/faq.md` from docs (README.md + `docs/*.md`) AND pi-hermes memory stores (runtime problems). Dispatches @fast subagents per source, dedupes against existing FAQ, merges in caveman style. → see `.pi/skills/faq-mine/SKILL.md.AGENTS.md` |
| `.pi/skills/skill-to-subagent/SKILL.md` | Portable procedure: convert a pi skill into an isolated subagent + wire into a pipeline. Discriminator (coherence-critical→inline skill; read/write-light+distilled→subagent) + fitness rubric. Bridge agent .md template (role-alias model, inherit_context, least-privilege tools, ≤2KB output contract). Model-by-function routing. Wiring = spawn-checkpoint table (pi has no auto-delegation). Pitfalls: YAML ": " trap silently drops agent, compression-drop, fresh ResourceLoader, telephone game. Tech-stack independent, pi-platform-specific. Repo-authored (MIT). |
| `README.md` | Package overview. General-purpose authoring skills for pi sessions. Pure-skill package (`package.json` manifest only, no `extension.ts`). Skills load by NL trigger: `skill-creator` (author/update a skill) and `session-to-guideline` (turn session JSONL into reusable playbook). Scripts run via `npx tsx scripts/…`, no build step. |
