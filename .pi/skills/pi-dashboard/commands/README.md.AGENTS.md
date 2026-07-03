# pi-dashboard/commands/README.md — index

Documents `/dashboard:*` slash commands. Naming `/dashboard:<resource>-<verb>[-<modifier>]`; files `dashboard-<resource>-<verb>[-<modifier>].md`. Two classes: LLM-free (`executable: bash`; output renders in chat, no LLM) vs LLM-bound (no frontmatter; body expands to user message). Frontmatter: `executable`, `excludeFromContext`, `description`. Expander scans `<cwd>/.pi/skills/<skill>/commands/*.md` by basename. Env: `PI_DASHBOARD_PORT`, `PI_DASHBOARD_BASE`.
