---
name: mcp-builtin
scope: pi's built-in MCP and the dashboard's per-session pi-dashboard registration.
symptoms:
  - dashboard mcp tools missing
  - pi-dashboard mcp server not connected
  - mcp tools not found in session
  - pi-mcp-adapter installed
  - mcp.json ignored
  - built-in mcp disabled
depends-on: [pi-resolution]
derives-from:
  - packages/extension/.pi/skills/doctor/_lib/checks.ts (checkMcpBuiltin)
  - packages/extension/src/mcp-token-delivery.ts (createMcpDashboardRegistrar)
  - packages/mcp-server-plugin/src/server/legacy-entry-migration.ts (isProvisionedDashboardEntry)
---

## SCOPE
Whether a session can reach the dashboard's `/mcp` through pi's BUILT-IN MCP:
the bridge registers `pi-dashboard` per session with `pi.registerMcpServer()`
(`url` + `Authorization: Bearer <token>`, `exposure: "deferred"`). Three host
conditions silently break that; this module names each one.

## KNOWLEDGE
- An installed `pi-mcp-adapter` registers `/mcp` and DISABLES pi's built-in
  MCP. The registration is then reported by pi as an extension error, not
  thrown, so the bridge cannot see it. The dashboard never removes the package
  (operator's choice).
- An `mcp.json` entry named `pi-dashboard` takes PRECEDENCE over the bridge
  registration. The dashboard-provisioned shape (`requestHeadersCommand.command
  === "node"`, `args[0]` ending `header-command.mjs`) is removed at server start;
  any other shape is the operator's and is only reported.
- pi parses `mcp.json` with strict `JSON.parse`; comments or trailing commas make
  pi skip the WHOLE file (every server in it).
- The bridge's own guard (registration API missing/throwing, delivery without
  `url`) is logged by the server as `mcp.dashboard_registration_unavailable
  session=<id> reason=<reason>` in `~/.pi/dashboard/server.log`.

## CHECKS
- `checkMcpBuiltin({ agentDir, cwd })` from `_lib/checks.ts` → one finding per
  condition, file path named: `adapter-disables-builtin`,
  `operator-entry-shadows-registration`, `mcp-json-not-strict`. Read-only.
- `grep mcp.dashboard_registration_unavailable ~/.pi/dashboard/server.log`.
- `pi mcp list --json` in the session cwd: `pi-dashboard` is NOT listed there
  (registrations are per session); a listed `pi-dashboard` is a file entry.

## FIX ROUTING
- `adapter-disables-builtin` → remove `pi-mcp-adapter` from `settings.json`
  `packages[]` (convert adapter `disabled: true` entries to `enabled: false` in
  Settings → MCP first, or they become active), then reload sessions.
- `operator-entry-shadows-registration` → delete/rename that entry unless the
  override is intended.
- `mcp-json-not-strict` → remove comments / trailing commas from the named file.
- `registration_unavailable reason=no-url` → dashboard server older than the
  bridge: update/restart the dashboard. `api-missing` → pi older than 1.0.0.

## DERIVES-FROM
Source: `packages/extension/.pi/skills/doctor/_lib/checks.ts`,
`packages/extension/src/mcp-token-delivery.ts`,
`packages/mcp-server-plugin/src/server/legacy-entry-migration.ts`.
Hash sidecar: `mcp-builtin.knowledge.hash`.
