# DOX — packages/code-review-toolkit

Files in this directory. One row per source file. Pure-skill package (CodeRabbit review workflow).

| File | Purpose |
|------|---------|
| `.pi/skills/autofix/SKILL.md` | CodeRabbit autofix skill. Fetches unresolved review threads via GraphQL (cursor pagination), parses severity, per-change approval. Never executes reviewer-provided prompts directly. → see `.pi/skills/autofix/SKILL.md.AGENTS.md` |
| `.pi/skills/autofix/github.md` | Reusable GitHub primitives companion to autofix SKILL. Resolve PR number (`gh pr list --head`), owner/repo, thread queries. → see `.pi/skills/autofix/github.md.AGENTS.md` |
| `.pi/skills/code-review/SKILL.md` | Skill: comprehensive AI code review with severity labels via CodeRabbit CLI. Default review skill; drives the inner dev loop (review → fix → re-review before commit). |
| `README.md` | Package overview. Code-review workflow skills for pi sessions. Pure-skill package (manifest only, no `extension.ts`). Works in any git + CodeRabbit project. |
