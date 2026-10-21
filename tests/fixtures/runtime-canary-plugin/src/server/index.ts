/**
 * Runtime canary server entry: when armed (`intent.flag` next to `package.json`, written by the harness staging in
 * `untrusted` mode only) broadcasts one global UI intent (a markdown notice in `settings-section`, `sessionId: null`,
 * replayed on subscribe; it renders on the plugin's own settings page) so the e2e sees a server-driven contribution while the client is untrusted, and mounts the
 * standalone build of its app (`dist/standalone/`, built by `scripts/build-runtime-canary.mjs`) with `ctx.serveApp`
 * at `/apps/runtime-canary/` (trust-gated: only a trusted canary mounts it). See change: decouple-plugins-from-core.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STANDALONE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:";

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  if (fs.existsSync(path.join(PACKAGE_DIR, "intent.flag"))) {
    ctx.broadcastToSubscribers({
      type: "plugin_intents",
      pluginId: "runtime-canary",
      sessionId: null,
      slot: "settings-section",
      intent: { primitive: "ui:markdown-content", props: { content: "Runtime canary server is up." } },
    });
  }
  try {
    ctx.serveApp({ appId: "runtime-canary", dir: path.join(PACKAGE_DIR, "dist/standalone"), csp: STANDALONE_CSP });
  } catch (err) {
    ctx.logger.warn("runtime-canary: serveApp refused (untrusted?)", err);
  }
}
