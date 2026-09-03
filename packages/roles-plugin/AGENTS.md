# DOX — packages/roles-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Built-in roles settings UI (`settings-section` slot). Carries the bundled-plugin caveat: discovered by the `packages/*` build scan, NOT from `node_modules`. |
| `vitest.config.ts` | Vitest config for roles-plugin. `include` `src/**/__tests__/**/*.test.{ts,tsx}`, `environment` `jsdom`, `pool` `forks`, `maxWorkers` `50%`, `globalSetup` `setup-home.ts`. Uses `@vitejs/plugin-react`. |
