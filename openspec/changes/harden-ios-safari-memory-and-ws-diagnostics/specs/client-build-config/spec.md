## MODIFIED Requirements

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
- **AND** the gzipped `index` chunk is ≤ 900 KB

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
