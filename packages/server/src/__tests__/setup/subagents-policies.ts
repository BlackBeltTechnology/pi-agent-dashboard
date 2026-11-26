/**
 * Test support: wire the REAL subagents plugin store + delivery policies (and
 * the manifest ownership they serve) into a plugin policy registry, the way
 * `registerPlugin` does through `ctx.registerStorePolicy` /
 * `ctx.registerDeliveryPolicy` in production.
 *
 * See change: move-subagents-to-plugin (D3, D10).
 */
import { createSubagentsDeliveryPolicy } from "../../../../subagents-plugin/src/server/delivery-policy.js";
import { createSubagentsStorePolicy } from "../../../../subagents-plugin/src/server/store-policy.js";
import {
  createPluginPolicyRegistry,
  type PluginPolicyRegistry,
} from "../../plugin-policy-registry.js";

/** A fresh registry with the subagents plugin's ownership and policies registered. */
export function createSubagentsPolicyRegistry(): PluginPolicyRegistry {
  const registry = createPluginPolicyRegistry();
  registry.setOwnership("subagents", { eventTypes: ["subagent_*"], tools: ["Agent"] });
  registry.registerStorePolicy("subagents", createSubagentsStorePolicy());
  registry.registerDeliveryPolicy("subagents", createSubagentsDeliveryPolicy());
  return registry;
}
