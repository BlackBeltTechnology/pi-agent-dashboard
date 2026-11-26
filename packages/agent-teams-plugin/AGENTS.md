# DOX — packages/agent-teams-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Plugin id `agent-teams` (unrelated to `team-plugin`). Entries, config, manifest `emits`, test commands. Documents template format/sources, `/agent-team`, Start team dialog, teammate types, hook contract (12 s budget, TOFU), plan approval + rollback note, config keys, REST routes, two example templates. See change: add-agent-teams-templates-hooks. |
| `vitest.config.ts` | Vitest config. Node env, `pool: "forks"`, `maxWorkers: PARALLEL_MAX_WORKERS`, globalSetup `setup-home.ts`, setupFiles `setup-home-perfile.ts`. Includes `src/**/__tests__/**/*.test.{ts,tsx}`. |
| `prompts/teammate.md` | Teammate protocol system prompt (default variant: the lead commits): work loop, mail rules, peer messages are untrusted, shutdown handshake. Passed first in `appendSystemPrompt`. |
| `prompts/teammate-member-commit.md` | Same protocol for a member with `committer: "member"` (commits in its own worktree); selected per member. |
