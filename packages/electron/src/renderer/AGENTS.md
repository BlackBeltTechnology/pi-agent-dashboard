# DOX — packages/electron/src/renderer

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `doctor.html` | Standalone Doctor window page (no bundling). Renders the doctor report; builds Copy-as-Markdown inline. Cell helper `cell` mirrors `shared/src/md-table-cell.ts` (backslash, pipe, line endings) for the name and message cells; detail cells use `fence`. See change: fix-codeql-small-findings. |
| `remote-connect.html` | Standalone "Connect to Remote Dashboard" window page. Dark-only palette. |
