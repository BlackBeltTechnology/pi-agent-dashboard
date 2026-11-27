# DOX — packages/subagents-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Built-in subagent inspector (`settings-section` + `shell-overlay-route`). Carries the bundled-plugin caveat. |
| `vitest.config.ts` | Vitest config for subagents-plugin package. jsdom env, forks pool 50% workers, includes `src/**/__tests__/**/*.test.{ts,tsx}`. `globalSetup` shared `setup-home.ts` tripwire; `setupFiles` per-file HOME isolation (`setup-home-perfile.ts`). |
| `package.json` | Plugin manifest (`pi-dashboard-plugin`). Claims: `settings-section` SubagentsSettings, `composer-dock-process-group` SubagentDockGroup (lazy `module`; running + pending subagent rows in the composer dock Processes lane), `composer-dock-process-group` BackgroundSubagentDockGroup (second claim, after the first: background subagent rows; see change: show-background-subagents-in-dock), `shell-overlay-route` SubagentPopoutClaim, `tool-renderer` Agent. Registry regenerated via `scripts/generate-plugin-registry.mjs`. See change: add-composer-dock (task 3.3). Manifest `requires.piExtensionVersions` pins producer `>=0.7.0`. See change: move-subagents-to-plugin. |
| `src/bridge/` | Producer contract (pi-dashboard-subagents ≥ 0.7.0, manifest `requires.piExtensionVersions`): declares lifecycle forwards (`latest`, key `id`, group `lifecycle`, `maxKeys: 256`) + `Agent` tool-update filter over `dashboard:register-*`; registry reconcile via `subagents:list` on bridge-ready (one retry on first lifecycle emission) → `subagent_registry_snapshot {background:true}`. No verdicts, no `subagents:registry`. See change: move-subagents-to-plugin. |
| `src/i18n.ts` | Plugin i18n catalog (zh-CN + hu parity; English is the inline fallback). `subagentUntracked` = untracked-end line of the full-screen view. See change: fix-background-subagent-ghost-rows. Adds `subagentResultTooLarge`. See change: move-subagents-to-plugin. |
