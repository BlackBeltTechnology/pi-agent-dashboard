# Test Plan — migrate-mcp-to-pi-builtin

Stage: design   Generated: 2026-09-30   Regenerated: 2026-10-01 (pi 1.0.0 facts, doubt-review cycles 1–3)

Clarifications resolved: `pi mcp list --json` timeout 30 s, per-cwd cache TTL 30 s (owner, 2026-10-01).

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | registration after delivery | state-transition | L1 | automated | fake `pi.registerMcpServer`; delivery `{token, url:"http://127.0.0.1:8000/mcp"}` | `mcp_token_minted` | `registerMcpServer("pi-dashboard", {url, headers.Authorization:"Bearer <t>", exposure:"deferred"})` called once; `url` equals the delivered one, not the bridge `ws://` endpoint |
| E2 | re-mint replaces | state-transition | L1 | automated | registered with token A | second delivery token B | registration called again with B; no unregister between |
| E3 | session end unregisters | state-transition | L1 | automated | registered | pi `session_shutdown` | `unregisterMcpServer("pi-dashboard")` called once; a later delivery for the ended session does not register |
| E4 | token not in env | EP | L1 | automated | token delivered | delivery handler | `process.env.PI_DASHBOARD_MCP_TOKEN` undefined; no env key holds the token value |
| E5 | no mcp.json write on registration | EP | L1 | automated | temp agent dir with / without `mcp.json` | registration | file absent / byte-identical |
| E6 | migration of provisioned entry | decision-table | L1 | automated | `mcp.json` with (a) provisioned `pi-dashboard` (`requestHeadersCommand.command:"node"`, `args[0]` ending `header-command.mjs`) + `docs`; (b) operator-shaped `pi-dashboard`; (c) unparseable file; (d) file with a `//` comment | server-start migration | (a) only `docs` remains; (b) kept + shadow reported; (c) byte-identical; (d) byte-identical + "not strict JSON" reported |
| E7 | no `/mcp` command registered | EP | L1 | automated | load every dashboard extension with a fake pi | collect `registerCommand` names | no `mcp` |
| E8 | project entry replaces global | EP | L1 | automated | global + trusted folder both define `docs` with different fields | effective view | `docs` equals the folder entry exactly; marked overriding Pi global |
| E9 | trust predicate | decision-table | L1 | automated | folder `.pi/mcp.json`; predicate → true / false / absent | effective view | true → active; false → inactive "project not trusted"; absent → inactive |
| E10 | writer siblings, names, pi validation | decision-table | L1 | automated | file with `a`,`b`, top-level `x`; writes: save `a`; `my server`; `__proto__`; `command`+`url`; `type:"sse"`; `timeout:0`; `args:"x"` | writer | siblings + `x` unchanged; refusals `invalid-name`, `invalid-name`, `transport-conflict`, `invalid-entry` ×3 with pi's reason |
| E11 | enabled semantics + folder copy | decision-table | L1 | automated | global-only `docs` with `Authorization` header and `auth.provider`; disable from trusted folder; then enable | writer | folder copy has `enabled:false`, no header value, no `auth`; enable result offers "remove folder entry" / "re-enter"; global enable removes `enabled` key |
| E12 | folder override without silent secrets | EP | L1 | automated | global `docs` with `Authorization` header + `auth.provider` | override at folder changing only `exposure` | saved folder entry complete except header value and `auth`; editor warned for both |
| E13 | secret masking vs references | EP | L1 | automated | header `Bearer ${GITHUB_TOKEN}`; header `!op read x`; header `Bearer abc123`; env `API_KEY=lit` | render editor | first two shown as written; last two masked with reveal toggle |
| E14 | live state exit-code handling | decision-table | L1 | automated | injected runner: exit 0 + JSON; exit 1 + valid JSON (one server disconnected); exit 1 + garbage; spawn error | server list request | first two → pi state per row incl. disconnected; last two → every row "state unknown" |
| E15 | apple-tools iMCP entry | decision-table | L1 | automated | existing iMCP with `enabled:false`, `exposure:"direct"`; populated `settings.json#packages` | installer re-run | `command` refreshed, `enabled`/`exposure` kept; `settings.json` byte-identical |
| E16 | registration guard | fault-injection (missing API / missing url) | L1 | automated | `pi.registerMcpServer` undefined; throws; delivery without `url` | token delivery | no registration; one log line with session id; `mcp.dashboard_registration_unavailable` sent once; session continues |
| E17 | no adapter requirement | EP | L1 | automated | plugins index + `recommended-extensions.ts` | read | no plugin or recommended entry lists `pi-mcp-adapter` |
| E18 | `-`/`_` name collision | decision-table | L1 | automated | (a) project write `dev_radius`, effective view has global `dev-radius`; (b) re-save existing `dev_radius` itself; (c) global write `dev_radius`, known trusted folder has `dev-radius` | writer | (a) `name-collision` naming both; (b) accepted; (c) `name-collision` naming the folder entry |
| E19 | provider auth global-only | decision-table | L1 | automated | `auth:{provider:"radius"}` on HTTP entry at project vs global scope; on `http://example.com` URL at global | writer | project refused (`invalid-entry`, "global-only"), file byte-identical; global https accepted; non-loopback http refused |
| E20 | exposure alias preserved | EP | L1 | automated | entry `exposure:"codemode-deferred"`; edit `description` only; then change exposure to `direct` | writer + editor | first save keeps alias, editor shows `codemode`; second save writes `direct` |
| E21 | description + auth mode on rows | decision-table | L1 | automated | HTTP entries: `auth.provider:"radius"`; `headers.Authorization`; only `headers["X-Api-Key"]`; plus `description` on one | render server list | description shown; modes "auth: radius" (no sign-in hint), "header", "OAuth" |
| E22 | `pi mcp list` timeout boundary | BVA | L1 | automated | injected runner resolving at 29.9 s / hanging past 30 s (fake timers) | server list request | 29.9 s → pi state; >30 s → child killed, rows "state unknown" |
| E23 | per-cwd cache TTL boundary | BVA | L1 | automated | runner call counter; same cwd requests at t=0, 29.9 s, 30.1 s; other cwd at t=1 s | server list requests | runner called at 0, 30.1 s for cwd A, once for cwd B (3 calls total) |
| E24 | adapter leftover keys | EP | L1 | automated | global entry `{url, disabled:true, directTools:["a"], lifecycle:"lazy"}` | effective view, then "convert" action | view: enabled under pi, keys flagged "ignored by pi"; after convert: `enabled:false`, the three adapter keys removed, other fields unchanged |
| E25 | strict JSON layers | EP | L1 | automated | global file with a trailing comma; valid project file | effective view + global write | global layer reported unparseable ("pi skips it"), project servers still listed; global write refused `unparseable`, file byte-identical |
| E26 | dual-transport entry read | decision-table | L1 | automated | file entries `{command,url}` and `{command,url,type:"stdio"}` | effective view | first shown HTTP with `command` flagged ignored; second shown stdio with `url` flagged ignored |
| E27 | global list loads global layer only | EP | L1 | automated | injected runner recording its cwd; dashboard cwd has a trusted `.pi/mcp.json` | global settings list request | runner cwd is the empty scratch dir; list contains only Pi-global servers |
| E28 | row enable toggle | state-transition | L1 | automated | Pi-global row enabled; write succeeds / write fails | toggle off | success → pending then disabled, entry `enabled:false`; failure → switch reverts, inline row error |
| E29 | route security | EP | L1 | automated | requests without dashboard auth; from an untrusted network; path name `..` | each mcp-client route | refused before any file read/write; `..` refused by name validation |
| E30 | URL delivered by server | EP | L1 | automated | `host.httpPort` returns 9123 | mint for a session | `mcp_token_minted.url === "http://127.0.0.1:9123/mcp"` |
| E31 | legacy-era pi client served | EP | L1 | automated | valid session Bearer; `MCP-Protocol-Version: 2025-11-25`; `initialize` then `tools/list` + one tool call | POST `/mcp` | all succeed, call attributed to the session; `subscriptions/listen` refused as modern-only |
| E32 | host trust service mirrors pi session rule | decision-table | L1 | automated | recorded trust yes / no / none × `defaultProjectTrust` always / ask | `host.isProjectTrusted(cwd)` | recorded decision wins; none + always → true; none + ask → false |
| E33 | doctor rows | decision-table | L1 | automated | `settings.json#packages` with `pi-mcp-adapter`; operator `pi-dashboard` entry; `mcp.json` with a comment | doctor checks | one row each: adapter disables built-in MCP; entry shadows registration; file not strict JSON (path named) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | subprocess cannot read token | fault-injection (env probe) | L3 | automated | dashboard-connected session in the docker harness | bash `env` via the session | output lacks the token and `PI_DASHBOARD_MCP_TOKEN` |
| X2 | real session reaches /mcp | convergence | L3 | automated | docker harness session | `/mcp` listing + `tool_search` + call a dashboard tool; restart dashboard, call again | `pi-dashboard` connected; call authenticates as the session before and after restart |
| X3 | adapter installed | manual | — | manual-only | `pi-mcp-adapter` in `settings.json#packages` | open doctor | [judgment: doctor explains the disabled built-in and the fix clearly] |
| X4 | migration write fails | fault-injection (abort) | L1 | automated | `mcp.json` parseable but rename fails `EACCES` | server-start migration | entry kept, file byte-identical, one warn log with the error code, server start continues |

---

## Coverage summary

- Requirements covered: 24/24 (ADDED + MODIFIED)
- Scenarios by class: edge 33 · perf 0 · frontend 0 · error 4
- Scenarios by level: L1 34 · L2 0 · L3 2 · manual 1
- Scenarios by disposition: automated 36 · manual-only 1

## New infra needed

- none (docker harness via `docker/test-up.sh`)
