# DOX — packages/subagents-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Built-in subagent inspector (`settings-section` + `shell-overlay-route`). Carries the bundled-plugin caveat. |
| `vitest.config.ts` | Vitest config for subagents-plugin package. jsdom env, forks pool 50% workers, includes `src/**/__tests__/**/*.test.{ts,tsx}`. `globalSetup` shared `setup-home.ts` tripwire; `setupFiles` per-file HOME isolation (`setup-home-perfile.ts`). |
| `package.json` | Plugin manifest (`pi-dashboard-plugin`). Claims: `settings-section` SubagentsSettings, `composer-dock-process-group` SubagentDockGroup (lazy `module`; running + pending subagent rows in the composer dock Processes lane), `composer-dock-process-group` BackgroundSubagentDockGroup (second claim, after the first: background subagent rows; see change: show-background-subagents-in-dock), `shell-overlay-route` SubagentPopoutClaim, `tool-renderer` Agent. Registry regenerated via `scripts/generate-plugin-registry.mjs`. See change: add-composer-dock (task 3.3). |
| `src/bridge/` | Producer contract (pi-dashboard-subagents ≥ 0.8.0, sibling change `emit-subagent-stop-verdicts-and-registry`): each `subagents:stop` handler pushes one verdict synchronously onto `data.verdicts` (`{phase: queued|running|terminal|unknown, status?}`), and each activation answers the synchronous `subagents:registry {answered, entries}` query by incrementing `answered` and appending `{agentId,status}`. Older producers do neither; the dashboard degrades to today's stop feedback. See change: fix-background-subagent-ghost-rows. |
| `src/i18n.ts` | Plugin i18n catalog (zh-CN + hu parity; English is the inline fallback). `subagentUntracked` = untracked-end line of the full-screen view. See change: fix-background-subagent-ghost-rows. |
