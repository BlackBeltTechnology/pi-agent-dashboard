# Build Integration

How the dashboard discovers, bundles, and serves a plugin you've scaffolded.

## Discovery

On dashboard server startup, `discoverPlugins()` (in `@blackbelt-technology/dashboard-plugin-runtime/server`) globs `packages/*/package.json` from the dashboard repo root and identifies every package declaring a `pi-dashboard-plugin` field.

For mode `new`: your plugin lives at `packages/<id>-plugin/` and is discovered automatically.

For mode `augment`: until the future `node_modules` discovery scan ships, your augmented project must be brought into the dashboard repo's `packages/*` either by `npm link`-ing or by cloning. Your manifest already satisfies the forward-compat contract, so when the scan ships, no regeneration is needed.

## Client bundling

The Vite plugin `viteDashboardPluginsPlugin` (in `@blackbelt-technology/dashboard-plugin-runtime/vite-plugin`):

1. On dev start and on build, scans `packages/*/package.json` for `pi-dashboard-plugin`.
2. Generates `packages/client/src/generated/plugin-registry.tsx` containing static imports of each plugin's `client` entry plus a typed `PLUGIN_REGISTRY` export.
3. Vite tree-shakes any plugin component that no slot consumer references.
4. Code-splits per plugin: each plugin's chunk loads when its slot is first rendered (e.g. a `content-view` chunk loads on first navigation to its route).
5. Generates the Tailwind `@source` file (`packages/client/src/generated/plugin-sources.css`) from the same scan, so the host's CSS sees every plugin's class names. **Do not hand-write an `@source` line** for your plugin: no edit to `index.css` or any CSS file is needed, and none should be made.

## Production filtering

Plugins with `pi-dashboard-plugin.fixture: true` (e.g. `packages/demo-plugin/`) are filtered out when `NODE_ENV=production`. The skill never sets `fixture: true` for scaffolded plugins.

## Server bundling

Plugins with a `server` entry are dynamic-imported by the loader at runtime. There is no build step — the server runs TypeScript directly via jiti (pi's TS loader).

## Bridge entry

If your plugin manifest declares a `bridge` entry, the dashboard auto-registers it at `~/.pi/agent/extensions/dashboard-<plugin-id>/` so it loads on every pi session start. Auto-deregisters on plugin disable.

User-owned entries in `settings.json` are never touched (managed entries use a `dashboard-<plugin-id>` key prefix the dashboard owns).

## Dev loop

After scaffolding (or augmenting):

```bash
# At the dashboard repo root:
npm install
npm run build                       # if you changed client code
curl -X POST http://localhost:8000/api/restart   # restart server
npm run reload                      # reload connected pi sessions (only if you have a bridge entry)
```

In `--dev` mode, Vite hot-reloads client code. Server changes still require a restart.

## Plugin enable/disable

Set `plugins.<id>.enabled = false` in `~/.pi/dashboard/config.json` to disable a plugin. Server-side disable requires restart; client-side disable hides slots immediately on next render via the registry filter.
