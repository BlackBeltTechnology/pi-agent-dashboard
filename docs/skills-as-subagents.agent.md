# skills-as-subagents — index

Topic: turn pi skills into subagents; fitness scoring; model routing per function.

## 1. Skill vs. subagent — two mechanisms
- Orthogonal. Skill = instructions loaded into main agent, shares budget, runs on parent model.
- Subagent = `.pi/agents/<Name>.md`, isolated context window, own `model:`, returns distilled summary.
- Skill loading: progressive disclosure (name+desc always, body on NL-trigger/`/skill:name`, resources on demand).
- Subagent invoked via `Agent` tool (`subagent_type`).
- Cannot auto-convert. Bridge them: thin agent `.md` spawns worker that loads `/skill:<name>`.

## 2. The bridge: wrapping a skill as a subagent
- Mermaid flow: Agent tool → role→model → compressed parent snapshot (opt) → load `/skill:name` → isolated work → distilled report ≤2KB.
- Recipe: agent `.md` frontmatter `description`, `model: "@fast"`, `inherit_context: false`, least-privilege `tools`.
- Model chosen by role alias (`@fast @research @coding @vision @compact`); overridable per-call.
- `inherit_context: false` for batch; `true` when judgement needs decision context.
- SDK quirk: `createAgentSession()` builds own `DefaultResourceLoader` unless passed; subagent gets fresh discovery; wrapped skill must be on disk (`packages/*/.pi/skills`).

## 3. Subagent-fitness scoring
- Scored on: context-cost-if-inline, input→output contract, low interactivity, self-contained.
- 21 skills scored /5. Top fit 5: video-transcription, session-to-guideline, doc-summarizer, kb-search.
- Fit 0: interview-me (interactive only). Fit 1: node-inspect-debugger.
- Tiers: A wrap-now (fit 5); B wrap read/analysis phase only (fit 4); C leave inline (fit ≤2).

## 4. Model / provider routing
- Role map from `~/.pi/agent/providers.json`. `@fast`=deepseek-v4-flash, `@compact`=haiku-4-5, `@planning/@coding/@research`=opus-4-8, `@vision`=deepseek-v4-flash, direct `glm-5.2` 1M ctx.
- Route by function not skill name. Long-context synthesis → `@research`/`glm-5.2` if >200K. Reasoning audit → `glm-5.2`/`@research`. Code → `@coding`. Map-reduce → chunks `@fast`, merge `@compact`/`@research`. Visual → `@vision`.
- Per-Tier-A/B model picks table.

## 5. Context, KB & sibling-skill injection per skill
- What to present each wrapped skill (Soniox key, session JSONL, doc-engine, KB index, etc.).
- General multipliers: least-privilege tool allow-list, `kb_search` self-serve, sibling skills named, `inherit_context` tuned.

## 6. The skill-authoring workflow
- 6 steps: understand examples, plan resources, `init_skill.py`, edit (<500 lines, push detail to `references/`), `package_skill.py`, iterate.
- Skills live `packages/*/.pi/skills/<name>/`.
- Frontmatter YAML trap: unquoted `description` with inner `": "` silently drops skill. Quote whole value. Enforced by `scripts/__tests__/skill-frontmatter.test.mjs`.
- Only `name`+`description` read for triggering. Helper scripts TypeScript, run with `bun`.

## 7. Tier A wrappers shipped with this doc
- `.pi/agents/`: Transcribe.md, SessionGuideline.md, DocSummarize.md, KbLookup.md. Models `@fast`/`@research`. `inherit_context:false`.

## 8. Follow-up: co-locating agents with their skill's package
- Goal: ship wrapper agent inside same package as skill.
- `resolveAgentMdPath()` (`extensions/agent.ts`) 4-tier lookup: project, user, bundled, package (commit `2dbd87a`).
- Convention `<package-root>/agents/*.md` NOT `.pi/agents/`.
- Tier 4 user-scope only today (`buildPackageAgentIndex` filters `scope==="user"`); workspace packages not registered as configured pi packages.
- Package tier shipped via `add-package-agent-discovery-tier` (PR #1, archived 2026-07-07), user-scope only. Justification (`isProjectTrusted()` absent) now stale — `ExtensionContext.isProjectTrusted()` exists. Needs NEW follow-up change for project-scope-when-trusted.
- Target dirs: Transcribe→video-transcription, SessionGuideline→authoring-toolkit, DocSummarize→document-converter, KbLookup→kb.
