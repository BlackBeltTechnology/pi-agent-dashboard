/**
 * The generated registry carries `{id, displayName, eventTypes}` for the bundled
 * plugins, so the shell knows event ownership without hard-coding a prefix.
 * See change: decouple-plugins-from-core (task 2.8).
 */
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { matchEventTypeOwner } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/event-type-owners.js";
import { describe, expect, it } from "vitest";
import { PLUGIN_REGISTRY } from "../../../generated/plugin-registry.js";

function registryFromGenerated() {
  const registry = createSlotRegistry();
  for (const entry of PLUGIN_REGISTRY) {
    registry.registerPlugin({
      id: entry.manifest.id,
      displayName: entry.manifest.displayName,
      eventTypes: entry.manifest.eventTypes,
    });
  }
  return registry;
}

describe("generated plugin registry › eventTypes", () => {
  it("subagents declares subagent_* and flows declares flow_*", () => {
    const byId = new Map(PLUGIN_REGISTRY.map((e) => [e.manifest.id, e.manifest]));
    expect(byId.get("subagents")?.eventTypes).toEqual(["subagent_*"]);
    expect(byId.get("flows")?.eventTypes).toEqual(["flow_*"]);
  });

  it("owner lookup resolves flow_/subagent_ types and ignores near-misses, even when plugins are disabled", () => {
    const registry = registryFromGenerated();
    registry.setEnabledSet(new Set());
    const owners = registry.getEventTypeOwners();
    expect(matchEventTypeOwner(owners, "flow_step")?.ownerId).toBe("flows");
    expect(matchEventTypeOwner(owners, "subagent_entry")?.ownerId).toBe("subagents");
    expect(matchEventTypeOwner(owners, "subagentx")).toBeUndefined();
  });
});
