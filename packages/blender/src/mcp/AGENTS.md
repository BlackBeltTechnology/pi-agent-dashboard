# DOX — packages/blender/src/mcp

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `server.ts` | `runServer(deps)` (`ServerDeps`, `SUPPORTED_PROTOCOL_VERSIONS`): newline-delimited JSON-RPC 2.0 MCP over stdio (`initialize`, `ping`, `tools/list`, `tools/call`, `notifications/cancelled`; `-32601` unknown method, `-32700` bad JSON). Only protocol on stdout. Lazy: no probe/provision/boot before the first Blender tool call. See change: add-blender-wasm-mcp. |
| `tools.ts` | The 5 tools (`TOOL_DEFS`: `blender_python`, `blender_scene`, `blender_import`, `blender_export`, `blender_reset`), `startTool(name, args, ctx)`: validate args, stage inputs at dequeue, call supervisor, confined all-or-nothing output commit, encode `{sessionReset, durationMs, …}` + printed output (≤ 16 KiB, last block). `errorResult`. See change: add-blender-wasm-mcp. |
| `workspace.ts` | Root confinement + staging: `resolveRoot`, `normaliseRelative`, `confineExisting`, `confineOutput` (realpath, nearest existing ancestor), `readInputs` (≤ 64 files, 256 MiB), `commitOutputs` (stage, back up, rename, roll back; ≤ 512 MiB), `resolveLimits` (`BLENDER_WASM_MAX_{INPUT,OUTPUT}_MB` may only lower). See change: add-blender-wasm-mcp. |
