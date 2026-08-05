# DOX — packages/extension/.pi/skills

Files in this directory. One row per file. Non-source area. Skills bundled with the
pi-dashboard bridge extension; ship inside the published package. Rows relocated from
`.pi/skills/AGENTS.md`, which indexed them at a path they never occupied.

| File | Purpose |
|------|---------|
| `pi-dashboard/commands/` | `/dashboard:*` slash-command templates (33 `dashboard-*.md`). → see `pi-dashboard/commands/.AGENTS.md` |
| `pi-dashboard/commands/dashboard-flow-abort.md` | LLM-bound command. Resolves `<id-prefix>` via GET /api/sessions, POST /api/session/<full-id>/flow-control body {"action":"abort"}. Reports result. Usage `/dashboard:flow-abort <id-prefix>`. |
| `pi-dashboard/commands/dashboard-flow-auto.md` | LLM-bound command. POST /api/session/<full-id>/flow-control body {"action":"toggle_autonomous"}. Reports new autonomous state. Usage `/dashboard:flow-auto <id-prefix>`. |
| `pi-dashboard/commands/dashboard-git-branches.md` | LLM-free bash command. curl `$PI_DASHBOARD_BASE/api/git/branches?cwd=$PWD`, jq prints branches, current marked `*`. |
| `pi-dashboard/commands/dashboard-git-init.md` | LLM-bound command. POST /api/git/init body {"cwd":"<cwd>"}. Defaults cwd to `$PWD` if no arg. Usage `/dashboard:git-init [cwd]`. |
| `pi-dashboard/commands/dashboard-git-stash-pop.md` | LLM-bound command. POST /api/git/stash-pop body {"cwd":"<cwd>"}. Defaults cwd to `$PWD` if no arg. Usage `/dashboard:git-stash-pop [cwd]`. |
| `pi-dashboard/commands/dashboard-peer-list.md` | LLM-free bash command. curl `$PI_DASHBOARD_BASE/api/known-servers`, jq prints `label host:port`. |
| `pi-dashboard/commands/dashboard-peer-scan.md` | LLM-free bash command. POST `$PI_DASHBOARD_BASE/api/discover-servers`, jq prints `host:port v<version> (local)`. |
| `pi-dashboard/commands/dashboard-pin-list.md` | LLM-free bash command. curl `$PI_DASHBOARD_BASE/api/pinned-dirs`, jq prints each pinned dir. |
| `pi-dashboard/commands/dashboard-proposal-archive.md` | LLM-free bash command. curl `$PI_DASHBOARD_BASE/api/openspec-archive?cwd=$PWD`, jq prints `date name` newest first. |
| `pi-dashboard/commands/dashboard-proposal-attach.md` | LLM-bound command. Resolve `<id-prefix>`, POST /api/session/<full-id>/attach-proposal body {"changeName":"<change-name>"}. Usage `/dashboard:proposal-attach <id-prefix> <change-name>`. |
| `pi-dashboard/commands/dashboard-proposal-detach.md` | LLM-bound command. Resolve `<id-prefix>`, POST /api/session/<full-id>/detach-proposal body {}. Usage `/dashboard:proposal-detach <id-prefix>`. |
| `pi-dashboard/commands/dashboard-server-config.md` | LLM-free bash command. curl `$PI_DASHBOARD_BASE/api/config`, jq pretty-prints (secrets redacted). |
| `pi-dashboard/commands/dashboard-server-health.md` | LLM-free bash command. curl `$PI_DASHBOARD_BASE/api/health`, jq prints `ok pid uptime`. |
| `pi-dashboard/commands/dashboard-server-tunnel-off.md` | LLM-bound command. POST /api/tunnel-disconnect, then GET /api/tunnel-status confirms inactive. Usage `/dashboard:server-tunnel-off`. |
| `pi-dashboard/commands/dashboard-server-tunnel-on.md` | LLM-bound command. POST /api/tunnel-connect, then GET /api/tunnel-status reports public URL. Usage `/dashboard:server-tunnel-on`. |
| `pi-dashboard/commands/dashboard-server-tunnel-status.md` | LLM-free bash command. curl `$PI_DASHBOARD_BASE/api/tunnel-status`, jq prints `status url serverOs`. |
| `pi-dashboard/commands/dashboard-session-abort-all.md` | LLM-bound command. GET /api/sessions lists streaming/active; confirms scope with user (all / current cwd /… → see `pi-dashboard/commands/dashboard-session-abort-all.md.AGENTS.md` |
| `pi-dashboard/commands/dashboard-session-abort.md` | LLM-bound slash command `/dashboard:session-abort <id-prefix>`. Resolves id-prefix via GET /api/sessions, POSTs /api/session/<full-id>/abort. |
| `pi-dashboard/commands/dashboard-session-diff.md` | LLM-free bash slash command `/dashboard:session-diff <id-prefix>`. Resolves id then curls /api/session-diff?sessionId=, prints per-file gitDiff. |
| `pi-dashboard/commands/dashboard-session-fork.md` | LLM-bound slash command `/dashboard:session-fork <id-prefix>`. POSTs /api/session/<full-id>/resume with body {"mode":"fork"}, reports new session id. |
| `pi-dashboard/commands/dashboard-session-hide.md` | LLM-bound slash command `/dashboard:session-hide <id-prefix>`. POSTs /api/session/<full-id>/hide to hide session from dashboard list. |
| `pi-dashboard/commands/dashboard-session-info.md` | LLM-free bash slash command `/dashboard:session-info <id-prefix>`. Fetches /api/sessions and prints every field of the matched session. |
| `pi-dashboard/commands/dashboard-session-kill.md` | LLM-bound slash command `/dashboard:session-kill <id-prefix>`. DESTRUCTIVE: confirms with user then POSTs /api/session/<full-id>/shutdown to terminate session process. |
| `pi-dashboard/commands/dashboard-session-list-active.md` | LLM-free bash slash command `/dashboard:session-list-active`. Filters /api/sessions for status streaming|active, prints 8-char id status name cwd. |
| `pi-dashboard/commands/dashboard-session-list-here.md` | LLM-free bash slash command `/dashboard:session-list-here`. Filters /api/sessions for cwd==$PWD, prints 8-char id status name. |
| `pi-dashboard/commands/dashboard-session-list.md` | LLM-free bash slash command `/dashboard:session-list`. Prints /api/sessions rows: 8-char id status name cwd. |
| `pi-dashboard/commands/dashboard-session-model.md` | LLM-bound slash command `/dashboard:session-model <id-prefix> <provider/modelId>`. Splits arg on '/', POSTs /api/session/<full-id>/model {provider, modelId}. |
| `pi-dashboard/commands/dashboard-session-rename.md` | LLM-bound slash command `/dashboard:session-rename <id-prefix> <name>`. POSTs /api/session/<full-id>/rename {name}. |
| `pi-dashboard/commands/dashboard-session-resume.md` | LLM-bound slash command `/dashboard:session-resume <id-prefix>`. POSTs /api/session/<full-id>/resume {"mode":"continue"}. |
| `pi-dashboard/commands/dashboard-session-spawn.md` | LLM-bound slash command `/dashboard:session-spawn [cwd]`. POSTs /api/session/spawn {cwd}; defaults cwd to current working directory. Reports new session id. |
| `pi-dashboard/commands/dashboard-session-tell.md` | LLM-bound slash command `/dashboard:session-tell <id-prefix> <text>`. POSTs /api/session/<full-id>/prompt {text}; reports 404 not found / 502 no bridge on failure. |
| `pi-dashboard/commands/dashboard-session-thinking.md` | LLM-bound slash command `/dashboard:session-thinking <id-prefix> <level>`. POSTs /api/session/<full-id>/thinking-level {level} (off|low|medium|high). |
| `pi-dashboard/commands/dashboard-session-unhide.md` | LLM-bound slash command `/dashboard:session-unhide <id-prefix>`. POSTs /api/session/<full-id>/unhide to restore a hidden session to the list. |
| `pi-dashboard/commands/README.md` | Documents `/dashboard:*` slash commands. Naming `/dashboard:<resource>-<verb>[-<modifier>]`; files… → see `pi-dashboard/commands/README.md.AGENTS.md` |
| `pi-dashboard/references/api-reference.md` | Complete REST API reference for skill |
| `pi-dashboard/references/recipes.md` | Multi-step orchestration recipes |
| `pi-dashboard/references/slash-commands.md` | Reference catalog of every `/dashboard:*` slash command with args and LLM-free vs LLM-bound classification. Naming grammar `/dashboard:<resource>-<verb>[-<modifier>]`. |
| `pi-dashboard/scripts/dashboard-api.sh` | Helper script with port auto-detection + auth |
| `pi-dashboard/SKILL.md` | Bundled skill: monitor + control dashboard from any pi session. → see `pi-dashboard/SKILL.md.AGENTS.md` |
