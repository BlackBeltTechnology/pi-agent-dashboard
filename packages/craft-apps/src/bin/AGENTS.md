# DOX — packages/photocraft/src/bin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `photocraft.ts` | `pi-photocraft` CLI. Exports `main(argv, deps)` + `USAGE`. Subcommands `ensure`, `path`, `exec` (shared streaming `spawn`, `stdio: inherit`, exit code propagated), `mcp` (`--register` → `registerMcp`, else `runMcp`), `replace-region`. Exit 0 / 1 usage or failed edit / 69 provisioning. `isEntry()` realpath guard. No shebang (esbuild banner adds it to `dist`). |
