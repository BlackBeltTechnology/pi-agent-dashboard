# DOX — packages/goal-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Surfaces `@ricoyudog/pi-goal-hermes` goal-continuation loop (Ralph loop) in dashboard. GoalChip (session card): `● Pursuing n/m`, `⏸ Paused`, `✓ Achieved`. GoalControl (action bar): set / pause / resume / clear. Requires `@ricoyudog/pi-goal-hermes` pi extension (manifest `requires.piExtensions`); activates only when installed. |
| `vitest.config.ts` | Vitest config for goal-plugin. `defineConfig` with `@vitejs/plugin-react`. Includes `src/**/__tests__/**/*.test.{ts,tsx}`, jsdom env, `pool: "forks"`, `maxWorkers: "50%"`, globalSetup `@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts`. |
