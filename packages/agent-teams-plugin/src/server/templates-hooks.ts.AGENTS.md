# templates-hooks.ts — index

Composition root: `registerTemplatesHooks(deps)` runs `REGISTRARS` in order (templates, agents, hooks, hook-trust, plans, start, spawn-resolve); `TemplatesHooksDeps`, `LeadSpawner`, `PluginCounters` (`createPluginCounters`). See change: add-agent-teams-templates-hooks.
