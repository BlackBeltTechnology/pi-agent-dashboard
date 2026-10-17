/**
 * Routes and browser-WS verbs deliberately NOT exposed over MCP (change:
 * expand-mcp-tiered-surface, D6). Each entry carries a reason; the completeness
 * test fails a route/verb that is neither bound in the manifest nor listed here.
 */
export interface DenylistEntry {
  /** A route PATH (exact) or path PREFIX (trailing `/`), or a WS verb name. */
  pattern: string;
  reason: string;
}

export const DENYLIST: readonly DenylistEntry[] = [
  { pattern: "/api/auth/", reason: "auth internals" },
  { pattern: "/api/identity/", reason: "identity-plane pre-auth login config; not an MCP tool" },
  { pattern: "/api/model-proxy/", reason: "model-proxy; host-local only" },
  { pattern: "/api/provider-auth/", reason: "provider auth + API-key material" },
  {
    pattern: "/api/providers/:name",
    reason:
      "single-provider credential write; the whole-map set_providers row remains the MCP surface",
  },
  // See change: add-provider-models-refresh.
  { pattern: "/api/providers/:name/refresh", reason: "UI-only Settings → Refresh models trigger" },
  { pattern: "/api/browse/create-project", reason: "UI-only first-run convenience; agents use file_mkdir" },
  { pattern: "/api/electron/", reason: "Electron-only" },
  // Stages, activates and rolls back the dashboard runtime (downloads + runs
  // code; Electron-only). Never an LLM action. See change: electron-runtime-overlay-updates.
  { pattern: "/api/runtime/", reason: "Electron-only runtime update/activation; downloads and runs code" },
  { pattern: "/api/mcp-client/", reason: "MCP client config; UI-only" },
  { pattern: "/api/live-server/", reason: "live-server preview UI" },
  { pattern: "/api/node/", reason: "node runtime UI" },
  { pattern: "/api/preferences/", reason: "UI preferences" },
  { pattern: "/api/packages/health", reason: "packages[] rot diagnostics; Settings UI-only. See change: add-package-health-cleanup" },
  { pattern: "/api/packages/cleanup", reason: "rewrites ~/.pi/agent/settings.json packages[]; user-mediated Settings UI-only. See change: add-package-health-cleanup" },
  { pattern: "/api/grammar/", reason: "UI-only" },
  { pattern: "/api/pi-resources/commands", reason: "composer `/` list for sessionless UIs (folder home, ended session); agents use getpi_resources. See change: redesign-directory-home-split" },
  { pattern: "/api/pi-settings", reason: "pi global settings.json editor (code-executing keys); Settings UI-only. See change: edit-pi-agent-settings" },
  { pattern: "/api/pi-settings/", reason: "pi global settings.json raw write + default-model drift repair; Settings UI-only. See change: edit-pi-agent-settings" },
  { pattern: "/api/roles/used-by", reason: "Model roles page \"used by\" overview; informational, UI-only" },
  { pattern: "/api/kb/", reason: "kb engine admin" },
  // add-acp-session-driver: the spawn picker's {id,name} list; UI-only.
  { pattern: "/api/acp/", reason: "ACP new-session picker agent list; UI-only" },
  // add-server-push-notifications (Decision 12).
  { pattern: "/api/push/", reason: "push management is UI/REST-only in v1" },
  // Access-grant review + creation (change: add-access-grants-and-review). The
  // tab is a local operator surface, and `POST /api/access/grants` is a
  // TRUST-WIDENING action bound to a denial the operator saw (design D12/D15).
  // Exposing it over MCP would hand an LLM client the ability to satisfy that
  // binding from the denial body it can already read, which is precisely the
  // limit D15 states rather than widens.
  { pattern: "/api/access/", reason: "operator-only grant review; trust-widening action" },
  // add-passkey-user-auth: people + passkey invites. Creating users and
  // minting invites widens who can sign in — an operator UI action, never an
  // LLM tool.
  { pattern: "/api/users", reason: "user directory + passkey invites; operator-only, trust-widening" },
  { pattern: "/api/users/", reason: "user directory + passkey invites; operator-only, trust-widening" },
  { pattern: "/api/cost-estimator/", reason: "billing telemetry UI" },
  { pattern: "/api/flows-anthropic-bridge/", reason: "bridge diagnostics" },
  { pattern: "/api/plugins/blackhole/", reason: "plugin-internal" },
  // add-team-plugin: per-user, owner-gated persona/conversation surface for the team app; not an LLM action.
  { pattern: "/api/plugins/skill-atlas/", reason: "derived UI view over getpi_resources (skill relation graph); agents read skills directly" },
  { pattern: "/api/plugins/team/", reason: "per-user team app API (personas, projects, conversations); owner-gated, UI-only" },
  { pattern: "/api/plugins/gmail/", reason: "Google account sign-in, levels and revoke; credential-bearing, UI-only" },
  // add-obs-studio-plugin: mirrors /api/services.
  { pattern: "/api/plugins/obs-studio/", reason: "desktop/webcam pixels and live-production toggles; UI and CLI only" },
  { pattern: "/api/system-one/", reason: "decision-model config, key entry and managed-process control; UI-only" },
  { pattern: "/api/plugins/hermes-memory/", reason: "plugin-internal config" },
  { pattern: "/api/plugins/context-mode-settings/", reason: "plugin-internal config; writes a file under ~/.pi and alters session env" },
  { pattern: "/api/plugins/flows/", reason: "plugin-internal" },
  { pattern: "/api/tools/", reason: "tool-registry UI" },
  // add-service-registry-core: service mutations start processes and write
  // secrets; core keeps the whole surface out of MCP (skills use the CLI).
  { pattern: "/api/services/", reason: "managed services: lifecycle + secrets; CLI/REST only in core" },
  { pattern: "/api/services", reason: "managed services: lifecycle + secrets; CLI/REST only in core" },
  // add-credential-vault: secret store management. Never an LLM action: the
  // vault decides which secrets reach which project, and holds the values.
  { pattern: "/api/vault/", reason: "credential vault: accounts, grants, import; operator-only, secret-bearing" },
  { pattern: "/api/vault", reason: "credential vault: accounts, grants, import; operator-only, secret-bearing" },
  { pattern: "/api/session/:id/vault-bindings", reason: "vault binding state for the session view; UI-only" },
  { pattern: "/api/ws-ticket", reason: "transport credential" },
  { pattern: "/api/local-proof", reason: "mints a one-time local-proof bootstrap code; host-local credential" },
  { pattern: "/api/device-session", reason: "exchanges the device bearer for an httpOnly cookie; browser credential plumbing" },
  { pattern: "/api/pair/challenge", reason: "pairing ceremony" },
  { pattern: "/api/pair/payload", reason: "pairing ceremony" },
  { pattern: "/api/pair/poll", reason: "pairing ceremony" },
  { pattern: "/api/pair/redeem", reason: "pairing ceremony" },
  { pattern: "/api/pair/request", reason: "pairing ceremony" },
  { pattern: "/api/pair/approve", reason: "pairing ceremony" },
  { pattern: "/api/pair/pending", reason: "pairing ceremony" },
  { pattern: "/api/pair/approve-pending", reason: "pairing ceremony" },
  { pattern: "/api/pair/deny", reason: "pairing ceremony" },
  { pattern: "/api/discover-servers", reason: "fleet discovery UI" },
  { pattern: "/api/known-servers", reason: "fleet discovery UI" },
  { pattern: "/api/known-servers/accept-move", reason: "fleet discovery UI; operator-only" },
  { pattern: "/api/known-servers/probe", reason: "fleet discovery UI; operator-only" },
  { pattern: "/api/pi/runtime", reason: "pi runtime UI" },
  { pattern: "/api/tools", reason: "tool-registry UI" },
  { pattern: "/api/open-in-system", reason: "UI-only" },
  { pattern: "/api/reveal-in-file-manager", reason: "UI-only" },
  { pattern: "/api/pinned-dirs", reason: "UI-only" },
  { pattern: "/api/favorite-models", reason: "UI-only" },
  { pattern: "/api/custom-event-groups", reason: "UI-only" },
  { pattern: "/api/canvas-types", reason: "UI-only" },
  // add-project-scoped-apps: backs the client folder-project cache (claim predicates); not an LLM action.
  { pattern: "/api/folder/project", reason: "UI-only: folder project identity for claim predicates" },
  { pattern: "/api/diagram/render", reason: "UI-only" },
  { pattern: "/api/host-gate", reason: "host admission internals" },
  { pattern: "/api/network-interfaces", reason: "fleet enumeration UI" },
  { pattern: "/api/auto-name-outcomes", reason: "UI diagnostics" },
  { pattern: "/api/spawn-failures", reason: "UI diagnostics" },
  { pattern: "/api/quota", reason: "UI quota widget" },
  { pattern: "/api/sessions", reason: "duplicate-of:list_sessions" },
  { pattern: "/api/session/spawn", reason: "duplicate-of:spawn_session" },
  { pattern: "/api/session/:id/prompt", reason: "duplicate-of:send_prompt" },
  { pattern: "/api/session/:id/abort", reason: "duplicate-of:abort" },
  { pattern: "abort", reason: "duplicate-of:abort" },
  { pattern: "accept_replace_proposal", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "add_folder_to_workspace", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "architect_prompt_response", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "archive_session", reason: "duplicate-of:archive_session" },
  { pattern: "attach_proposal", reason: "duplicate-of:attach_proposal" },
  // add-pending-question-stack: answers stay human-in-the-loop.
  { pattern: "/api/questions", reason: "agent prompt answers stay human-in-the-loop; follow-up" },
  { pattern: "/api/questions/", reason: "agent prompt answers stay human-in-the-loop; follow-up" },
  { pattern: "browser_relay_input", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "browser_relay_subscribe", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "browser_relay_unsubscribe", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "clear_followup_entries", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "close_inline_terminal", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "create_terminal", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "create_workspace", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "delete_workspace", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "detach_proposal", reason: "duplicate-of:detach_proposal" },
  { pattern: "dismiss_replace_proposal", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "extension_ui_response", reason: "duplicate-of:extension_ui_response" },
  { pattern: "favorite_model", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "fetch_content", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "flow_control", reason: "duplicate-of:flow_control" },
  { pattern: "flow_management", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "force_kill", reason: "duplicate-of:force_kill" },
  // An operator's answer to an access-grant prompt (change: add-access-grant-dialog).
  // NEVER an MCP tool: an agent able to send it could approve its own denied
  // access, including an allow-always that persists a grant. The answering side
  // is already the accepted residual R-A (design D1b); exposing it to agents
  // would turn that residual into a one-call self-escalation.
  { pattern: "grant_response", reason: "operator-only answer to an access prompt; self-approval risk" },
  { pattern: "kill_process", reason: "duplicate-of:kill_process" },
  { pattern: "kill_terminal", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "list_files", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "list_sessions", reason: "duplicate-of:list_sessions" },
  { pattern: "move_folder_to_workspace", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "open_inline_terminal", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "openspec_bulk_archive", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "openspec_get", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "openspec_refresh", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "pin_directory", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "plugin_action", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "plugin_config_write", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "promote_followup_entry", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "prompt_resync_request", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "recovery_dismiss", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "remove_folder_from_workspace", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "remove_followup_entry", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "remove_tag_globally", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "rename_session", reason: "duplicate-of:rename_session" },
  { pattern: "rename_terminal", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "rename_workspace", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "reorder_pinned_dirs", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "reorder_sessions", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "reorder_workspace_folders", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "reorder_workspaces", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "request_commands", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "request_models", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "request_providers", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "request_roles", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "reset_folder_card_sections", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "resume_session", reason: "duplicate-of:resume_session" },
  { pattern: "retry_session", reason: "duplicate-of:retry_session" },
  { pattern: "role_preset_delete", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "role_preset_load", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "role_preset_save", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "role_remove", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "role_set", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "send_prompt", reason: "duplicate-of:send_prompt" },
  { pattern: "session_unview", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "session_view", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "sessions_page", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "setSessionDisplayPrefs", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "set_default_group_by", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "set_card_section_visibility", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "set_focus_mode", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "set_focus_profile", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "set_folder_collapsed", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "set_folder_expanded", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "set_folder_group_by", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "set_lane_collapsed", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "set_model", reason: "duplicate-of:set_model" },
  { pattern: "set_session_process_drawer", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "set_thinking_level", reason: "duplicate-of:set_thinking_level" },
  { pattern: "set_workspace_collapsed", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "shutdown", reason: "duplicate-of:shutdown" },
  { pattern: "spawn_session", reason: "duplicate-of:spawn_session" },
  { pattern: "stop_after_turn", reason: "duplicate-of:stop_after_turn" },
  { pattern: "subagent_resync_request", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "subscribe", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "ui_management", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "unarchive_session", reason: "duplicate-of:unarchive_session" },
  { pattern: "unfavorite_model", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "unpin_directory", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "unsubscribe", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "watch_files", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "worktree_init_subscribe", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
  { pattern: "worktree_init_unsubscribe", reason: "not-advertised: UI-only, transport, or bridge-internal verb" },
];

/**
 * Whether a route path or WS verb is denylisted. A trailing `/` marks a path
 * PREFIX; otherwise the match is EXACT (so `/api/sessions` does not deny
 * `/api/sessions/archived`).
 */
export function isDenylisted(name: string): boolean {
  return DENYLIST.some((e) =>
    e.pattern.endsWith("/") ? name.startsWith(e.pattern) : name === e.pattern,
  );
}
