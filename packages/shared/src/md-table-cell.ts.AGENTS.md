# md-table-cell.ts — index

`escapeMdTableCell(s)` for one GFM table cell; pure, no Node imports. Steps in order: backslash doubled, pipe backslash-escaped, every line ending (CRLF, lone CR, LF) → one space. Used by `doctor-core.ts` markdown (name + message cells) and client `DiagnosticsSection`; `packages/electron/src/renderer/doctor.html` inlines the same three steps. See change: fix-codeql-small-findings.
