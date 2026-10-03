# @blackbelt-technology/pi-dashboard-mcp-client-plugin

Dashboard plugin owning pi's MCP server configuration — the generic MCP server
manager (create / edit / enable / disable, `exposure` / `toolExposure`, global +
folder scope), live state from `pi mcp list --json`, and the effective config
view. Uses pi's BUILT-IN MCP (pi ≥ 1.0.0); no `pi-mcp-adapter`.

## Entries

| Export | Purpose |
|---|---|
| `.` / `./client` | Settings claim + sidebar/worktree folder MCP section + `/folder/:cwd/mcp` page |
| `./server` | `registerPlugin` — provides `mcp-client.config`, mounts the REST surface |
| `./core` | Host-free logic (also consumed by the hostless `apple-tools` installer CLI) |

## Two layers

Pi global `$PI_CODING_AGENT_DIR/mcp.json` (else `~/.pi/agent/mcp.json`) and
trusted `<cwd>/.pi/mcp.json`. A project entry replaces the global entry of the
same name — whole entry, matching pi. Both layers parse as strict `JSON.parse`;
a file with comments or trailing commas is skipped whole by pi and shown as
unparseable. Trust comes from the injected `isProjectTrusted(cwd)` predicate
(the server supplies `host.isProjectTrusted`).

## `mcp-client.config` service

In-process service consumed by other plugins via
`ctx.consume("mcp-client.config")` (declare `dependsOn: ["mcp-client"]`).
Backed by merge-only Pi-owned writes: strict JSON parse, whole-entry replace,
atomic `0o600` write, prototype-key refusal, and a closed refusal union
(`unparseable | entry-not-object | invalid-name | name-collision |
transport-conflict | invalid-entry | write-failed`).

| Method | Purpose |
|---|---|
| `readServerEntry(name, scope)` | Raw file entry from the scope's Pi-owned layer |
| `ensureServerEntry(name, fields, scope)` | Merge a `command`/`url` transport + fields |
| `saveServer(name, entry, scope, previousName?)` | Write a whole entry (optional rename) |
| `setEnabled(name, enabled, scope)` | `enabled: false`, or remove the key |
| `removeServer(name, scope)` | Delete one entry (returns the removed raw entry) |
| `convertAdapterLeftovers(name, scope)` | Convert adapter `disabled` → `enabled: false`, drop other adapter keys |
| `previewEnsure(name, fields, scope)` | Write-suppressed check parity with the writers |
| `readParseStatus(scope)` | Per-layer strict-JSON parse status |
| `getLiveState(scope, { fresh? })` | `pi mcp list --json` rows (30 s timeout + cache) |

## REST surface (`networkGuard` on every route)

| Route | Purpose |
|---|---|
| `GET /api/mcp-client/effective?cwd=` | Effective servers with provenance + live state (global secrets redacted) |
| `GET /api/mcp-client/live?cwd=&fresh=1` | Live state from `pi mcp list --json` |
| `GET /api/mcp-client/schema` | Published config schema |
| `PUT /api/mcp-client/servers/:name` | `{ scope, cwd?, entry, previousName? }` |
| `DELETE /api/mcp-client/servers/:name?scope=&cwd=` | Remove one server → `{ ok, removed }` |
| `PUT /api/mcp-client/servers/:name/enabled` | `{ scope, cwd?, enabled }` |
| `POST /api/mcp-client/servers/:name/convert` | `{ scope, cwd? }` — convert adapter leftovers |

Project `cwd`s must be in the known-folder set (`host.knownFolderCwds`) and
trusted; otherwise the route answers `403 not-allowed` with a `reason`/`hint`
before any IO. Path names are decoded + validated first.

See change: `extract-mcp-client-plugin`, `migrate-mcp-to-pi-builtin`.
