# client-build-config Specification

## ADDED Requirements

### Requirement: Production build is free of mechanical warnings

The production client build (`npm run build`, Vite + Rollup + Lightning CSS via
`packages/client/vite.config.ts`) SHALL NOT emit the following warnings:

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
