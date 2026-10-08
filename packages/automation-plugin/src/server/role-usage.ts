/**
 * "Used by" reporting for the roles plugin: which discovered automations pin a
 * role ref (`@role[:level]`) as their model. Kind A (resolve-at-use) — the
 * value is stored verbatim and resolved at run time, so the roles plugin only
 * needs to LIST it.
 *
 * See change: add-role-aware-model-refs.
 */
import { parseModelRef } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";
import type { DiscoveredAutomation } from "../shared/automation-types.js";

export interface RoleUsageEntry {
  label: string;
  ref: string;
}

export function automationRoleUsage(discovered: readonly DiscoveredAutomation[]): RoleUsageEntry[] {
  const out: RoleUsageEntry[] = [];
  for (const a of discovered) {
    const model = a.valid ? a.config?.model : undefined;
    if (typeof model === "string" && parseModelRef(model).kind === "role") {
      out.push({ label: `${a.scope}:${a.name}`, ref: model.trim() });
    }
  }
  return out;
}
