# runtime-plugin-clients.md — index

Pull-only condensed map. Source: docs/runtime-plugin-clients.md. See change: decouple-plugins-from-core.

## Bundled vs runtime
- Bundled iff id ∈ `pi-dashboard-build.json#bundledPluginIds`. Helper `isBundledPlugin` (`client-registry-set.ts`).
- Bundled id → build's own copy wins both halves (`workspace` copy, else `bundled`, else priority). Others → `shadowed[]`.
- No declaration → `build-undeclared`, runtime delivery suspended.

## Manifest
- `clientBundle` (ESM entry, dedicated dir = asset root), `clientStyles`, `hostApi`, `eventTypes`, `i18nCatalog` (entry export name).
- Root dir or server/bridge in asset root → `no-bundle`.

## Import map
- `HOST_IMPORT_MAP_IMPORTS` (`shared/dashboard-plugin/host-import-map.ts`): `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, runtime root, `…/embedded-app`, app-kit `/react`, `wouter` → `/host/*.js`.
- Injected by `sendIndexWithImportMap` (`server/src/lib/index-html.ts`). Constant. Inert with zero plugins.

## Admission + trust
- Admit: declared ∧ ¬bundled ∧ enabled ∧ deps loaded ∧ hostApi ok ∧ `auth.trustedPlugins` `{id, clientSha256}` == content hash.
- Refusal precedence: `build-undeclared` > `no-bundle` > `host-api` > `disabled` > `missing-dep` > `untrusted` > `pin-mismatch`.
- `POST /api/plugins/:id/trust {sha256}|{server:true}`: `operate` + genuinely local. `DELETE`: `operate`. Listing: `observe`.
- `PUT /api/config` cannot write `trustedPlugins`.
- `pi-package` server entry default-deny (`server-untrusted`) until `{server:true}`.
- Hash: stat cache `(relpath,size,mtimeMs,ino,ctimeMs)`; dropped on refresh. Rebuild → `pin-mismatch` → Trust this version.
- Freshness: runtime client live; `serveApp` restart-effective.

## Serving
- `GET /plugin-assets/:id/:sha/*`: admitted pairs only, per-request hash recheck, 404 else, immutable cache, realpath-confined, no `.map`/`.json`.
- Auth = same as `/assets/*`. No OAuth skip. Bearer-only paired device: no admission under OAuth (code-read, not run on device).
- `public/sw.js` passes through `/plugin-assets/`, `/host/`.

## Listing + load
- `GET /api/plugins/runtime-clients`: `{id, displayName, priority, sha256, entry, styles?, i18nCatalog?, eventTypes, claims, routes}`.
- Loader `client/src/lib/plugins/runtime-plugin-loader.ts`. Skips on remote server (`getApiBase()`) or no import map.
- `/api/health.plugins[]` path/hash-free; paths + hashes only in guarded `/api/plugins` + `plugins_changed`.

## Reload
- New id hot. Remove/refuse/hash change → reload notice. Server-entry change → restart. Hot route-registering entry → `HOT_ROUTE_RESTART_ERROR`.

## Misc
- CSP: import map needs `'unsafe-inline'`; `blob:` not allowed; nonce supported by `injectImportMap`.
- CSS: utilities-only Tailwind v4, host vars by reference.
- Canary: `tests/fixtures/runtime-canary-plugin`, `npm run build:canary`.
