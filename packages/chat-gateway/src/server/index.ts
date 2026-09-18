/**
 * chat-gateway — dashboard plugin server entry.
 *
 * Adds an inbound chat control plane in front of the dashboard. The gateway is
 * a HEADLESS BROWSER-PROTOCOL CLIENT: it consumes the same session frames the
 * React client does (`ctx.subscribeSession`) and drives sessions over the
 * existing raw-control lane (`ctx.sendExtensionMessage` →
 * `send_prompt`/`prompt_response`) plus `ctx.abortSession`/`ctx.spawnSession`.
 * No bridge message type, no server protocol change.
 *
 * INERTNESS (task 1.3): with no bot token configured nothing is constructed —
 * no adapter, no socket, no timers. The heavy `discord.js` import is therefore
 * deferred past the configured check, so an unconfigured install pays nothing.
 *
 * Trust: `spawnSession`/`abortSession`/`sendExtensionMessage`/`subscribeSession`
 * are host-gated to plugins with `priority <= 100`, which this package's
 * manifest satisfies. On a host without the in-process frame seam the gateway
 * refuses to start rather than half-working (it would receive no session
 * output yet appear healthy).
 *
 * See change: add-chat-gateway.
 */
import { homedir } from "node:os";
import path from "node:path";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { ChatGatewayConfig } from "../shared/types.js";
import { isConfigured, resolveConfig } from "./config.js";
import { createChatGateway } from "./gateway.js";
import { createBindingStore, createSpawnCorrelator } from "./routing.js";
import { createHostSeam } from "./seam.js";

/** Dashboard-owned state directory for the gateway's sticky bindings. */
export function chatGatewayStateDir(): string {
  return path.join(homedir(), ".pi", "dashboard", "chat-gateway");
}

export function bindingsFilePath(): string {
  return path.join(chatGatewayStateDir(), "bindings.json");
}

export default async function registerChatGateway(ctx: ServerPluginContext): Promise<void> {
  const config = resolveConfig(ctx.getPluginConfig<ChatGatewayConfig>());

  // Inert by design: no token, no work. This is the ONLY early return that is
  // not an error.
  if (!isConfigured(config)) {
    ctx.logger.info(
      "chat-gateway: inert (no bot token configured) — no adapter, no connection",
    );
    return;
  }

  if (typeof ctx.subscribeSession !== "function") {
    // Fail loudly rather than appear healthy: without the frame seam the
    // gateway could send prompts but would never see a reply.
    ctx.logger.error(
      "chat-gateway: host does not expose subscribeSession — gateway disabled (requires dashboard >= the in-process frame seam)",
    );
    return;
  }

  const store = createBindingStore({ filePath: bindingsFilePath() });
  store.load();

  const seam = createHostSeam(ctx);
  // Deferred so an unconfigured install never loads discord.js.
  const { DiscordAdapter } = await import("../adapters/discord.js");
  const adapter = new DiscordAdapter({
    enabled: true,
    platform: "discord",
    botToken: config.token,
  });

  const gateway = createChatGateway({
    platform: "discord",
    seam,
    adapter,
    config,
    store,
    correlator: createSpawnCorrelator(),
  });

  ctx.onShutdown(() => {
    void gateway.stop();
  });

  await gateway.start();

  // Read-only bindings + status surface for the settings panel (task 10.1).
  // Registered only once configured + started, so an inert install exposes
  // nothing (task 1.3).
  ctx.fastify.get("/api/chat-gateway/bindings", async () => ({
    bindings: store.all(),
    status: gateway.status(),
  }));

  ctx.logger.info(
    `chat-gateway: started (${store.all().length} bound channel(s), allowedRoots=${config.allowedRoots.length}); pairing code available in Settings`,
  );
}
