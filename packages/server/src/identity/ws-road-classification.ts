/**
 * WS non-session command classification (openspec add-multi-user-identity-plane,
 * D10/D14/D24; task 18.28). Every `NON_SESSION_MESSAGES` member maps to an
 * `{ action, resource }` for the OPTIONAL host policy (coverage-tested in
 * `ws-road-classification.test.ts`). Session-owned and session-list frames are
 * NOT classified here — they ride the owner gate.
 *
 * Plugin frames are namespaced `plugin:<id>:write` (D24): `plugin_action` by
 * its target `pluginId`, a plugin-registered custom frame by the plugin that
 * registered it. Resources are bounded + secret-free: `{ kind, ws, cwd?, pluginId? }`.
 */
import type { HostAction, HostResource } from "@blackbelt-technology/pi-dashboard-shared/identity.js";

export interface WsRoad {
  action: HostAction;
  resource: HostResource;
}

/** type → [action, resource kind]. */
const WS_ROADS: Readonly<Record<string, readonly [HostAction, string]>> = {
  // workspace layout, folders, pins, spawn
  add_folder_to_workspace: ["workspace.write", "workspace"],
  create_workspace: ["workspace.write", "workspace"],
  delete_workspace: ["workspace.write", "workspace"],
  move_folder_to_workspace: ["workspace.write", "workspace"],
  remove_folder_from_workspace: ["workspace.write", "workspace"],
  rename_workspace: ["workspace.write", "workspace"],
  reorder_workspace_folders: ["workspace.write", "workspace"],
  reorder_workspaces: ["workspace.write", "workspace"],
  set_workspace_collapsed: ["workspace.write", "workspace"],
  set_folder_collapsed: ["workspace.write", "workspace"],
  set_folder_group_by: ["workspace.write", "workspace"],
  set_default_group_by: ["workspace.write", "workspace"],
  set_lane_collapsed: ["workspace.write", "workspace"],
  set_card_section_visibility: ["workspace.write", "workspace"],
  reset_folder_card_sections: ["workspace.write", "workspace"],
  pin_directory: ["workspace.write", "workspace"],
  unpin_directory: ["workspace.write", "workspace"],
  reorder_pinned_dirs: ["workspace.write", "workspace"],
  reorder_sessions: ["workspace.write", "workspace"],
  remove_tag_globally: ["workspace.write", "workspace"],
  spawn_session: ["workspace.write", "workspace"],
  // terminals
  create_terminal: ["terminal.create", "terminal"],
  open_inline_terminal: ["terminal.create", "terminal"],
  close_inline_terminal: ["terminal.write", "terminal"],
  kill_terminal: ["terminal.write", "terminal"],
  rename_terminal: ["terminal.write", "terminal"],
  // openspec
  openspec_get: ["openspec.read", "openspec"],
  openspec_refresh: ["openspec.read", "openspec"],
  openspec_bulk_archive: ["openspec.write", "openspec"],
  // branch / worktree progress
  worktree_init_subscribe: ["branch.read", "branch"],
  worktree_init_unsubscribe: ["branch.read", "branch"],
  // files
  list_files: ["files.read", "files"],
  watch_files: ["files.read", "files"],
  // config / UI settings
  favorite_model: ["config.write", "config"],
  unfavorite_model: ["config.write", "config"],
  ui_management: ["config.write", "config"],
  // providers / catalogues
  request_models: ["providers.read", "providers"],
  request_providers: ["providers.read", "providers"],
  request_commands: ["packages.read", "packages"],
  // access
  grant_response: ["access.write", "access"],
  // system
  recovery_dismiss: ["system.write", "system"],
  // plugins (core management)
  plugin_config_write: ["plugins.write", "plugin"],
  // plugin-owned core frames
  browser_relay_input: ["plugin:browser:write", "plugin"],
  browser_relay_subscribe: ["plugin:browser:read", "plugin"],
  browser_relay_unsubscribe: ["plugin:browser:read", "plugin"],
  flow_management: ["plugin:flows:write", "plugin"],
  request_roles: ["plugin:roles:read", "plugin"],
  role_preset_delete: ["plugin:roles:write", "plugin"],
  role_preset_load: ["plugin:roles:write", "plugin"],
  role_preset_save: ["plugin:roles:write", "plugin"],
  role_remove: ["plugin:roles:write", "plugin"],
  role_set: ["plugin:roles:write", "plugin"],
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

const pluginRoad = (type: string, pluginId: string): WsRoad => ({
  action: `plugin:${pluginId}:write`,
  resource: { kind: "plugin", ws: type, pluginId },
});

/**
 * Classify a browser frame. `customOwner` = the plugin id that registered a
 * custom handler for this type (if any). `undefined` = unclassified.
 */
export function classifyWsRoad(msg: { type: string; [k: string]: unknown }, customOwner?: string): WsRoad | undefined {
  const { type } = msg;
  if (type === "plugin_action") {
    const pluginId = str(msg.pluginId);
    return pluginId ? pluginRoad(type, pluginId) : undefined;
  }
  const entry = WS_ROADS[type];
  if (!entry) return customOwner ? pluginRoad(type, customOwner) : undefined;
  const [action, kind] = entry;
  const resource: Record<string, unknown> = { kind, ws: type };
  const cwd = str(msg.cwd);
  if (cwd) resource.cwd = cwd;
  if (type === "plugin_config_write") {
    const id = str(msg.id);
    if (id) resource.pluginId = id;
  } else if (action.startsWith("plugin:")) {
    resource.pluginId = action.split(":")[1];
  }
  return { action, resource: resource as HostResource };
}
