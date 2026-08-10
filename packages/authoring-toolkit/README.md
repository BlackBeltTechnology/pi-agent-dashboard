# @blackbelt-technology/pi-dashboard-authoring-toolkit

General-purpose **authoring** skills for pi sessions. Pure-skill package — a
`package.json` manifest only, no `extension.ts`. Skills load by natural-language
trigger from their frontmatter `description`; no manual invocation.

## Skills

| Skill | What it does | Fires on |
|-------|--------------|----------|
| `skill-creator` | Guide for authoring or updating a skill — structure, frontmatter, scripts/references layout, progressive disclosure. | "create a skill", "write a new skill", "update this skill", "how do I author a skill" |
| `skill-to-subagent` | Turn an existing skill into an isolated subagent and wire it into a project's pipeline — fitness discriminator, bridge-agent template, model-by-function routing, `inherit_context` tuning, spawn checkpoint. Tech-stack independent, pi-platform-specific. | "wrap this skill as a subagent", "subagentize this", "should this be a subagent", "add a subagent to the pipeline" |
| `session-to-guideline` | Turns a pi session JSONL transcript into a reusable "how-we-did-it" Markdown playbook: goal vs. steering, tools/files/searches used, skills/memories created, reproduce-it checklist. | "document this session", "write up how we did X with the AI", "make a guideline/playbook from this session", "turn this session into a tutorial" |

`session-to-guideline` ships `scripts/` (deterministic facts-sheet extractor +
session lister) and `references/guideline-template.md`. Scripts run via
`npx tsx scripts/…` (repo convention) on Node built-ins — no build step, no
third-party deps. They read the pi-standard session path
(`~/.pi/agent/sessions/…`) and never write to the session store.

## How loading works

pi auto-discovers each `.pi/skills/<name>/SKILL.md` listed under `pi.skills` in
`package.json`. No registration code required.

## Attribution

`skill-creator` is a derived work of Anthropic's `skill-creator` (MIT). Full
attribution and license in [`NOTICE`](./NOTICE).
