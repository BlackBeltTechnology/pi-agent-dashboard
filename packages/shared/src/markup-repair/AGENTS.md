# DOX — packages/shared/src/markup-repair

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `asciidoc.ts` | Pure AsciiDoc line scanner `repairAsciiDoc(src)` → `{source, repairs[{rule A1\|A2, line}]}`; no asciidoctor import. A1: bare `[mermaid…]` on `----`/`....` → `[source,mermaid…]`. A2: unterminated top-level `----`/`....` → replace first same-char different-length delimiter, else insert closer before blank line preceding `== Title`. Delimiter stack; nested/list-attached/other block types untouched. Idempotent; per-line terminators kept; original line numbers. Server runs it for display (`/api/file/render`), client for apply. See change: add-md-adoc-markup-repair. |
| `types.ts` | `MarkupRepairRule` (`M2\|M3\|A1\|A2`), `MarkupRepair {rule,line}`, `MarkupRepairResult {source,repairs}` shared by md + adoc repair. See change: add-md-adoc-markup-repair. |
