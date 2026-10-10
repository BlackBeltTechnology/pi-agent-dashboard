# DOX — packages/client/src/lib/preview

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `adoc-diagram-splitter.ts` | Pure segment splitter over AsciiDoc rendered HTML (design D2): splits into raw HTML and typed diagram segments (`data-lang="mermaid"|"plantuml"`, `class="language-*"`, `@startuml` sentinel). See change: diagram-rendering. |
| `adoc-math.ts` | Pure `renderAdocMath(html, katex)`: asciidoctor latexmath `\(…\)` inline / `\[…\]` display → KaTeX HTML (`throwOnError:false`, entities decoded). Skips `<pre>`/`<code>` spans. `hasAdocMath(html)` delimiter probe. katex injected → caller lazy-loads. |
| `extract-urls.ts` | Pure `extractRecentUrls(messages: ChatMessage[]): string[]`. → see `extract-urls.ts.AGENTS.md` |
| `file-icon.ts` | `fileIcon(pathOrName)` → `{ iconPath, colorClass }`. Extension-keyed `@mdi/js` glyph + accent color for… → see `file-icon.ts.AGENTS.md` |
| `mdi-icon-lookup.ts` | Extension UI System icon resolver. Exports `resolveMdiIcon(key)` — maps `"mdiCheckCircle"`-style key to… → see `mdi-icon-lookup.ts.AGENTS.md` Now a re-export shim over client-utils `mdi-by-key`: `resolveMdiIcon` = sync `resolveMdiIconSync` (`null` until the lazy set loads), plus `useMdiIconByKey`, `loadMdiIconSet`. Render sites use the hook. See change: harden-ios-safari-memory-and-ws-diagnostics. |
| `mermaid-repair.ts` | Pure rule-based mermaid repair. Exports `repairMermaid(code) → {code, applied: RuleId[]}`, `RuleId` (`R1`…`R7`, no R8), `RepairResult`. Order R1 R2 R3 R6 R4 R5 R7, repeated to fixpoint (≤5 passes) → idempotent. R1 strip U+200B–200D/2060/FEFF + leading `mermaid` line; R2 seq keyword alias → `p_<alias>[_n]` collision-free, bare keyword lines untouched; R3 balance alt/loop/opt/par/critical/rect/break/box; R6 ER type `Mod$T`→`T`; R4 quote `|label|` attached to edge op; R5 quote special-char node labels (compound shapes first, label ≤500 chars); R7 `;`→`,` `#`→`no.` in quoted labels, keeps `#name;`. Kind skips frontmatter + `%%`; `flowchart-*`=flowchart. R4/R5 match on quote-masked line (`d` flag indices). Tests: `__tests__/mermaid-repair.test.ts` (+`.fixtures.ts`, `.parse.test.ts` real mermaid parse). See change: add-mermaid-auto-repair. |
| `preview-dispatch.ts` | Pure `dispatchPreview(target: ViewTarget): RendererKind`. → see `preview-dispatch.ts.AGENTS.md` |
| `wrap-ascii-tables.ts` | Pre-processes markdown to wrap raw ASCII/box-drawing table blocks in fenced code blocks so they render… → see `wrap-ascii-tables.ts.AGENTS.md` |
