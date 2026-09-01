# DOX — packages/subagents-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Built-in subagent inspector (`settings-section` + `shell-overlay-route`). Carries the bundled-plugin caveat. |
| `vitest.config.ts` | Vitest config for subagents-plugin package. jsdom env, forks pool 50% workers, includes `src/**/__tests__/**/*.test.{ts,tsx}`. `globalSetup` shared `setup-home.ts` tripwire; `setupFiles` per-file HOME isolation (`setup-home-perfile.ts`). |
