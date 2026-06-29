# client-build-config Specification

## Purpose
TBD - created by archiving change polish-header-logo-and-card-stripes. Update Purpose after archive.
## Requirements
### Requirement: Vite publicDir resolves to the project-root public/ directory
The Vite build configuration in `packages/client/vite.config.ts` SHALL set `publicDir` to a value that resolves (relative to the configured `root`) to the project-root `public/` directory containing `icon-192.png`, `icon-512.png`, `manifest.json`, and `sw.js`. With `root: "src"`, the correct relative value is `"../../../public"` (three `../` hops). The previous value `"../../public"` resolved to a non-existent `packages/public/` directory, causing Vite to silently skip copying static assets and producing a `dist/` without favicons, the PWA manifest, or the service worker.

#### Scenario: Static public assets are bundled into dist
- **WHEN** the production build runs (`npm run build`)
- **THEN** `packages/client/dist/icon-192.png` exists
- **AND** `packages/client/dist/icon-512.png` exists
- **AND** `packages/client/dist/manifest.json` exists
- **AND** `packages/client/dist/sw.js` exists

#### Scenario: Server serves the bundled icon
- **WHEN** the dashboard server runs in production mode and the client build is present
- **AND** a client requests `GET /icon-192.png`
- **THEN** the response status is 200
- **AND** the response `Content-Type` is `image/png`
- **AND** the response body is the actual PNG (NOT the SPA `index.html` fallback)

### Requirement: Vite proxy port is configurable
The Vite build configuration SHALL not hardcode `8000` as the proxy target port. The proxy port SHALL be resolved at config-load time from the dashboard configuration. See `vite-proxy-port-config` spec for the full resolution contract.

#### Scenario: Hardcoded 8000 is absent from proxy targets
- **WHEN** `packages/client/vite.config.ts` is inspected
- **THEN** neither the `"/api"` proxy target string nor the `"/ws"` proxy target string SHALL contain the literal `8000`
- **AND** the port value SHALL be derived from the config resolution helper

### Requirement: Tailwind source scan covers all plugin client packages

The Tailwind v4 entry stylesheet (`packages/client/src/index.css`) SHALL declare
`@source` directives that cover every package shipping client-side React
components with Tailwind utility classes, so that utilities referenced only in
plugin source are not purged from the production stylesheet. The scan SHALL
include one explicit `@source "../../<plugin>/src/client"` directive per
client-bearing plugin package, in addition to client-bearing packages that do
not nest under `src/client` (`client-utils/src`, `dashboard-plugin-runtime/src`).

A bare star glob over sibling `src/client` directories (e.g.
`@source "../../*/src/client"`) does NOT expand in this Tailwind v4 setup and
additionally embeds the comment-terminating `*/` sequence; explicit
enumeration is therefore required. A plugin author adding a new
`packages/<plugin>/src/client` directory SHALL add a corresponding `@source`
line so that plugin's Tailwind utilities are emitted.

#### Scenario: Goal-plugin hover utilities are emitted

- **GIVEN** `goal-plugin/src/client/FolderGoalsSection.tsx` applies
  `hover:text-indigo-400`, `hover:text-indigo-300`, and
  `hover:border-indigo-500/70`
- **WHEN** the production build runs (`npm run build`)
- **THEN** `packages/client/dist/assets/index-*.css` SHALL contain
  `hover:text-indigo-400`, `hover:text-indigo-300`, and
  `hover:border-indigo-500/70`

#### Scenario: Existing plugin utilities are not regressed

- **WHEN** the production build runs
- **THEN** the emitted stylesheet SHALL still contain `hover:text-blue-400`
  (used by the automation and openspec folder rows)

#### Scenario: Each client-bearing plugin has an explicit @source line

- **GIVEN** a plugin package `packages/<plugin>/src/client` that uses Tailwind
  utility classes
- **WHEN** `packages/client/src/index.css` is inspected
- **THEN** it SHALL contain a `@source "../../<plugin>/src/client"` directive
  for that package
- **AND** `goal-plugin` and `automation-plugin` SHALL each have such a directive

