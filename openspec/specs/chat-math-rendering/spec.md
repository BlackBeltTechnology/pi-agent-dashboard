# Chat Math Rendering

## Purpose

LaTeX math rendering for the chat surface. The `MarkdownContent` component wires `remark-math` into the remark plugin chain and `rehype-katex` (with `throwOnError: false`) into the rehype plugin chain so both inline single-dollar `$…$` and display double-dollar `$$\n…\n$$` (block-level) expressions typeset to KaTeX-rendered HTML. The KaTeX stylesheet is loaded once at app entry. Half-formed mid-stream expressions render as a fallback rather than crashing the markdown view; standalone dollar amounts (`$100`) continue to render as literal text per remark-math's standard heuristics.

## Requirements

### Requirement: MarkdownContent typesets LaTeX math via remark-math + rehype-katex
The `MarkdownContent` component SHALL include `remark-math` in its `remarkPlugins` array and `rehype-katex` in its `rehypePlugins` array such that LaTeX math expressions in markdown content are typeset to KaTeX-rendered HTML. Both inline single-dollar (`$…$`) and display double-dollar (`$$…$$`) delimiters SHALL be enabled (`singleDollarTextMath: true`). The KaTeX stylesheet (`katex/dist/katex.min.css`) SHALL be imported once at the application entry so the typeset elements display correctly across the app.

#### Scenario: Inline math in single dollars
- **WHEN** content contains `Pythagoras: $a^2 + b^2 = c^2$.`
- **THEN** the rendered DOM SHALL contain a `.katex` element typesetting `a^2 + b^2 = c^2` and the surrounding prose SHALL render normally

#### Scenario: Display math in double dollars
- **WHEN** content contains `$$\sum_{i=0}^{n} i = \frac{n(n+1)}{2}$$`
- **THEN** the rendered DOM SHALL contain a `.katex-display` element typesetting the summation

#### Scenario: Greek letters and operators
- **WHEN** content contains `$x = 10 + \beta$`
- **THEN** the rendered output SHALL contain a typeset `β` glyph (not the literal text `\beta`)

#### Scenario: Inline math inside list item
- **WHEN** content contains a list whose item is `- The bound is $O(n \log n)$.`
- **THEN** the list item SHALL render with the math typeset inline within the `<li>`

### Requirement: Half-formed math during streaming does not throw
The KaTeX rehype plugin SHALL be configured with `throwOnError: false` so that mid-stream content like `$x = 10 +` does not throw a `ParseError` and crash the markdown render. Half-formed expressions SHALL render as a fallback (typically the source text in red, KaTeX's documented fallback).

#### Scenario: Half-formed inline math renders fallback
- **WHEN** the streaming text is `Working: $x = 10 +`
- **THEN** the markdown render SHALL NOT throw and the partial expression SHALL render as a visible fallback string

#### Scenario: Closing delimiter arrives in next chunk
- **WHEN** the streaming text updates from `Working: $x = 10 +` to `Working: $x = 10 + 5$.`
- **THEN** the rendered DOM SHALL update from the fallback to a typeset `x = 10 + 5`

### Requirement: Plugin ordering preserves rehype-raw + KaTeX behavior
The `MarkdownContent` rehypePlugins array SHALL be ordered `[rehypeRaw, rehypeSanitize, rehypeKatex, stripReactRefAttributes]`. `rehypeRaw` runs first so any embedded HTML in markdown source is parsed before KaTeX emits its own HTML output (KaTeX's HTML must NOT be re-parsed by rehype-raw). `rehypeSanitize` runs directly after `rehypeRaw` and before `rehypeKatex`, so untrusted raw HTML is sanitized while KaTeX's generated output is not run through the sanitizer schema; the schema SHALL keep the `math-inline` / `math-display` classes rehype-katex selects on. `stripReactRefAttributes` runs last, after both upstream plugins have produced their final tree.

#### Scenario: Embedded HTML alongside math
- **WHEN** content contains `<details>`, a blank line, `<summary>Theorem</summary>`, a blank line, `$\forall n \geq 0$`, a blank line, and `</details>` (blank lines let remark parse the math inside the HTML block)
- **THEN** the `<details>`/`<summary>` elements SHALL render as HTML (rehypeRaw applied first) and the math inside SHALL be typeset by KaTeX

#### Scenario: Math survives sanitization
- **WHEN** content contains inline `$a^2$` and a display block with `$$` on its own line, `\int_0^1 x\,dx` on the next line and `$$` on the line after
- **THEN** both SHALL be typeset by KaTeX, the first in inline mode and the second in display mode

### Requirement: $100-style prose is not auto-parsed as math by virtue of single-dollar mode
With `singleDollarTextMath: true`, remark-math's standard heuristics SHALL still apply: a single dollar followed by whitespace, end-of-line, or a non-math character is treated as literal text rather than the start of math. This matches GitHub / ChatGPT / Google rendering. Users who need to display literal `$100` adjacent to an actual math expression SHALL escape with `\$100`.

#### Scenario: Standalone dollar amount renders literally
- **WHEN** content contains `It costs $100 today.`
- **THEN** the rendered text SHALL contain the literal string `$100` (no KaTeX node)

#### Scenario: Two unrelated dollar amounts in one paragraph render literally
- **WHEN** content contains `It cost $100 yesterday and $200 today.`
- **THEN** there SHALL be no `.katex` element in the rendered output and both `$100` and `$200` SHALL render as literal text

#### Scenario: Escaped dollar before math expression
- **WHEN** content contains `Total \$100, where $x > 0$.`
- **THEN** `$100` SHALL render literally and `x > 0` SHALL be typeset
