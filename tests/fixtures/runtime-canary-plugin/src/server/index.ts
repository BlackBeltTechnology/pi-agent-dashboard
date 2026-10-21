/**
 * Runtime canary server entry: broadcasts one global UI intent (a markdown notice in `settings-section`,
 * `sessionId: null`) so the e2e sees a server-driven contribution next to the client claims.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.broadcastToSubscribers({
    type: "plugin_intents",
    pluginId: "runtime-canary",
    sessionId: null,
    slot: "settings-section",
    intent: { primitive: "ui:markdown-content", props: { content: "Runtime canary server is up." } },
  });
}
