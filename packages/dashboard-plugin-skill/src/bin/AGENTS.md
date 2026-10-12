# DOX — packages/dashboard-plugin-skill/src/bin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `scaffold.ts` | CLI bin entry. Reads JSON `Answers` from stdin, validates `outDir`, refuses to overwrite existing dir in `new` mode, renders templates via `render(answers, new FsSink(answers.outDir))`. Exits 2 on usage/JSON errors, 1 on existing-dir. `--write-project-id <abs-folder> <id>` prints one JSON result, exit 1 on refusal; render errors print all violations. See change: add-project-scoped-apps. |
