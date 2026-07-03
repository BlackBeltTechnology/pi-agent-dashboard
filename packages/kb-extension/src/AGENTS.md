# DOX — packages/kb-extension/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `extension.ts` | Extension entry. Registers kb_search/kb_neighbors/kb_get native tools. tool_result hook: Job 1 md write→debounced hash-gated reindex; Job 2 opt-in doxEnforcement nudge (default OFF, KB_DOX_ENFORCEMENT=1 forces on). Isolated standalone extension, not in bridge.ts. |
| `index.ts` | Barrel. Re-exports extension default + reindex. |
| `reindex.ts` | Pure reindex + DOX-nudge logic. No pi imports. Testable without running pi. |
