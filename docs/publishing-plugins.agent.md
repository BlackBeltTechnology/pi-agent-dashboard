# publishing-plugins.md — index

Pull-only condensed map. Source: docs/publishing-plugins.md. See change: decouple-plugins-from-core.

## Publish to npm
- Lockstep versions (`scripts/sync-versions.js`). First publish manual (no Trusted Publisher until package exists). Seed 0.0.1 optional, revert before commit. Add to `publish.yml` `PACKAGES`. Server TS erasable only.

## Public host surface
- Root (`public.ts`) = versioned, import-mapped. `./sdk` = bundled pure helpers (`satisfiesHostApiRange`, not `PLUGIN_HOST_API_VERSION`). `./host` = shell internals, not import-mapped. `./context` deprecated one minor.
- Gates: `scripts/host-api-surface.mjs` (snapshot + bump rule), `npm run check:plugin-boundary`.

## `hostApi`
- `^MAJOR.MINOR[.PATCH]`. One range, both halves, checked at discovery. `workspace`/`bundled` warn; `installed`/`pi-package` refuse. Required for `pi-package` + `clientBundle`.

## Runtime client build
- Manifest `clientBundle` `./dist/client/index.js` (dedicated dir), `clientStyles`, `i18nCatalog`.
- `dashboardClientViteConfig` (`@…/dashboard-plugin-runtime/vite-plugin`). Script `vite build --config vite.dashboard.config.ts --configLoader runner` (runner required: TS sources in `node_modules`).
- Entry exports claim fns, eager components, optional reducer/finalizers, i18n catalog. Claim `module` = lazy chunk.
- Singleton guard fails build on bundled React / client-utils singletons.
- CSS: utilities-only, no preflight, host vars.
- Operator trust: Trust / Trust this version / Trust server code (local only).
