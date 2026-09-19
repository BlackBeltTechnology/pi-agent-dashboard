# Pi Dashboard MCP Server Plugin

Built-in Pi Dashboard plugin exposing a dual-era MCP endpoint at `POST /mcp`.

Implements dual-era protocol support:
- **Modern (`2026-07-28`):** stateless, handshake-free, no session ids, `server/discover`, and `subscriptions/listen` streaming over tier-filtered manifest of tools (`observe` < `control` < `operate`) bound to REST routes, browser-WS verbs and the `ServerPluginContext` (the original `list_sessions`, `send_prompt`, `spawn_session`, `abort` plus the wider capability surface).
- **Legacy (`2025-03-26`, `2025-06-18`, `2025-11-25`):** Streamable-HTTP handshake via `initialize`, echoes negotiated version or negotiates down to `2025-11-25` on unknown version (modern `2026-07-28` on `initialize` refused with 404 / `-32601`), returns opaque unrecorded `Mcp-Session-Id` header, accepts `notifications/*` with 202, returns `{}` on `ping`. Streaming refused (404 `MethodRemoved`).
- **Negotiation:** resolved once per request in `routes.ts` before streaming interceptor. Repeated or comma-joined header returns 400 `AmbiguousHeader`. Absent version markers default to legacy `2025-03-26`. Header and `params._meta` must agree when both present. Pi-global `mcp.json` provisioning stays pinned to `2026-07-28`.

Every request is authenticated — including loopback:
- Bridge session tokens minted via `mcp/mint-token` over session WebSocket.
- Paired-device bearer tokens passed via `Authorization: Bearer <token>`. External MCP clients (Claude Code, Cursor) mint bearer tokens via operator-gated `POST /api/paired-devices` (login session, `X-Pi-Local-Token`, or genuine local loopback + Host admission). Plaintext token returned once; stored as SHA-256 hash in `paired-devices.json` with `source: "manual"`.

> **Bundled plugin.** This package ships inside the dashboard and is discovered at
> build time by a scan of `packages/*` — *not* from `node_modules`. Installing it
> standalone from npm does not activate it in an existing dashboard install. It is
> published so plugin authors can read the source and depend on its types.

## Tool catalogue

The advertised MCP tools are generated from the reviewed manifest
(`src/server/tools.manifest.ts`) by `pnpm --filter
@blackbelt-technology/pi-dashboard-mcp-server-plugin codegen`. Each tool
carries a tier (`observe` < `control` < `operate`) and is filtered to the
caller's tier. Do not edit the table by hand.

<!-- tools:start -->

| Tool | Tier | Description |
| --- | --- | --- |
| `list_sessions` | observe | List sessions. Bounded, filterable, cursor-paged; default 25, max 200, hidden excluded. |
| `send_prompt` | control | Send prompt text to a session. |
| `spawn_session` | control | Spawn a new pi session in a working directory. |
| `abort` | control | Abort the running turn of a session. |
| `resume_session` | control | POST /api/session/:id/resume |
| `shutdown_session` | control | POST /api/session/:id/shutdown |
| `archive_session` | control | POST /api/session/:id/archive |
| `unarchive_session` | control | POST /api/session/:id/unarchive |
| `rename_session` | control | POST /api/session/:id/rename |
| `set_model` | control | POST /api/session/:id/model |
| `set_thinking_level` | control | POST /api/session/:id/thinking-level |
| `flow_control` | control | POST /api/session/:id/flow-control |
| `extension_ui_response` | control | POST /api/session/:id/extension-ui-response |
| `attach_proposal` | control | POST /api/session/:id/attach-proposal |
| `detach_proposal` | control | POST /api/session/:id/detach-proposal |
| `list_archived_sessions` | observe | GET /api/sessions/archived |
| `get_archived_session` | observe | GET /api/sessions/archived/:id |
| `get_attachment` | observe | GET /api/sessions/:sessionId/attachments/:attachmentId |
| `get_tool_result` | observe | GET /api/sessions/:sessionId/tool-result/:toolCallId |
| `get_custom_entry` | observe | GET /api/sessions/:sessionId/entry/:entryId |
| `get_transcript` | observe | GET /api/sessions/:sessionId/retained-transcript |
| `get_session_events` | observe | GET /api/events/:sessionId/:seq |
| `get_session_change` | observe | GET /api/session-change/:sessionId/:toolCallId |
| `get_session_diff` | observe | GET /api/session-diff |
| `get_session_file` | observe | GET /api/session-file |
| `get_git_status` | observe | GET /api/git/status |
| `get_git_branches` | observe | GET /api/git/branches |
| `get_git_changed_files` | observe | GET /api/git/changed-files |
| `get_git_pull_requests` | observe | GET /api/git/pull-requests |
| `git_checkout` | control | POST /api/git/checkout |
| `git_commit` | control | POST /api/git/commit |
| `git_commit_draft` | control | POST /api/git/commit-draft |
| `git_worktree_create` | control | POST /api/git/worktree |
| `git_worktree_init` | control | POST /api/git/worktree/init |
| `git_worktree_merge` | control | POST /api/git/worktree/merge |
| `git_worktree_pr` | control | POST /api/git/worktree/pr |
| `file_read` | observe | GET /api/file |
| `file_resolve_mention` | observe | POST /api/file/resolve-mention |
| `file_tree` | observe | GET /api/file/tree |
| `file_grep` | observe | GET /api/grep |
| `file_write` | control | POST /api/file/write |
| `file_mkdir` | control | POST /api/browse/mkdir |
| `get_openspec_tasks` | observe | GET /api/openspec/tasks |
| `get_openspec_config` | observe | GET /api/openspec/config |
| `toggle_openspec_task` | control | POST /api/openspec/tasks/toggle |
| `set_openspec_config` | control | POST /api/openspec/config |
| `list_goals` | observe | GET /api/folders/goals |
| `create_goal` | control | POST /api/folders/goals |
| `update_goal` | control | PATCH /api/folders/goals/:id |
| `delete_goal` | control | DELETE /api/folders/goals/:id |
| `attach_goal_session` | control | POST /api/folders/goals/:id/sessions |
| `detach_goal_session` | control | DELETE /api/folders/goals/:id/sessions/:sid |
| `list_automation_runs` | observe | GET /api/plugins/automation/runs |
| `list_automation` | observe | GET /api/plugins/automation/list |
| `run_automation` | control | POST /api/plugins/automation/run |
| `stop_automation` | control | POST /api/plugins/automation/stop |
| `list_models` | observe | GET /api/models |
| `list_providers` | observe | GET /api/providers |
| `set_providers` | operate | PUT /api/providers |
| `list_roles` | observe | GET /api/roles |
| `list_plugins` | observe | GET /api/plugins |
| `toggle_plugin` | operate | POST /api/plugins/:id/toggle |
| `list_packages` | observe | GET /api/packages/installed |
| `search_packages` | observe | GET /api/packages/search |
| `install_package` | operate | POST /api/packages/install |
| `remove_package` | operate | POST /api/packages/remove |
| `update_package` | operate | POST /api/packages/update |
| `reload_resources` | operate | POST /api/resources/reload |
| `toggle_resource` | operate | POST /api/resources/toggle |
| `set_config` | operate | PUT /api/config |
| `get_health` | observe | GET /api/health |
| `run_doctor` | observe | GET /api/doctor |
| `get_tunnel_status` | observe | GET /api/tunnel-status |
| `get_tunnel_endpoints` | operate | GET /api/tunnel/endpoints |
| `tunnel_connect` | operate | POST /api/tunnel-connect |
| `tunnel_disconnect` | operate | POST /api/tunnel-disconnect |
| `list_paired_devices` | operate | GET /api/paired-devices |
| `mint_device_token` | operate | POST /api/paired-devices |
| `revoke_device` | operate | DELETE /api/paired-devices/:id |
| `get_reachable_urls` | operate | GET /api/pair/reachable-urls |
| `update_pi_core` | operate | POST /api/pi-core/update |
| `restart_server` | operate | POST /api/restart |
| `shutdown_server` | operate | POST /api/shutdown |
| `stop_after_turn` | control | Session lifecycle: stop_after_turn |
| `retry_session` | control | Session lifecycle: retry |
| `force_kill` | operate | Session lifecycle: force_kill |
| `kill_process` | operate | Session lifecycle: kill_process |
| `set_session_tags` | control | Bridge verb: set_session_tags |
| `prompt_response` | control | Bridge verb: prompt_response |
| `edit_followup_entry` | control | Bridge verb: edit_followup_entry |
| `history_backfill` | observe | Bridge verb: history_backfill |
| `config_auth_providers_id` | control | DELETE /api/config/auth/providers/:id |
| `openspec_groups_id` | control | DELETE /api/openspec/groups/:id |
| `plugins_automation` | control | DELETE /api/plugins/automation |
| `sessions_archived_id` | control | DELETE /api/sessions/archived/:id |
| `getapple_tools_status` | observe | GET /api/apple-tools/status |
| `getbrowse` | observe | GET /api/browse |
| `getbrowse_flags` | observe | GET /api/browse/flags |
| `getconfig` | operate | GET /api/config |
| `getfile_eml` | observe | GET /api/file/eml |
| `getfile_eml_attachment` | observe | GET /api/file/eml-attachment |
| `getfile_exists` | observe | GET /api/file/exists |
| `getfile_md_candidates` | observe | GET /api/file/md-candidates |
| `getfile_md_read` | observe | GET /api/file/md-read |
| `getfile_raw` | observe | GET /api/file/raw |
| `getfile_render` | observe | GET /api/file/render |
| `getfile_rendered_pdf` | observe | GET /api/file/rendered-pdf |
| `getfile_sheet` | observe | GET /api/file/sheet |
| `getgit_head` | observe | GET /api/git/head |
| `getgit_worktree_active_inits` | observe | GET /api/git/worktree/active-inits |
| `getgit_worktree_diff_stat` | observe | GET /api/git/worktree/diff-stat |
| `getgit_worktree_init_status` | observe | GET /api/git/worktree/init-status |
| `getgit_worktrees` | observe | GET /api/git/worktrees |
| `getopenspec_archive` | observe | GET /api/openspec-archive |
| `getopenspec_groups` | observe | GET /api/openspec/groups |
| `getopenspec_update_status` | observe | GET /api/openspec/update-status |
| `getpackages_readme` | observe | GET /api/packages/readme |
| `getpackages_recommended` | observe | GET /api/packages/recommended |
| `getpi_core_changelog` | observe | GET /api/pi-core/changelog |
| `getpi_core_versions` | observe | GET /api/pi-core/versions |
| `getpi_resource_file` | observe | GET /api/pi-resource-file |
| `getpi_resources` | observe | GET /api/pi-resources |
| `getpi_retry` | observe | GET /api/pi-retry |
| `getpi_installs` | observe | GET /api/pi/installs |
| `getplugins_automation_actions` | observe | GET /api/plugins/automation/actions |
| `getplugins_automation_definition` | observe | GET /api/plugins/automation/definition |
| `getplugins_automation_git_capable` | observe | GET /api/plugins/automation/git-capable |
| `getplugins_automation_result` | observe | GET /api/plugins/automation/result |
| `getplugins_automation_trigger_kinds` | observe | GET /api/plugins/automation/trigger-kinds |
| `gettunnel_readiness` | observe | GET /api/tunnel-readiness |
| `gettunnel_status_detail` | observe | GET /api/tunnel-status-detail |
| `gettunnel_block_events` | operate | GET /api/tunnel/block-events |
| `openspec_groups_id_patch` | control | PATCH /api/openspec/groups/:id |
| `config_plugins_id` | operate | POST /api/config/plugins/:id |
| `git_init` | control | POST /api/git/init |
| `git_stash_pop` | control | POST /api/git/stash-pop |
| `git_worktree_from_pr` | control | POST /api/git/worktree/from-pr |
| `git_worktree_orphan_cleanup` | control | POST /api/git/worktree/orphan-cleanup |
| `git_worktree_prune` | control | POST /api/git/worktree/prune |
| `git_worktree_push` | control | POST /api/git/worktree/push |
| `git_worktree_remove` | control | POST /api/git/worktree/remove |
| `git_worktree_remove_batch` | control | POST /api/git/worktree/remove-batch |
| `openspec_groups` | control | POST /api/openspec/groups |
| `openspec_init` | control | POST /api/openspec/init |
| `openspec_update` | control | POST /api/openspec/update |
| `packages_check_updates` | operate | POST /api/packages/check-updates |
| `packages_move` | operate | POST /api/packages/move |
| `packages_reset_to_npm` | operate | POST /api/packages/reset-to-npm |
| `plugins_automation_create` | control | POST /api/plugins/automation/create |
| `plugins_automation_update` | control | POST /api/plugins/automation/update |
| `providers_test` | operate | POST /api/providers/test |
| `resources_trust` | operate | POST /api/resources/trust |
| `tunnel_reserved_name` | operate | POST /api/tunnel-reserved-name |
| `tunnel_enroll` | operate | POST /api/tunnel/enroll |
| `openspec_groups_assignments` | control | PUT /api/openspec/groups/assignments |
| `openspec_groups_change_order` | control | PUT /api/openspec/groups/change-order |
| `pi_retry` | control | PUT /api/pi-retry |

<!-- tools:end -->

## License

MIT — part of [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard).
