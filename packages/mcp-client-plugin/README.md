# @blackbelt-technology/pi-dashboard-mcp-client-plugin

Dashboard plugin owning `pi-mcp-adapter` configuration — the generic MCP server
manager (create / edit / enable / disable, `directTools`, global + folder scope)
and the effective merged config view with layer provenance.

## Entries

| Export | Purpose |
|---|---|
| `.` / `./client` | Settings claim + sidebar/worktree folder MCP section + `/folder/:cwd/mcp` page |
| `./server` | `registerPlugin` — provides `mcp-client.config`, mounts the REST surface |
| `./core` | Host-free logic (also consumed by the hostless `apple-tools` installer CLI) |

## `mcp-client.config` service

In-process service consumed by other plugins via
`ctx.consume("mcp-client.config")` (declare `dependsOn: ["mcp-client"]`).
Backed by merge-only Pi-owned writes: JSONC parse, sibling-preserving patch,
atomic `0o600` write, prototype-key refusal, and a closed refusal union.

| Method | Purpose |
|---|---|
| `readServerEntry(name, scope)` | Raw file entry from the scope's Pi-owned layer |
| `ensureServerEntry(name, fields, scope)` | Merge a `command`/`url`/`socket` transport + fields |
| `applyServerPatch(name, set, unset, scope)` | Patch `set` fields, delete `unset` keys |
| `setServerDisabled(name, disabled, scope)` | Adapter merge re-run; enable deletes `disabled` |
| `setDirectTools(name, tools, scope)` | Per-server `directTools` filter |
| `removeServer(name, scope)` | Delete one entry (returns the removed raw entry) |
| `patchSettings(set, unset)` | Merge the Pi-global `settings` object |
| `ensureAdapterPackage()` | Append `npm:pi-mcp-adapter` to `settings.json` `packages[]` |
| `checkConfigFiles({ serverName, fields })` | Write-suppressed check parity with the writers |
| `adapterVerdict({ fresh? })` | Adapter version vs the `>= 2.20.0` floor |

## REST surface (`networkGuard` on every route)

| Route | Purpose |
|---|---|
| `GET /api/mcp-client/effective?cwd=` | Merged servers with provenance + layer errors + adapter verdict (own-layer secrets redacted) |
| `GET /api/mcp-client/schema` | Published config schema |
| `GET /api/mcp-client/adapter?fresh=1` | Adapter version verdict |
| `PUT /api/mcp-client/servers/:name` | `{ scope, cwd?, set, unset? }` |
| `DELETE /api/mcp-client/servers/:name?scope=&cwd=` | Remove one server |
| `PUT /api/mcp-client/servers/:name/disabled` | `{ scope, cwd?, disabled }` |
| `PUT /api/mcp-client/settings` | `{ set, unset? }` |

Config loading runs the adapter's synchronous loaders in a worker thread with
`adapterLoadTimeoutMs` (default 10000, range 1000–120000); a deadline breach is
`504 adapter-timeout`. Effective-view reads require a `?cwd=` in the
known-folder set (`host.knownFolderCwds`).

See change: `extract-mcp-client-plugin`.
