# Test Plan — migrate-mcp-to-pi-builtin

Stage: design   Generated: 2026-09-30

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | registration after delivery | state-transition | L1 | automated | fake `pi.registerMcpServer`; token delivered | `mcp_token_minted` | `registerMcpServer("pi-dashboard", {url, headers.Authorization:"Bearer <t>", exposure:"deferred"})` called once |
| E2 | re-mint replaces | state-transition | L1 | automated | registered with token A | second delivery token B | registration called again with B; no unregister gap |
| E3 | revoke unregisters | state-transition | L1 | automated | registered | token revoked / session end | `unregisterMcpServer("pi-dashboard")` called |
| E4 | token not in env | EP | L1 | automated | token delivered | delivery handler | `process.env.PI_DASHBOARD_MCP_TOKEN` undefined |
| E5 | no mcp.json write on registration | EP | L1 | automated | temp agent dir | registration | `mcp.json` absent / byte-identical |
| E6 | migration removes provisioned entry | decision-table | L1 | automated | `mcp.json` with provisioned `pi-dashboard` (header-command signature) + `docs`; operator-shaped `pi-dashboard`; unparseable file | server start migration | first → only `docs`; second → kept + doctor row; third → untouched |
| E7 | no `/mcp` command registered | EP | L1 | automated | load every dashboard extension with a fake pi | collect `registerCommand` names | no `mcp` |
| E8 | project entry replaces global | EP | L1 | automated | global + trusted folder both define `docs` with different fields | effective view | `docs` equals the folder entry exactly |
| E9 | untrusted folder inactive | EP | L1 | automated | folder `.pi/mcp.json`, project untrusted | effective view | servers inactive, reason "project not trusted" |
| E10 | writes keep siblings, validate names | decision-table | L1 | automated | file with `a`,`b`, top-level `x`; save `a`; save `my server`; save entry with `command`+`url` | writer | siblings and `x` unchanged; name refused; transport conflict refused |
| E11 | enabled semantics | decision-table | L1 | automated | disable global-only server from trusted folder; re-enable | writer | folder gets full copy with `enabled:false`; enable removes the key |
| E12 | folder override without silent secrets | EP | L1 | automated | global `docs` with `Authorization` header | override at folder changing only `exposure` | folder entry complete, header absent, editor warning shown |
| E13 | secret masking vs references | EP | L1 | automated | header `Bearer ${GITHUB_TOKEN}`; header `Bearer abc123` | render editor | reference shown as written; literal masked |
| E14 | live state from `pi mcp list --json` | fault-injection (abort) | L1 | automated | runner fails / times out | server list request | rows show "state unknown", no stale state |
| E15 | apple-tools iMCP entry | decision-table | L1 | automated | existing iMCP with `enabled:false`, `exposure:"direct"`; populated `settings.json#packages` | installer re-run | `command` refreshed, `enabled`/`exposure` kept; `settings.json` byte-identical |
| E16 | registration guard | fault-injection (missing API) | L1 | automated | `pi.registerMcpServer` undefined / throws | token delivery | one log line, `mcp.dashboard_registration_unavailable` reported, session continues |
| E17 | no adapter requirement | EP | L1 | automated | plugins index | read | no plugin lists `pi-mcp-adapter` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | subprocess cannot read token | fault-injection (env probe) | L3 | automated | dashboard-connected session in the docker harness | bash `env` via the session | output lacks the token and `PI_DASHBOARD_MCP_TOKEN` |
| X2 | real session reaches /mcp | convergence | L3 | automated | docker harness session | `/mcp` listing + `tool_search` + call a dashboard tool; restart dashboard, call again | `pi-dashboard` connected; call authenticates as the session before and after restart |
| X3 | adapter installed | manual | — | manual-only | `pi-mcp-adapter` in `settings.json#packages` | open doctor | [judgment: doctor explains the disabled built-in and the fix clearly] |

---

## Coverage summary

- Requirements covered: 20/20
- Scenarios by class: edge 17 · perf 0 · frontend 0 · error 3
- Scenarios by level: L1 17 · L2 0 · L3 2
- Scenarios by disposition: automated 19 · manual-only 1

## New infra needed

- none (docker harness via `docker/test-up.sh`)
