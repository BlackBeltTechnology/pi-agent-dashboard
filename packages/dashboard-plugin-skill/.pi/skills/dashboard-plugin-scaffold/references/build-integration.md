# Build Integration

How the dashboard discovers, bundles, and serves a plugin you've scaffolded.

## Discovery

On dashboard server startup, `discoverPlugins()` (in `@blackbelt-technology/dashboard-plugin-runtime/server`) globs `packages/*/package.json` from the dashboard repo root and identifies every package declaring a `pi-dashboard-plugin` field.

For mode `new`: your plugin lives at `packages/<id>-plugin/` and is discovered automatically.

For mode `augment`: the project lives outside the monorepo, so the stock dashboard loads it at **runtime**. It is discovered as a pi package: `pi install npm:<package>` from a terminal (appears after a dashboard restart) or install from the dashboard Packages tab (appears live). The operator then trusts its client bundle (and server entry) from the Plugins tab on the dashboard host. Interim, before publishing: `npm link` the project into the dashboard's `packages/` layout, or clone it there as a workspace.

## Runtime-delivered client (mode `augment`)

`npm run build:dashboard` runs `vite build --config vite.dashboard.config.ts --configLoader runner`. The generated config calls the SDK preset, `dashboardClientViteConfig` from `@blackbelt-technology/dashboard-plugin-runtime/vite-plugin`:

- entry `src/dashboard/client.tsx` → `dist/client/index.js`; lazy claim `module`s → `dist/client/<name>.js` (shared chunks in `dist/client/chunks/`);
- every import-map specifier (React, the runtime, app-kit/react, wouter) stays an external import — the host serves one instance, so **no React is bundled**; the build **fails** if a chunk would contain React or a host singleton;
- `styles` on → a utilities-only Tailwind stylesheet `dist/client/client.css` (no preflight, host theme variables by reference); off (`styles: false`) → none;
- `--configLoader runner` is required: the published runtime ships TypeScript sources, which Node will not type-strip inside `node_modules`, so the default config loader cannot import the preset.

`dist/client/` is a **dedicated** directory: it is the served asset root, so the server, bridge and `configSchema` entries must never sit inside it (they stay under `src/`). Publish it: a `files` allow-list needs `dist/client/` and `src/dashboard/`, and neither `.gitignore` nor `.npmignore` may exclude `dist/client/` from the tarball.

Manifest fields written: `clientBundle: "./dist/client/index.js"`, `clientStyles: "./dist/client/client.css"` (only with styles), `hostApi: "^<major>.<minor>.0"` (from `PLUGIN_HOST_API_VERSION`), keyword `pi-dashboard-plugin`.

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
