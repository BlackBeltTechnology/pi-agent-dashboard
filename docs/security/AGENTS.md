# DOX — docs/security

Security map chapters + consolidated register. Entry point: `../security-map.md`. One row per file. Evidence base HEAD `e54074304`.

| File | Purpose |
|---|---|
| `credentials-and-secrets.md` | Secret lifecycle. Storage, transport, rotation, revocation, redaction. Prefix `CRED-`. See change: security-map-audit. Updated: pi-agent credential files refused by server file routes (DEP-01 closed); CRED-03 partly mitigated. See change: close-security-map-high-findings. |
| `deployment-process-supply-chain.md` | Deploy topologies, OS user, process spawns, file API confinement, CI, supply chain, audit trail. Prefixes `DEP-`, `SUP-`. See change: security-map-audit. Updated: DEP-01 closed (`AGENT_CREDENTIAL_NAMES` in `always` tier), file-route inventory rows; new residuals DEP-13…DEP-17. See change: close-security-map-high-findings. |
| `http-gates-and-routes.md` | Root hook chain, identities, tiers, browser protections, high-danger routes, throttling. Prefix `HTTP-`. See change: security-map-audit. Updated: HTTP-01 closed (public IdP open enrolment refused, session rejection, reload socket sweep); new HTTP-19. See change: close-security-map-high-findings. |
| `http-route-inventory.md` | All 364 core HTTP routes. Handler path:line, tier, guard, danger class. Rows only, no finding prefix. See change: security-map-audit. |
| `network-surface.md` | Listeners, ports, bind hosts, egress, discovery, tunnels. Prefix `NET-`. See change: security-map-audit. |
| `plugins-client-electron.md` | Plugin trust model, browser sinks + isolation, Electron shell. Prefixes `PLUG-`, `CLI-`, `ELEC-`. See change: security-map-audit. |
| `residual-risks.md` | Consolidated register. 121 canonical findings (map-time counts; HTTP-01, DEP-01, TOOL-01 closed). Priorities, accepted risks, doc/code mismatches, open verification items. All prefixes. See change: security-map-audit. Added: Closed findings (+ ship-time instruction), Residuals added after the map (TOOL-20/21, DEP-13…17, HTTP-19, WS-18, PLUG-09), plugin file-route audit. See change: close-security-map-high-findings. |
| `tool-call-guards.md` | Agent tool guards, dashboard MCP surface toward agents, tool × guard matrix. Prefix `TOOL-`. See change: security-map-audit. Updated: TOOL-01 closed + corrected (MCP answer tools removed), TOOL-04 not closed; new TOOL-20, TOOL-21. See change: close-security-map-high-findings. |
| `websocket-and-bridge.md` | WS endpoints, tickets, bridge ↔ server trust, inbound message handling, DoS bounds. Prefix `WS-`. See change: security-map-audit. Updated: terminal sockets session-tier stamped, reload sweep 4401; new WS-18; WS-17 ↔ TOOL-01 note. See change: close-security-map-high-findings. |
