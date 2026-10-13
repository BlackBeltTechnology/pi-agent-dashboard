## MODIFIED Requirements

### Requirement: Plugin ordering preserves rehype-raw + KaTeX behavior
The `MarkdownContent` rehypePlugins array SHALL be ordered `[rehypeRaw, rehypeSanitize, rehypeKatex, stripReactRefAttributes]`. `rehypeRaw` runs first so any embedded HTML in markdown source is parsed before KaTeX emits its own HTML output (KaTeX's HTML must NOT be re-parsed by rehype-raw). `rehypeSanitize` runs directly after `rehypeRaw` and before `rehypeKatex`, so untrusted raw HTML is sanitized while KaTeX's generated output is not run through the sanitizer schema; the schema SHALL keep the `math-inline` / `math-display` classes rehype-katex selects on. `stripReactRefAttributes` runs last, after both upstream plugins have produced their final tree.

#### Scenario: Embedded HTML alongside math
- **WHEN** content contains `<details>`, a blank line, `<summary>Theorem</summary>`, a blank line, `$\forall n \geq 0$`, a blank line, and `</details>` (blank lines let remark parse the math inside the HTML block)
- **THEN** the `<details>`/`<summary>` elements SHALL render as HTML (rehypeRaw applied first) and the math inside SHALL be typeset by KaTeX

#### Scenario: Math survives sanitization
- **WHEN** content contains inline `$a^2$` and a display block with `$$` on its own line, `\int_0^1 x\,dx` on the next line and `$$` on the line after
- **THEN** both SHALL be typeset by KaTeX, the first in inline mode and the second in display mode
