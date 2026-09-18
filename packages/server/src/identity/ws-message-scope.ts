/**
 * Browser→Server message classification for the identity plane (openspec §7.4 /
 * §8.3 / design D10). Every inbound message type is classified into exactly one
 * scope so the owner-equality gate is applied uniformly and a NEW road cannot
 * silently skip it — a coverage test re-derives the protocol union and fails if
 * any type is unclassified.
 *
 *   - `session`      → owner-equality gated on `msg.sessionId` (D11). Reads or
 *                      mutates ONE specific session's state/transcript/metadata.
 *   - `session-list` → returns a set of sessions; must be per-ITEM owner-filtered
 *                      (§8.2), never authorize-the-container.
 *   - `non-session`  → a global / workspace / terminal / openspec / roles /
 *                      plugin / relay road. Governed by the OPTIONAL host access
 *                      policy when registered (§8.4), else ungated (today's
 *                      behavior). NOT owner-equality gated.
 *
 * Curation note: several `non-session` types carry a `sessionId` only as CONTEXT
 * for a global/workspace operation (e.g. `request_models`, `role_set`,
 * `list_files`, terminal open/close) — those are deliberately NOT owner-gated.
 * A few (`remove_tag_globally`, `reorder_sessions`) touch multiple sessions and
 * are left to the policy road; their cross-owner effects are a §8.4 concern.
 */

export type MessageScope = "session" | "session-list" | "non-session";

/** Owner-equality gated on `msg.sessionId` (single specific session). */
export const SESSION_OWNED_MESSAGES: ReadonlySet<string> = new Set([
  "abort",
  "accept_replace_proposal",
  "architect_prompt_response",
  "archive_session",
  "attach_proposal",
  "clear_followup_entries",
  "detach_proposal",
  "dismiss_replace_proposal",
  "edit_followup_entry",
  "extension_ui_response",
  "fetch_content",
  "flow_control",
  "force_kill",
  "history_backfill",
  "kill_process",
  "promote_followup_entry",
  "prompt_response",
  "prompt_resync_request",
  "remove_followup_entry",
  "rename_session",
  "resume_session",
  "retry_session",
  "send_prompt",
  "session_unview",
  "session_view",
  "setSessionDisplayPrefs",
  "set_model",
  "set_session_process_drawer",
  "set_session_tags",
  "set_thinking_level",
  "shutdown",
  "stop_after_turn",
  "subagent_resync_request",
  "subscribe",
  "unarchive_session",
  "unsubscribe",
]);

/** Returns a set of sessions — must be per-item owner-filtered (§8.2). */
export const SESSION_LIST_MESSAGES: ReadonlySet<string> = new Set([
  "list_sessions",
  "sessions_page",
]);

/** Global / workspace / terminal / openspec / roles / plugin / relay roads. */
export const NON_SESSION_MESSAGES: ReadonlySet<string> = new Set([
  "add_folder_to_workspace",
  "browser_relay_input",
  "browser_relay_subscribe",
  "browser_relay_unsubscribe",
  "close_inline_terminal",
  "create_terminal",
  "create_workspace",
  "delete_workspace",
  "favorite_model",
  "flow_management",
  "kill_terminal",
  "list_files",
  "move_folder_to_workspace",
  "open_inline_terminal",
  "openspec_bulk_archive",
  "openspec_get",
  "openspec_refresh",
  "pin_directory",
  "plugin_action",
  "plugin_config_write",
  "recovery_dismiss",
  "remove_folder_from_workspace",
  "remove_tag_globally",
  "rename_terminal",
  "rename_workspace",
  "reorder_pinned_dirs",
  "reorder_sessions",
  "reorder_workspace_folders",
  "reorder_workspaces",
  "request_commands",
  "request_models",
  "request_providers",
  "request_roles",
  "role_preset_delete",
  "role_preset_load",
  "role_preset_save",
  "role_remove",
  "role_set",
  "set_folder_collapsed",
  "set_workspace_collapsed",
  "spawn_session",
  "ui_management",
  "unfavorite_model",
  "unpin_directory",
  "watch_files",
  "worktree_init_subscribe",
  "worktree_init_unsubscribe",
]);

/**
 * Classify a Browser→Server message type, or `undefined` when the type is
 * unknown/unclassified (the coverage test forbids this for any protocol
 * member). An unknown runtime type is treated as `non-session` by callers, but
 * the classifier itself does not guess.
 */
export function classifyBrowserMessage(type: string): MessageScope | undefined {
  if (SESSION_OWNED_MESSAGES.has(type)) return "session";
  if (SESSION_LIST_MESSAGES.has(type)) return "session-list";
  if (NON_SESSION_MESSAGES.has(type)) return "non-session";
  return undefined;
}

/** True when a type is owner-equality gated on its `sessionId` (§8.3). */
export function isSessionOwnedMessage(type: string): boolean {
  return SESSION_OWNED_MESSAGES.has(type);
}
