# markup-repair.spec.ts — index

L3 F12–F13: F12 `/view @markup-broken.adoc` → `.asciidoc-body` converges to one mermaid `svg` (A1) and an `h2` "Next" (A2), banner lists A1+A2, "View original rendering" → no `svg`, no `h2` "Next", `aria-pressed=true`. F13 `/view @mermaid-eof.md` (fence open at EOF) → mermaid `svg`, no "Loading diagram", no banner (M1 is a gate, not a repair). Read-only fixtures. Exemplars `asciidoc-preview.spec.ts`, `diagram-preview.spec.ts`. See change: add-md-adoc-markup-repair.
