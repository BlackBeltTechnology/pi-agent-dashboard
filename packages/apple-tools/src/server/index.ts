/**
 * apple-tools · SERVER entry.
 *
 * Exposes the iMCP provisioning state (shared write-suppressed checker) and the
 * run-installer action to the dashboard. Consumes the `mcp-client.config`
 * service provided by the `mcp-client` plugin (declared via `dependsOn`) for
 * the mcp.json readout; owns reconciliation of a discovered non-default path
 * into the server-owned plugin config store (Decision 1).
 *
 * The MCP server enable/disable + directTools controls moved to the mcp-client
 * plugin's own generic surface; this plugin no longer writes mcp.json.
 *
 * See changes: add-apple-tools-imcp-plugin, extract-mcp-client-plugin.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { McpClientConfigService } from "@blackbelt-technology/pi-dashboard-mcp-client-plugin/core";
import { createInstallerEnv } from "../env.js";
import { runInstaller, type TerminalState } from "../install.js";
import { DEFAULT_IMCP_PATH, shouldReconcilePath } from "../reconcile.js";

const PLUGIN_ID = "apple-tools";
/** The service key the `mcp-client` plugin provides. */
const SERVICE_KEY = "mcp-client.config";
/** Status readout TTL — the traversal shells out to `sw_vers`/`which`, so a
 *  polling panel must not re-run it per request. Mirrors the 30s requirement-
 *  probe cache. */
const STATUS_TTL_MS = 10_000;

interface AppleToolsConfig {
  imcpServerPath?: string;
}

interface StatusReadout {
  platform: string;
  state: TerminalState;
  message: string;
  resolvedPath?: string;
  imcpServerPath: string;
  /**
   * Adapter-owned fields, read from the Pi-global `mcp.json` through the
   * mcp-client service (the source of truth) rather than our plugin config.
   */
  directTools: string[];
  disabled: boolean;
  /**
   * True when iMCP.app is actually on disk. The dashboard can only perform the
   * fast config-write half of provisioning; when this is false the operator
   * must run the CLI (which owns the long, network-bound brew install), so the
   * panel surfaces that instead of offering a button that would refuse.
   */
  appPresent: boolean;
}

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("apple-tools server entry activated");

  const consumed = ctx.consume<McpClientConfigService>(SERVICE_KEY);
  if (!consumed) {
    throw new Error(
      "apple-tools requires the `mcp-client.config` service (plugin id `mcp-client`); " +
        "ensure it is enabled and loaded before apple-tools (`dependsOn: [\"mcp-client\"]`).",
    );
  }
  const mcpClient: McpClientConfigService = consumed;

  let statusCache: { at: number; value: StatusReadout } | null = null;

  function computeStatus(): StatusReadout {
    const cfg = ctx.getPluginConfig<AppleToolsConfig>() ?? {};
    const configured = cfg.imcpServerPath;
    const env = createInstallerEnv({
      ...(configured ? { overridePath: configured } : {}),
    });
    const result = runInstaller(env, { check: true });
    const entry = mcpClient.readServerEntry("iMCP", { kind: "global" });
    return {
      platform: env.platform,
      state: result.state,
      message: result.message,
      ...(result.resolvedPath ? { resolvedPath: result.resolvedPath } : {}),
      imcpServerPath: configured ?? DEFAULT_IMCP_PATH,
      directTools: Array.isArray(entry?.directTools)
        ? entry.directTools.filter((t): t is string => typeof t === "string")
        : [],
      // pi-mcp-adapter's isServerDisabled: only a literal `true` disables.
      disabled: entry?.disabled === true,
      // Reported by the traversal itself: false when the state is a prediction.
      appPresent: result.appPresent,
    };
  }

  /** Narrowed to the only value reconciliation needs — see the review note on
   *  the discarded `cachedStatus()` round-trip. */
  async function reconcile(resolvedPath: string | undefined): Promise<void> {
    const cfg = ctx.getPluginConfig<AppleToolsConfig>() ?? {};
    if (shouldReconcilePath(cfg.imcpServerPath, resolvedPath ?? null)) {
      await ctx.updatePluginConfig<AppleToolsConfig>({ imcpServerPath: resolvedPath });
    }
  }

  function cachedStatus(now: number = Date.now()): StatusReadout {
    if (statusCache && now - statusCache.at < STATUS_TTL_MS) return statusCache.value;
    const value = computeStatus();
    statusCache = { at: now, value };
    return value;
  }

  // GET is read-only (no reconciliation write — a prefetch/refresh must not
  // mutate the server-owned config store). Reconciliation runs on the explicit
  // run-installer action instead.
  ctx.fastify.get(`/api/${PLUGIN_ID}/status`, async () => cachedStatus());

  ctx.registerBrowserHandler("plugin_action", (msg) => {
    const m = msg as { pluginId?: string; action?: string; payload?: Record<string, unknown> };
    if (m.pluginId !== PLUGIN_ID) return;
    if (m.action !== "run-installer") return;

    const cfg = ctx.getPluginConfig<AppleToolsConfig>() ?? {};
    const env = createInstallerEnv({
      ...(cfg.imcpServerPath ? { overridePath: cfg.imcpServerPath } : {}),
    });
    // The state machine is synchronous by design (pure + unit-testable).
    // Running its INSTALL branch here would `execFileSync(brew, …)` with a
    // 10-minute timeout on the Fastify event loop, freezing every session's
    // WebSocket and every other plugin's HTTP for the duration.
    //
    // So the server only ever performs the FAST half of provisioning (the
    // two config writes, which run when iMCP is already on disk). When the
    // app is absent — the only branch that shells out to brew — it refuses
    // and directs the operator to the CLI, which owns the long, network-
    // bound install. See the security/perf review of this change.
    const probe = runInstaller(env, { check: true });
    if (!probe.appPresent) {
      // The panel reads `appPresent` from the status readout and renders the
      // CLI instruction instead of the button, so this is defence in depth.
      ctx.logger.warn(
        "apple-tools run-installer: iMCP is not installed. Run `pi-apple-tools-install` " +
          "in a terminal — the dashboard does not run `brew` in-process.",
      );
      statusCache = null;
      return;
    }
    const result = runInstaller(env, { check: false });
    ctx.logger.info(`apple-tools run-installer → ${result.state}`);
    statusCache = null; // invalidate on mutation (#F7)
    // Pass only what reconcile reads. Calling cachedStatus() here would
    // miss the just-cleared cache, run a THIRD sync traversal (sw_vers +
    // which) on the event loop, discard the result, and re-seed the cache
    // with a pre-reconcile readout served for the next 10s.
    reconcile(result.resolvedPath).catch((e) =>
      ctx.logger.warn(`apple-tools reconcile failed: ${(e as Error).message}`),
    );
  });
}

export default registerPlugin;
