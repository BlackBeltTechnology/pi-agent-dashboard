# DOX — packages/deck3d/src

| File | Purpose |
|------|---------|
| `cli.ts` | `deck3d` CLI entry: `parse | validate | render | build | check | snapshot` + `fx`/`props` sub-trees. `--help`/`--version`; subcommand handlers wired as their modules land. |
| `ir/AGENTS.md` | Subfolder — Deck IR schema, ids, merge, validation. |
| `parse/AGENTS.md` | Subfolder — markdown grammar + mermaid harvest. |
| `runtime/AGENTS.md` | Subfolder — bundler-inlined browser engine (three.js). |
| `render/AGENTS.md` | Subfolder — deck.html renderer (template + inline runtime + IR + font). |
| `check/AGENTS.md` | Subfolder — browser fit/legibility/overlap/occlusion/contrast rules + driver. |
| `fx/AGENTS.md` | Subfolder — effect corpus (cards + modules), defaults, composition, catalogue. |
| `props/AGENTS.md` | Subfolder — glTF prop search (vendored + Poly Pizza), fetch/hash-pin, embed + credits, generate fallback. |
| `util/AGENTS.md` | Subfolder — `pkgRoot()` so bundled `dist/cli.js` and `src/` resolve package assets identically. |
