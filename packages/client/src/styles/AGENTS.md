# DOX — packages/client/src/styles

Files in this directory. One row per source file. Scoped stylesheets imported by `src/index.css` — theme CSS custom properties only, never raw hex.

| File | Purpose |
|------|---------|
| `asciidoc.css` | `.asciidoc-body` typography scope. Styles asciidoctor embedded-output HTML (AsciiDocPreview) AND mammoth html-mode output (DocxPreview) — one shared scope (design D2). Covers heading hierarchy h1..h6 (strictly decreasing, all > 14px body), `#toc` panel + nested indent, `.admonitionblock` flattened from asciidoctor's nested table into an accent card keyed on `.note`/`.tip`/`.warning`/`.caution`/`.important` → `--severity-*` tokens, `table.frame-*`/`grid-*`/`stripes-*` attribute variants, lists/description lists, `.listingblock`/`.literalblock` code, `.quoteblock`/`.sidebarblock`/`.exampleblock`. All colors via theme vars, so `data-theme` switching retargets with no reload. NOT `@tailwindcss/typography` — that package does not know asciidoctor's class vocabulary (rejected in mockup validation); the dead `prose prose-invert` classes were removed from both wrappers. Imported by `src/index.css`. See change: asciidoc-support. |
