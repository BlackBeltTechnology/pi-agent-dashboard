# DOX — packages/blender/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `errors.ts` | `ToolError(code, message)`: the one error type carrying a machine tool code (design D8). Thrown below the MCP layer; `mcp/server.ts` turns it into an `isError` result. See change: add-blender-wasm-mcp. |
| `mcp-register.ts` | `registerMcp(deps)`: read-modify-write `<cwd>/.pi/mcp.json` `mcpServers["blender-wasm"]` = `{command: execPath, args: [launcher, "mcp", …"--root", <realpath>]}`. MERGES an existing entry (replaces `command`/`args`, keeps `enabled`/`env`/others). Refuses symlinked `.pi`/`mcp.json`; invalid JSON, non-object root or `mcpServers` untouched, exit 1; atomic temp + rename; 4 notes + not-a-project-root warning. `SERVER_NAME`, `defaultLauncherPath`. See change: add-blender-wasm-mcp. |
| `pin.ts` | `PIN` (one exact `@knervous/blender-web` version + sha512 + size + tarball URL), `PinSpec`, `parseSri`, `resolveCacheRoot` (`BLENDER_WASM_HOME` → `<agent dir>/tools/blender-wasm`), `REQUIRED_FILES`, `ARCHIVE_ALLOWLIST`, completion stamp (`readStamp`, `isValidCache`), `ProvisionError` + codes. See change: add-blender-wasm-mcp. |
| `provision.ts` | `provision(deps)`: `BLENDER_WASM_DIR` override → valid-cache check → stale-staging sweep → bounded streamed download of the pinned tarball → sha512 vs pin → list-then-extract allowlist → brotli expand + verify vs runtime `raw` manifest → stamp last → atomic rename to `<root>/<version>/`. `commitTree`, `singleFlight`, `sweepStaleStaging`, `repairAfterBootFailure`; every effect injectable (`ProvisionDeps`). See change: add-blender-wasm-mcp. |
| `report.ts` | `provisionReport`, `failureReport`, read-only `cacheStatus` (pinned cached?, cached versions + bytes, source managed/override, licence), `dirBytes`, `readLicence`. Nothing downloads or writes. `JspiMode`. See change: add-blender-wasm-mcp. |
| `tar.ts` | Streaming gunzip + tar reader. `listTar` lists every entry first (rejects absolute/`..`, symlink, hardlink, device, > `MAX_ENTRIES`); `extractAllowlisted` re-lists then writes only allowlisted files inside `dest`. PAX/GNU headers accepted. Failures → `ProvisionError("unsafe-archive")`. See change: add-blender-wasm-mcp. |
