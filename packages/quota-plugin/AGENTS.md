# DOX — packages/quota-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Server-side provider subscription-quota plugin (no bridge). Server entry resolves creds via host auth abstraction + fetches via `@latentminds/pi-quotas` (pinned 0.4.0); client renders a `Quota` context group in the composer strip (one chip per provider, every window inline, session-model provider ringed) + dialog. Disabled by default, per-provider (Anthropic included; no `acknowledgedToS` gate). See change: move-quota-to-context-strip. |
| `configSchema.json` | Config schema for `plugins.quota.*` in `~/.pi/dashboard/config.json`. Keys: `enabled` (bool, default false), `providers.<id>.enabled` (bool, default false), optional `retry` backoff config. Every gate default OFF; never migrated on. |
| `package.json` | Manifest `id: quota`, `displayName: Provider Quota`, priority 600, `client`+`server` entries (NO bridge), `configSchema`, claims `composer-context-group`→`QuotaWidget` + `settings-section`→`QuotaSettings` (tab general). Published to npm (`publishConfig.access: public`); listed in `publish.yml` PACKAGES. `files` excludes `**/AGENTS.md` + tests — doc-tree rows stay out of the tarball. Bundled built-in: loader discovers it via `packages/*` scan, NOT from `node_modules`, so npm install alone does NOT activate it. Deps: dashboard-plugin-runtime, `pi-dashboard-server` (workspace:* — host auth abstraction), shared, `@latentminds/pi-quotas` pinned `0.4.0` (deep raw-TS import; no `exports` map upstream). |
| `tsconfig.json` | Extends `../../tsconfig.base.json`; `jsx: react-jsx`, `noEmit`, DOM libs, `include: src`. |
| `vitest.config.ts` | Vitest config. jsdom env, `pool: forks`, `maxWorkers: PARALLEL_MAX_WORKERS`, include `src/**/__tests__/**/*.test.{ts,tsx}` + `src/**/*.test.{ts,tsx}`, globalSetup `@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts` (run via `npm test` or `HOME=$(mktemp -d)`). `resolve.alias` maps `@blackbelt-technology/dashboard-plugin-runtime{,/context,/server,/test-support}` + `pi-dashboard-shared` to worktree-local `../*/src` so tests see the code under test (hoisted symlink otherwise escapes to the main checkout; mirrors client + blackhole-plugin). See change: move-quota-to-context-strip. |

See change: add-provider-quota-plugin.
