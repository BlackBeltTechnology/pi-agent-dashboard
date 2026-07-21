## Context

`npm run build` (Vite + Rollup + Lightning CSS, `packages/client/vite.config.ts`)
emits several warning families. This change fixes only the mechanical, zero-behavior
ones. The oversized-chunk warning and the coupled `@mdi/js` namespace bloat are a
structural concern split out to `shrink-client-index-chunk` (see that change).

## Goals / Non-Goals

**Goals:**
- Remove the two Lightning CSS parse errors, the circular-chunk warning, and the
  `PdfPreview` + `known-servers-api` dynamic-import warnings.
- No user-visible behavior change; no bundle-size regression.

**Non-Goals:**
- The `@mdi/js` dynamic+static warning and any @mdi chunking — owned by
  `shrink-client-index-chunk`.
- Silencing the oversized-chunk (>700 kB) warning — owned by
  `shrink-client-index-chunk`.

## Decisions

**#1 CSS parse errors — reword, don't suppress.** Tailwind v4's content scanner reads
comments + markdown and extracts the literal `bg-[var(...)]` / `text-[var(...)]` tokens
(in `session-status-visuals.ts` comments and its `.AGENTS.md` sidecar) as real
utilities; Lightning CSS then can't parse the placeholder `var(...)`. These two files
are the only source of the fully-prefixed placeholder tokens (bare `var(...)` in
`themes.ts` / `monaco-theme.test.ts` lacks the `bg-`/`text-` prefix, so it is not a
utility candidate). Fix by rewording the prose so the literal 3-dot token never
appears. Chosen over a Tailwind content-ignore config because the tokens are
documentation noise, not real classes.

**#2 Circular chunk — merge into `markdown`.** The app wires `react-syntax-highlighter`
as a `code`-component override inside `MarkdownContent.tsx` (react-markdown does NOT
import the highlighter itself); `MarkdownContent.tsx` statically imports both libs, so
the two chunks are always fetched together regardless. The reported cycle is
`syntax → markdown → syntax`. Moving `react-syntax-highlighter` into the `markdown`
chunk collapses that two-node boundary, so the reported cycle cannot be emitted.
**Verify-gated:** a clean build must confirm `Circular chunk` is gone. If a residual
cycle survives via a *third* chunk (e.g. the highlight/lowlight ecosystem shared with
the `diff` chunk's `@git-diff-view/lowlight`), the reported topology would be
`syntax → markdown → <third> → syntax`; the fix then extends to also merge that third
participant. Do not assert the cycle is gone without the build output.

Note (informational, not this change's concern): merging pushes the `markdown` chunk
to ~1.0 MB (355 KB + 666 KB). That does not add a *new* warning line — Rollup's
oversized-chunk warning is a single aggregate already triggered by larger chunks
(`index`, `monaco`, `diff`) — and silencing that aggregate is owned by
`shrink-client-index-chunk`.

**#3 Dynamic + static import — align to a single strategy per module.**
- `PdfPreview`: dynamically imported (`lazy(() => import("./PdfPreview.js"))` + a
  `<Suspense>` "Loading PDF viewer…" fallback) by four preview components
  (`DocxPreview`, `EmlPreview`, `PptxPreview`, `PreviewCard`) — the deliberate,
  dominant intent — and statically imported by exactly one outlier,
  `viewer-registry.tsx` (line 25), which defeats all four. **Align lazy, not static
  (Option B):** make the `viewer-registry` site lazy too. The registry already
  lazy-loads `MonacoBuffer` via `lazy(() => import("./MonacoBuffer.js"))`, so wrapping
  the pdf viewer in the same `lazy`+`Suspense` pattern is idiomatic and behavior-
  preserving. Rejected Option A (make the four sites static): it would orphan their
  `lazy`/`Suspense` imports (Biome unused-import failure via `quality:changed`), delete
  the loading-fallback UX, and pull the pdf component eagerly — a behavior change. pdfjs
  is loaded independently via `await import("pdfjs-dist")` inside `loadPdfJs()`, so it
  stays lazy under either option; that was never the concern.
- `known-servers-api`: a small plain API module, statically imported by three
  connectivity components and dynamically by `SettingsPanel.tsx`. `SettingsPanel` is
  itself eagerly imported (`App.tsx`), so converting its `await import(...)` to a
  static import is size-neutral and removes the warning.

## Risks / Trade-offs

- `#2` cycle elimination is **verify-gated, not assumed** — a residual 3-node cycle
  through a third chunk would survive the merge; the tasks require confirming
  `Circular chunk` is absent from a clean build and extending the merge if it is not.
- `#2` merged `markdown` chunk grows to ~1.0 MB (355 KB + 666 KB). Vite emits a
  *single aggregate* oversized-chunk warning (verified against the build log), already
  triggered by larger chunks (`index`, `monaco`, `diff`), so the merge adds no new
  warning line. Silencing that aggregate is owned by `shrink-client-index-chunk`;
  that change must account for the enlarged `markdown` chunk when it sets the limit.
- `#3 PdfPreview` (Option B) — after making `viewer-registry` lazy, all five sites are
  dynamic; verify the pdf viewer still renders (via its `<Suspense>` boundary) and that
  pdfjs remains in its own lazy `pdf-*.js` chunk.
