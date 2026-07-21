# client-build-config Specification

## ADDED Requirements

### Requirement: @mdi/js is isolated from the eager entry chunk

The `@mdi/js` icon set SHALL NOT be inlined into the client `index` entry chunk, and
the build SHALL NOT report a `dynamic import will not move module into another chunk`
warning for `@mdi/js`.

- `@mdi/js` SHALL be assigned its own `manualChunks` entry in
  `packages/client/vite.config.ts`, so the icon set is emitted as a dedicated `mdi`
  chunk rather than inlined into `index`.
- The two dynamic `import("@mdi/js")` sites (`ActionList.tsx`, `StatusPill.tsx`) SHALL be
  converted to static imports so no module is imported both dynamically and statically —
  a `manualChunks` entry alone does NOT silence that warning.
- The icon-by-key resolver SHALL keep resolving arbitrary extension-supplied keys (the
  full namespace is retained; no tree-shaking).

This requirement does NOT cover the oversized-chunk (>700 kB) aggregate warning;
`chunkSizeWarningLimit` remains at 700 and that warning is an accepted, documented notice
(`monaco` is intentionally large and lazy).

#### Scenario: @mdi/js is a dedicated chunk, out of the entry chunk

- **WHEN** the production build runs (`npm run build`)
- **THEN** a `mdi-*.js` chunk is emitted in `dist/assets`
- **AND** the main entry chunk (resolved from `index.html`) does NOT contain `@mdi/js`
  icon export markers (e.g. `mdiZodiacAquarius`)
- **AND** the gzipped `index` chunk is ≤ 900 KB (baseline ~1388 KB before this change)

#### Scenario: No @mdi/js dynamic-import warning

- **WHEN** the production build runs
- **THEN** the build log contains no `dynamic import will not move module into another
  chunk` line naming `@mdi/js`

#### Scenario: Icon-by-key still resolves arbitrary keys

- **WHEN** an `ActionList` / `StatusPill` renders with a valid MDI key (e.g. `mdiRefresh`)
- **THEN** the corresponding icon path renders
- **AND** an unknown key renders nothing without throwing
