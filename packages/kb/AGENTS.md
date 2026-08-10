# DOX — packages/kb

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `skill/kb-search/SKILL.md` | kb-search skill. Frontmatter `name: kb-search`. Retrieve-before-answer: search local FTS5 markdown KB before answering project questions from memory/guessing. Pull retrieval (agent calls, nothing auto-injected), sub-second, zero model tokens. |
| `skill/kb-setup/SKILL.md` | kb-setup skill. Frontmatter `name: kb-setup`. One-time KB bring-up wrapping `kb init`: detect config → choose scope + sources → `kb init` → trust remote source → `kb index` → smoke `kb search` to verify. |
| `verify.ts` | verify script. NODE_OPTIONS=--experimental-sqlite tsx verify.ts. |
| `vitest.config.ts` | vitest config for kb package. |
