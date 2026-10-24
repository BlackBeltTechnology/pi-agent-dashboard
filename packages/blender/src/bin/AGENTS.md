# DOX — packages/blender/src/bin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `blender.ts` | `pi-blender` entry. `main(argv, partialDeps)` dispatches `ensure [--json]` (probe JSPI → provision; unavailable → 69, no fetch), `status [--json]` (cache + JSPI, never downloads), `mcp [--root]` (`runMcpServer`), `mcp --register [--root]` (`registerMcp`); `--help` exit 0, unknown/none exit 1 + `USAGE` on stderr. Exit 0 ok, 1 usage/register, 69 provisioning/JSPI. `runMcpServer` kills the Blender host on SIGINT/SIGTERM/IPC `disconnect`. `CliDeps`, `defaultCliDeps`, `USAGE`. See change: add-blender-wasm-mcp. |
