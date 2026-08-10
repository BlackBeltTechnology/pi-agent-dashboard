# DOX — packages/automation-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Schedule-triggered background agent runs. Reads automation defs: per-folder `<repo>/.pi/automation/<name>/automation.yaml`, global `~/.pi/automation/<name>/automation.yaml`. Server-owned scheduler arms triggers (phase 1 cron `schedule`). Fire → spawns pi session `kind="automation"` (model, action `prompt`\|`skill`, mode, sandbox). Runs watchable in Automation view. Results → `<scope>/.pi/automation/runs/<date>-<name>/result.md`. Keeps last 100 per automation. |
| `vitest.config.ts` | Vitest config for automation-plugin package. jsdom env, `pool: "forks"`, `maxWorkers: "50%"`, includes `src/**/__tests__/**/*.test.{ts,tsx}`. globalSetup imports `@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts`. |
