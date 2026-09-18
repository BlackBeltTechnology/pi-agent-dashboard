# DOX — packages/deck3d/src

| File | Purpose |
|------|---------|
| `cli.ts` | `deck3d` CLI entry: `parse | validate | render | build | check | snapshot` + `fx`/`props` sub-trees. `--help`/`--version`; subcommand handlers wired as their modules land. |
| `ir/AGENTS.md` | Subfolder — Deck IR schema, ids, merge, validation. |
| `parse/AGENTS.md` | Subfolder — markdown grammar + mermaid harvest. |
| `runtime/AGENTS.md` | Subfolder — bundler-inlined browser engine (three.js). |
| `render/AGENTS.md` | Subfolder — deck.html renderer (template + inline runtime + IR + font). |
