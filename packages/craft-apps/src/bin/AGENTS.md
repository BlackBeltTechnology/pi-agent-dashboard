# DOX — packages/craft-apps/src/bin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `craft.ts` | `pi-craft` CLI. Exports `main(argv, deps)` + `usage()`. Subcommands `doc prepare` (→ `prepareDoc`; `doc --help` 0, `doc`/unknown 1), `apps`, `status`, `install <app…>|--all` (one report per app, exit 69 if any failed), `launcher status|install`, `verify`, `<app> ensure|path|exec|mcp` (via `runAppCommand`). Exit 0 / 1 usage or failed / 69 provisioning. `isEntry()` realpath guard. No shebang (esbuild banner adds it to `dist`). See change: add-craft-apps-core. |
| `photocraft.ts` | `pi-photocraft` compatibility alias. Exports `main(argv, deps)` + `USAGE`. `ensure`/`path`/`exec`/`mcp` through `runAppCommand` (prog `pi-photocraft`, register entry `["mcp"]` on the `pi-photocraft` launcher), plus `replace-region`. Same outputs/exit codes as the former package. See change: add-photocraft-plugin. |
