/**
 * Browser→Server WS message → required tier (change: add-passkey-user-auth).
 *
 * The WS half of the tier model whose REST half is `route-tiers.ts`. A login
 * session carries a tier (JWT claim, or the passkey directory's live tier);
 * the browser gateway drops a message whose tier is above the socket's.
 * Semantics mirror the REST map:
 *  - `observe` — read/subscribe; nothing persisted beyond this socket.
 *  - `control` — drive sessions (prompt, abort, model, rename, archive,
 *    spawn), shared layout/workspace state, openspec actions.
 *  - `operate` — process kill, terminals, trust grants, real-browser input,
 *    role/plugin configuration.
 *
 * Fail-closed: an UNLISTED type (incl. plugin-registered types) is `operate`.
 * A coverage test asserts every protocol type is listed.
 */
import { type Tier } from "./tiers.js";

export const WS_MESSAGE_TIERS: Readonly<Record<string, Tier>> = {
  // ── observe: reads / subscriptions ──
  browser_relay_subscribe: "observe",
  browser_relay_unsubscribe: "observe",
  fetch_content: "observe",
  history_backfill: "observe",
  list_files: "observe",
  list_sessions: "observe",
  openspec_get: "observe",
  prompt_resync_request: "observe",
  request_commands: "observe",
  request_models: "observe",
  request_providers: "observe",
  request_roles: "observe",
  session_unview: "observe",
  session_view: "observe",
  sessions_page: "observe",
  subagent_resync_request: "observe",
  subscribe: "observe",
  unsubscribe: "observe",
  watch_files: "observe",
  worktree_init_subscribe: "observe",
  worktree_init_unsubscribe: "observe",

  // ── control: drive sessions + shared layout/workspace state ──
  abort: "control",
  accept_replace_proposal: "control",
  add_folder_to_workspace: "control",
  architect_prompt_response: "control",
  archive_session: "control",
  attach_proposal: "control",
  clear_followup_entries: "control",
  create_workspace: "control",
  delete_workspace: "control",
  detach_proposal: "control",
  dismiss_replace_proposal: "control",
  edit_followup_entry: "control",
  extension_ui_response: "control",
  favorite_model: "control",
  flow_control: "control",
  flow_management: "control",
  move_folder_to_workspace: "control",
  openspec_bulk_archive: "control",
  openspec_refresh: "control",
  pin_directory: "control",
  promote_followup_entry: "control",
  prompt_response: "control",
  recovery_dismiss: "control",
  remove_folder_from_workspace: "control",
  remove_followup_entry: "control",
  remove_tag_globally: "control",
  rename_session: "control",
  rename_workspace: "control",
  reorder_pinned_dirs: "control",
  reorder_sessions: "control",
  reorder_workspace_folders: "control",
  reorder_workspaces: "control",
  reset_folder_card_sections: "control",
  resume_session: "control",
  retry_session: "control",
  send_prompt: "control",
  setSessionDisplayPrefs: "control",
  set_card_section_visibility: "control",
  set_default_group_by: "control",
  set_focus_mode: "control",
  set_focus_profile: "control",
  set_folder_collapsed: "control",
  set_folder_expanded: "control",
  set_folder_group_by: "control",
  set_lane_collapsed: "control",
  set_model: "control",
  set_session_process_drawer: "control",
  set_session_tags: "control",
  set_thinking_level: "control",
  set_workspace_collapsed: "control",
  shutdown: "control",
  spawn_session: "control",
  stop_after_turn: "control",
  ui_management: "control",
  unarchive_session: "control",
  unfavorite_model: "control",
  unpin_directory: "control",

  // ── operate: processes, terminals, trust, configuration ──
  browser_relay_input: "operate",
  close_inline_terminal: "operate",
  create_terminal: "operate",
  force_kill: "operate",
  grant_response: "operate",
  kill_process: "operate",
  kill_terminal: "operate",
  open_inline_terminal: "operate",
  plugin_action: "operate",
  plugin_config_write: "operate",
  rename_terminal: "operate",
  role_preset_delete: "operate",
  role_preset_load: "operate",
  role_preset_save: "operate",
  role_remove: "operate",
  role_set: "operate",
};

/** Required tier for a browser→server message type. Unlisted → `operate`. */
export function wsMessageTier(type: string): Tier {
  return Object.hasOwn(WS_MESSAGE_TIERS, type) ? WS_MESSAGE_TIERS[type]! : "operate";
}
