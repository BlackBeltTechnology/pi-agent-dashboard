## Why

`npm run build` emits warnings that obscure real regressions. This change removes
the **mechanical, zero-behavior** ones — two Lightning CSS parse errors, one circular
manual-chunk cycle, and two dynamic-import-defeated warnings — so the build output
becomes actionable. The oversized-chunk warning and the coupled `@mdi/js` bloat are
deliberately **out of scope** here; they are a structural concern handled by a
separate change (`shrink-client-index-chunk`).

## What Changes

- **CSS parse errors (×2)** — Reword the literal `bg-[var(...)]` / `text-[var(...)]`
  tokens in `session-status-visuals.ts` comments and its `.AGENTS.md` sidecar so
  Tailwind v4's content scanner stops extracting them as real utilities that
  Lightning CSS cannot parse.
- **Circular chunk `syntax → markdown → syntax`** — Merge `react-syntax-highlighter`
  into the `markdown` manual chunk in `packages/client/vite.config.ts` to remove the
  two-chunk boundary and thus the cycle.
- **Dynamic + static import conflicts (×2)** — For `PdfPreview` and `known-servers-api`,
  align each to a single import strategy so the lazy boundary is honored (or
  intentionally dropped) rather than silently defeated.

**Explicitly out of scope (moved to `shrink-client-index-chunk`):**
- The `@mdi/js` dynamic+static import warning — its root cause is the full-namespace
  icon-by-key lookup that pins all ~7000 icons into the eager `index` chunk (~2.6 MB).
  Fixing the warning naively (`import * as mdi`) would lock that bloat in; the correct
  fix (own `manualChunk`) belongs with the chunk-split work.
- The oversized-chunk (>700 kB) warning — a single aggregate covering `index` (4.8 MB),
  `monaco` (3.9 MB, lazy), `diff` (1.1 MB, lazy), and Monaco workers. Not silenceable
  without either a blunt limit or real chunk restructuring.

No user-visible behavior changes; no runtime API changes; no bundle-size regression.

## Capabilities

### New Capabilities
<!-- none: internal build-tooling fix -->

### Modified Capabilities
- `client-build-config`: add a requirement that the production build emits no CSS
  parse errors, no circular-chunk warning, and no dynamic-import-defeated warning for
  `PdfPreview` / `known-servers-api`.

## Impact

- `packages/client/vite.config.ts` — `manualChunks` map (`markdown`/`syntax` merge).
- `packages/client/src/lib/session/session-status-visuals.ts` (+ `.AGENTS.md` sidecar) — comment wording only.
- `PdfPreview.tsx` importers (`viewer-registry.tsx` + DocxPreview/EmlPreview/PptxPreview/PreviewCard), `known-servers-api.ts` importer (`SettingsPanel.tsx`) — import-strategy alignment.
- No dependencies added or removed. To be verified by a clean `npm run build`.
