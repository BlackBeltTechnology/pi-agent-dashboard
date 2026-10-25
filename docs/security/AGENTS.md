# DOX — docs/security

Security map chapters + consolidated register. Entry point: `../security-map.md`. One row per file. Evidence base HEAD `e54074304`.

| File | Purpose |
|---|---|
| `credentials-and-secrets.md` | Secret lifecycle. Storage, transport, rotation, revocation, redaction. Prefix `CRED-`. See change: security-map-audit. |
| `deployment-process-supply-chain.md` | Deploy topologies, OS user, process spawns, file API confinement, CI, supply chain, audit trail. Prefixes `DEP-`, `SUP-`. See change: security-map-audit. |
| `http-gates-and-routes.md` | Root hook chain, identities, tiers, browser protections, high-danger routes, throttling. Prefix `HTTP-`. See change: security-map-audit. |
| `http-route-inventory.md` | All 364 core HTTP routes. Handler path:line, tier, guard, danger class. Rows only, no finding prefix. See change: security-map-audit. |
| `network-surface.md` | Listeners, ports, bind hosts, egress, discovery, tunnels. Prefix `NET-`. See change: security-map-audit. |
| `plugins-client-electron.md` | Plugin trust model, browser sinks + isolation, Electron shell. Prefixes `PLUG-`, `CLI-`, `ELEC-`. See change: security-map-audit. |
| `residual-risks.md` | Consolidated register. 121 canonical findings (6 High). Priorities, accepted risks, doc/code mismatches, open verification items. All prefixes. See change: security-map-audit. |
| `tool-call-guards.md` | Agent tool guards, dashboard MCP surface toward agents, tool × guard matrix. Prefix `TOOL-`. See change: security-map-audit. |
| `websocket-and-bridge.md` | WS endpoints, tickets, bridge ↔ server trust, inbound message handling, DoS bounds. Prefix `WS-`. See change: security-map-audit. |
