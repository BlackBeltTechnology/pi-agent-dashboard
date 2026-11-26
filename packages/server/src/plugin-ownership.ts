/**
 * Plugin ownership table: manifest `eventTypes` (pattern → pluginId) and
 * tool-renderer claims (toolName → pluginId), built from the loaded plugin
 * manifests. Sent to every bridge on `session_register` (`plugin_ownership`) and
 * used on `event_forward` ingest to reject an owned event type whose `pluginId`
 * stamp is not the owner.
 *
 * The bridge reads no manifests (it depends only on `shared`), so the server is
 * the single reader. A manifest listing the same pattern/tool twice keeps the
 * first plugin (discovery order); the table never names a plugin id itself.
 * See change: move-subagents-to-plugin (D1).
 */

import type { PluginOwnershipMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import {
  type EventTypeOwner,
  matchEventTypeOwner,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/event-type-owners.js";

/** The slice of a discovered plugin this module reads. */
export interface OwnershipPluginLike {
  manifest: {
    id: string;
    eventTypes?: readonly string[];
    claims?: ReadonlyArray<{ slot?: string; toolName?: string }>;
  };
}

/** Build the table from loaded manifests. */
export function buildPluginOwnership(plugins: readonly OwnershipPluginLike[]): PluginOwnershipMessage {
  const eventTypes: Record<string, string> = Object.create(null);
  const toolClaims: Record<string, string> = Object.create(null);
  for (const { manifest } of plugins) {
    for (const pattern of manifest.eventTypes ?? []) {
      if (!(pattern in eventTypes)) eventTypes[pattern] = manifest.id;
    }
    for (const claim of manifest.claims ?? []) {
      if (claim.slot === "tool-renderer" && typeof claim.toolName === "string" && !(claim.toolName in toolClaims)) {
        toolClaims[claim.toolName] = manifest.id;
      }
    }
  }
  return { type: "plugin_ownership", eventTypes: { ...eventTypes }, toolClaims: { ...toolClaims } };
}

export interface PluginOwnershipStats {
  /** `event_forward` of an owned type rejected for a missing / wrong `pluginId` stamp. */
  rejectedMisstamped: number;
}

export interface PluginOwnership {
  /** The `plugin_ownership` message for a bridge. */
  table(): PluginOwnershipMessage;
  /**
   * Ingest check for one `event_forward`: `true` when the event may be stored.
   * An event of a manifest-owned type must carry the owning `pluginId`; types
   * nobody owns pass. Counts every rejection.
   */
  acceptForward(eventType: string, pluginId: unknown): boolean;
  readonly stats: PluginOwnershipStats;
}

/**
 * `getPlugins` is read per call (discovery is cached by the loader); the owner
 * list is rebuilt only when the returned array identity changes.
 */
export function createPluginOwnership(getPlugins: () => readonly OwnershipPluginLike[]): PluginOwnership {
  const stats: PluginOwnershipStats = { rejectedMisstamped: 0 };
  let cachedFor: readonly OwnershipPluginLike[] | undefined;
  let cachedTable: PluginOwnershipMessage = { type: "plugin_ownership", eventTypes: {}, toolClaims: {} };
  let owners: EventTypeOwner[] = [];

  const refresh = (): void => {
    const plugins = getPlugins();
    if (plugins === cachedFor) return;
    cachedFor = plugins;
    cachedTable = buildPluginOwnership(plugins);
    const byPlugin = new Map<string, string[]>();
    for (const [pattern, id] of Object.entries(cachedTable.eventTypes)) {
      const list = byPlugin.get(id) ?? [];
      list.push(pattern);
      byPlugin.set(id, list);
    }
    owners = [...byPlugin].map(([ownerId, eventTypes]) => ({ ownerId, displayName: ownerId, eventTypes }));
  };

  return {
    table() {
      refresh();
      return cachedTable;
    },
    acceptForward(eventType, pluginId) {
      refresh();
      const owner = matchEventTypeOwner(owners, eventType)?.ownerId;
      if (owner === undefined || owner === pluginId) return true;
      stats.rejectedMisstamped++;
      return false;
    },
    stats,
  };
}
