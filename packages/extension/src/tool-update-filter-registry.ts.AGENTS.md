# tool-update-filter-registry.ts — index

Per-tool `tool_execution_update` filter registry. `ToolUpdateFilterRegistry(bus)`: `attach()` listens on `dashboard:register-tool-update-filter`; `setClaims(toolClaims)` (server table) releases held declarations; `apply(toolName,data)` returns a COPY without the declared `dropPaths` (same object when nothing dropped); `stats{declared,refused,applied}`. Data-only validation (toolName, 1..16 safe dot paths, optional `when{path,in}` read as sibling of each drop path), claiming plugin only, one filter per tool. See change: move-subagents-to-plugin (D5).
