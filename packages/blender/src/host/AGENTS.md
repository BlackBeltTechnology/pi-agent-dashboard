# DOX — packages/blender/src/host

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `entry.ts` | `resolveHostEntry`, `hostArgv`, `JSPI_FLAG`: how to start the host child — checkout: tsx + `host.ts`; install: bundled `host.js`. V8 flags precede `--import`. See change: add-blender-wasm-mcp. |
| `host.ts` | Disposable Blender host child (one process = one session). `--probe` prints `{jspi, node}`; normal mode poses as a browser page for the published `st` runtime (runtime-confined `fetch`, worker_thread `Worker`), boots, sends `{type:"ready"}`, serves `HostRequest` ops over IPC one at a time; exits on worker error, fatal, corrupt response or IPC `disconnect`. See change: add-blender-wasm-mcp. |
| `jobs.ts` | `buildJobScript(op, args)`: Python wrapper per op (python/scene/import/export/reset) with the bpy prelude; `interpretResponse` validates report.json, nonce status file and re-summed output bytes; `tailBytes`, `stripProtocolNoise`; `IMPORT_EXTENSIONS`/`EXPORT_EXTENSIONS`. Pure, no I/O. See change: add-blender-wasm-mcp. |
| `probe.ts` | `probeJspi(spawn, node)`: runs `host --probe` without then with `--experimental-wasm-jspi`; → `native` / `flag` / `unavailable` (unknown V8 flag = unavailable). Spawn injectable; never touches network or runtime. See change: add-blender-wasm-mcp. |
| `protocol.ts` | IPC contract server ↔ host (`HostRequest`/`HostMessage`, `OpName`, per-op args) and machine codes `TOOL_ERROR_CODES` / `ToolErrorCode` / `HostErrorCode`. See change: add-blender-wasm-mcp. |
| `supervisor.ts` | `Supervisor`: owns the one host child. Lazy; FIFO, one in flight, queue ≤ 32; first call probes JSPI → provisions → spawns + boots (120 s, repair on failure); per-call timeout kills the host (SIGKILL); idle shutdown (`BLENDER_WASM_IDLE_SEC`, 600 s); `sessionReset` true on first result after a lost session; crash → `session-crashed` + stderr tail. All effects injectable (`SupervisorDeps`, `defaultSupervisorDeps`). See change: add-blender-wasm-mcp. |
| `worker-boot.cjs` | CommonJS worker_thread bootstrap, copied verbatim to `dist/`. Deletes `process` and every network constructor, rejects `fetch`, `importScripts` reads only the runtime dir (sandbox, design D1). See change: add-blender-wasm-mcp. |
