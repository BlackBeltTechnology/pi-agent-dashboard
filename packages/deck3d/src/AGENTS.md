# DOX — packages/deck3d/src

| File | Purpose |
|------|---------|
| `cli.ts` | `deck3d` CLI entry: `parse | validate | render | build | serve | check | snapshot | overrides` + `fx`/`props` sub-trees. `--help`/`--version`. `serve <deck.md> [--port n] [--check]` runs the loopback authoring server (watch, rebuild, live reload, `/__overrides` + `/__apply` writes). `overrides apply` validate-then-write, so a bad patch leaves `deck.json` byte-unchanged. `fx list --topic`, `fx preview --palette` + `local:<name>`, `fx scaffold|hash|promote`, `check --style`, `props search --role ambient`, `props generate --prompt`, `style: <n>/<N> slides styled` line at end of `build`. `VALUE_FLAGS` single list of flags consuming next argv. See change: deck3d-cinematic-worlds. |
| `ir/AGENTS.md` | Subfolder — Deck IR schema, ids, merge, validation. |
| `parse/AGENTS.md` | Subfolder — markdown grammar + mermaid harvest. |
| `serve/AGENTS.md` | Subfolder — watch-and-rebuild authoring server (`deck3d serve`), SSE live reload, pre-validated loopback write endpoints (`/__overrides`, `/__apply`). |
| `runtime/AGENTS.md` | Subfolder — bundler-inlined browser engine (three.js). |
| `render/AGENTS.md` | Subfolder — deck.html renderer (template + inline runtime + IR + font). |
| `check/AGENTS.md` | Subfolder — browser fit/legibility/overlap/occlusion/contrast rules + driver. |
| `fx/AGENTS.md` | Subfolder — effect corpus (cards + modules), defaults, composition, catalogue. |
| `props/AGENTS.md` | Subfolder — glTF prop search (vendored + Poly Pizza), fetch/hash-pin, embed + credits, generate fallback. |
| `util/AGENTS.md` | Subfolder — `pkgRoot()` so bundled `dist/cli.js` and `src/` resolve package assets identically. |
