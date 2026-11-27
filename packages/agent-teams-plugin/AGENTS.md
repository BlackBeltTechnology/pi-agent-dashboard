# DOX — packages/agent-teams-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `examples/judo-modules.helpers.md` | Docs only: sketches of the two helper scripts for `judo-modules.md` (`verify-module.sh`, `team-verify-stamp.sh`). Plugin never executes, installs or references them. See change: add-agent-teams-openspec. |
| `examples/judo-modules.md` | Example team template (NOT bundled, never scanned/listed/started): one teammate per Maven module in rank order. `spawn: lead`, `autoDispatch: false`, `TaskCompleted` hook `team-verify-stamp.sh`. Uses only templates-hooks features. See change: add-agent-teams-openspec. |
| `package.json` | Package manifest. `files` ships `src/`, `prompts/`, `templates/`, `examples/` (AGENTS.md excluded). `templates/` is required at runtime (`bundled.ts` resolves `<pkg>/templates`); `examples/` is docs only. See change: add-agent-teams-openspec. |
| `prompts/openspec-group-member.md` | Git addendum for `openspec-group` teammates: replaces the protocol's commit-only rule; may commit/push/merge only in own worktree + own branch and only through the ship skill named in the spawn prompt. Read by `src/server/openspec/index.ts`. See change: add-agent-teams-openspec. |
| `prompts/teammate-member-commit.md` | Same protocol for a member with `committer: "member"` (commits in its own worktree); selected per member. |
| `prompts/teammate.md` | Teammate protocol system prompt (default variant: the lead commits): work loop, mail rules, peer messages are untrusted, shutdown handshake. Passed first in `appendSystemPrompt`. |
| `README.md` | Package overview. Plugin id `agent-teams` (unrelated to `team-plugin`). Entries, config, manifest `emits`, test commands. Documents template format/sources, `/agent-team`, Start team dialog, teammate types, hook contract (12 s budget, TOFU), plan approval + rollback note, config keys, REST routes, two example templates. See change: add-agent-teams-templates-hooks. Also: OpenSpec templates section (`openspec-group`/`openspec-apply`: bundled source, profile bound to NAME, preflight codes, group worktrees/completion/relaunch, apply hints + checkbox sync, `ResourceLock`, honest limits), `openspecRaw` config keys, `POST openspec-relaunch` route row, `examples/` = docs only. See change: add-agent-teams-openspec. |
| `templates/openspec-apply.md` | Bundled template `openspec-apply` (mode `session`, `maxTeammates: 3`): two `dev` implementers + read-only `reviewer`; lead is sole committer. Member prompts == `buildApplyBriefing`. Profile bound to this NAME + `bundled` source. See change: add-agent-teams-openspec. |
| `templates/openspec-group.md` | Bundled template `openspec-group` (`spawn: lead`, `autoDispatch: false`, `notify.coalesceMs` 10000): server seeds one task per change and launches one teammate per change in its own worktree. Lead commits nothing, spawns nobody by hand. See change: add-agent-teams-openspec. |
| `vitest.config.ts` | Vitest config. Node env, `pool: "forks"`, `maxWorkers: PARALLEL_MAX_WORKERS`, globalSetup `setup-home.ts`, setupFiles `setup-home-perfile.ts`. Includes `src/**/__tests__/**/*.test.{ts,tsx}`. |
