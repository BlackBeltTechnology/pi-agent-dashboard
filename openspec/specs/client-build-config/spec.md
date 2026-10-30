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

The Tailwind v4 entry stylesheet (`packages/client/src/index.css`) SHALL cover every package shipping client-side React components with Tailwind utility classes, so that utilities referenced only in plugin source are not purged from the production stylesheet. Client-bearing packages that are not plugins (`client-utils/src`, `dashboard-plugin-runtime/src`) keep explicit `@source` directives in `index.css`.

Plugin coverage SHALL come from `packages/client/src/generated/plugin-sources.css`, which `index.css` imports and the dashboard Vite plugin generates from manifests (`dashboard-plugin-loader` "Client-side plugin entries are bundled by Vite"). It SHALL hold one explicit `@source` directive per client-bearing plugin under `<repo>/packages`, fixture or not (independent of the build's fixture policy, so dev and production builds generate the same file): `@source "../../../<plugin>/src/client"` (paths relative to `generated/`), or `@source "../../../<plugin>/src"` for a plugin whose client components live directly under `src/` (e.g. `grammar-plugin`, `quota-plugin`, `roles-plugin`, `demo-plugin`), plus one directive per claim `module` directory outside those.

A bare star glob over sibling `src/client` directories (e.g. `@source "../../*/src/client"`) does NOT expand in this Tailwind v4 setup and additionally embeds the comment-terminating `*/` sequence; explicit enumeration is therefore required. A plugin author SHALL NOT hand-edit `index.css` or the generated file: the previous rule that an author adds a `@source` line by hand is removed, because the line is now derived from the manifest.

A repository test SHALL enumerate every plugin package whose manifest declares a client entry or a `settings-section` claim and fail, naming the package, when no directive in the generated file covers the directory holding that package's client code or a claim `module` file.

#### Scenario: Goal-plugin hover utilities are emitted

- **GIVEN** `goal-plugin/src/client/FolderGoalsSection.tsx` applies
  `hover:text-indigo-300`, and
  `hover:border-indigo-500/70`
- **WHEN** the production build runs (`npm run build`)
- **THEN** `packages/client/dist/assets/index-*.css` SHALL contain
  `hover:text-indigo-300`, and
  `hover:border-indigo-500/70`

#### Scenario: Existing plugin utilities are not regressed

- **WHEN** the production build runs
- **THEN** the emitted stylesheet SHALL still contain `hover:text-blue-400`
  (used by the automation and openspec folder rows)

#### Scenario: Each client-bearing plugin has an explicit @source line

- **GIVEN** a plugin package `packages/<plugin>/src/client` that uses Tailwind
  utility classes
- **WHEN** `packages/client/src/generated/plugin-sources.css` is inspected
- **THEN** it SHALL contain an `@source` directive covering `packages/<plugin>/src/client`
- **AND** `goal-plugin` and `automation-plugin` SHALL each have such a directive

#### Scenario: Plugins without a src/client directory are covered

- **GIVEN** `grammar-plugin`, `quota-plugin` and `roles-plugin` keep their settings components directly under `src/`
- **WHEN** `packages/client/src/generated/plugin-sources.css` is inspected
- **THEN** it SHALL contain directives covering `grammar-plugin/src`, `quota-plugin/src` and `roles-plugin/src`

#### Scenario: Previously missing plugins are covered

- **WHEN** `packages/client/src/generated/plugin-sources.css` is inspected
- **THEN** it SHALL contain a directive covering each of `apple-tools`, `blackhole-plugin`, `browser-plugin`, `chat-gateway`, `cost-estimator`, `roles-plugin` and `demo-plugin`

#### Scenario: Missing directive fails the repository test

- **WHEN** a plugin package with a `settings-section` claim has no covering `@source` directive in the generated file
- **THEN** the repository test SHALL fail and name that package

#### Scenario: index.css lists no plugin directory

- **WHEN** `packages/client/src/index.css` is inspected
- **THEN** it SHALL import `./generated/plugin-sources.css` and SHALL contain no `@source` directive naming a plugin package

### Requirement: Production build is free of mechanical warnings

The production client build (`npm run build`, Vite + Rollup + Lightning CSS via `packages/client/vite.config.ts`) SHALL NOT emit the following warnings:

- **Lightning CSS parse errors.** Documentation prose (code comments, `AGENTS.md`
  sidecars) SHALL NOT contain literal Tailwind-shaped placeholder tokens such as
  `bg-[var(...)]` or `text-[var(...)]`, because Tailwind v4's automatic content
  scanner extracts them as real utilities that Lightning CSS cannot parse.
- **Circular manual chunk.** The `manualChunks` map SHALL NOT place two libraries that
  reference each other into separate chunks. `react-syntax-highlighter` SHALL share a
  chunk with `react-markdown` rather than occupying a separate `syntax` chunk.
- **Defeated dynamic imports for `PdfPreview` and `known-servers-api`.** Each of these
  modules SHALL be imported with a single strategy across the codebase so Rollup does
  not report `dynamic import will not move module into another chunk` for it.

This requirement does NOT cover the `@mdi/js` dynamic-import warning nor the
oversized-chunk (>700 kB) warning; those are owned by the `shrink-client-index-chunk`
change.

#### Scenario: No CSS parse, circular-chunk, or targeted dynamic-import warnings

- **WHEN** the production build runs (`npm run build`)
- **THEN** stderr/stdout SHALL NOT contain `Unexpected token`
- **AND** SHALL NOT contain `Circular chunk`
- **AND** SHALL NOT contain a `dynamic import will not move module into another chunk`
  line naming `PdfPreview.tsx` or `known-servers-api.ts`

#### Scenario: No placeholder utility tokens in scanned source

- **WHEN** `packages/client/src/lib/session/session-status-visuals.ts` and its
  `.AGENTS.md` sidecar are inspected
- **THEN** neither SHALL contain the literal token `bg-[var(...)]` or `text-[var(...)]`

### Requirement: @mdi/js is isolated from the eager entry chunk

The full `@mdi/js` icon set SHALL NOT be part of the cold-landing load. It SHALL NOT be inlined into the client `index` entry chunk, and the landing document (`index.html`) SHALL NOT reference it through the entry script, a `modulepreload` link, or any chunk those statically import. The build SHALL NOT report a `dynamic import will not move module into another chunk` warning for `@mdi/js`.

- Icons imported by name (e.g. `import { mdiRefresh } from "@mdi/js"`) SHALL stay static and tree-shaken, so only the icons the shell actually names ship in the eager graph.
- Resolving an icon from a runtime key string (extension-UI module/action icons, footer-segment icons, `ActionList`, `StatusPill`) SHALL load the full icon set on demand, the first time any key is resolved. The loaded set SHALL be shared by all resolvers and loaded at most once per page.
- The icon-by-key resolver SHALL keep resolving arbitrary extension-supplied keys (the full namespace stays available once loaded). Until the set has loaded, a key-resolved icon SHALL render nothing (no placeholder), then render the icon once the set is available, without throwing. An unknown key SHALL render nothing both before and after the set loads.

This requirement does NOT cover the oversized-chunk (>700 kB) aggregate warning. `chunkSizeWarningLimit` stays at 700, and that warning remains an accepted, documented notice (the lazy full-icon-set chunk and `monaco` are intentionally large and lazy).

#### Scenario: @mdi/js is a dedicated chunk, out of the entry chunk

- **WHEN** the production build runs (`npm run build`)
- **THEN** no chunk referenced by `index.html` (entry script or `modulepreload`), nor any chunk transitively statically imported by them, contains the `@mdi/js` export marker `mdiZodiacAquarius`
- **AND** a separately loadable chunk containing `mdiZodiacAquarius` is emitted in `dist/assets`
- **AND** the gzipped `index` chunk is ≤ 800 KB (the size test's `INDEX_GZ_CAP_BYTES`, which SHALL NOT exceed this value)

#### Scenario: No @mdi/js dynamic-import warning

- **WHEN** the production build runs
- **THEN** the build log contains no `dynamic import will not move module into another chunk` line naming `@mdi/js`

#### Scenario: Icon-by-key still resolves arbitrary keys

- **WHEN** an `ActionList` / `StatusPill` / extension-UI surface renders with a valid MDI key (e.g. `mdiRefresh`)
- **THEN** the corresponding icon path renders once the icon set has loaded
- **AND** an unknown key renders nothing without throwing

#### Scenario: Icon set loads once

- **WHEN** several key-resolved icons mount on the same page
- **THEN** the full icon set is fetched at most once

### Requirement: On-demand subsystems stay out of the cold-landing load
The math engine (`katex`), the non-English UI catalogs (`zh-CN`, `hu`), and the Settings panel SHALL NOT be part of the cold-landing load: no chunk referenced by `index.html` (entry script or `modulepreload`), nor any chunk transitively statically imported by them, SHALL contain them. Each SHALL be emitted as a separately loadable chunk fetched only when first needed. The build guard SHALL detect each by a minified-survivable marker string unique to that subsystem.

#### Scenario: Math engine is off the landing graph
- **WHEN** the production build runs
- **THEN** no landing-graph chunk contains the KaTeX marker
- **AND** a separately loadable chunk containing it is emitted
- **AND** the entry stylesheet contains no `.katex` rule

#### Scenario: Non-English catalogs are off the landing graph
- **WHEN** the production build runs
- **THEN** no landing-graph chunk contains the `hu` or `zh-CN` catalog marker
- **AND** one separately loadable chunk per non-English language is emitted

#### Scenario: Settings panel is off the landing graph
- **WHEN** the production build runs
- **THEN** no landing-graph chunk contains the Settings panel marker
- **AND** a separately loadable chunk containing it is emitted

### Requirement: Theme-token guard covers the shared client packages

The theme-token guard SHALL scan the shared client packages (`packages/client-utils/src` and `packages/dashboard-plugin-runtime/src`) in addition to its existing roots, with the same ratchet rules: a finding not present in the baseline fails, and the baseline may only shrink.

#### Scenario: New fallback literal in a shared primitive fails
- **WHEN** a change adds `var(--accent-primary, #60a5fa)` to a file under `packages/client-utils/src` or `packages/dashboard-plugin-runtime/src`
- **THEN** the theme-token guard SHALL report a new violation and exit non-zero

#### Scenario: Fixed sites leave the baseline
- **WHEN** a baselined finding under either shared package is repaired
- **THEN** its baseline entry SHALL be removed
- **AND** reintroducing it SHALL fail the guard
