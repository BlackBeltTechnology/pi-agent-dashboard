/**
 * apple-tools · SERVER entry.
 *
 * Exposes the iMCP provisioning state (shared write-suppressed checker) and the
 * run-installer action to the dashboard. Owns two things the CLI cannot:
 *   - server-side path reconciliation into the server-owned plugin config store
 *     (Decision 1) — persists a discovered non-default path to `imcpServerPath`,
 *   - the server enable/disable write to the project-local `.pi/mcp.json`.
 *
 * See change: add-apple-tools-imcp-plugin.
 */
import { join } from "node:path";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { createInstallerEnv } from "../env.js";
import { runInstaller, type TerminalState } from "../install.js";
import { readImcpEntry, setDirectTools, setServerDisabled } from "../mcp-config.js";
import { DEFAULT_IMCP_PATH, shouldReconcilePath } from "../reconcile.js";

const PLUGIN_ID = "apple-tools";
const HOST_KNOWN_FOLDERS = "host.knownFolderCwds";
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
   * Adapter-owned fields, read from `~/.pi/agent/mcp.json` (the source of
   * truth) rather than our plugin config store — the adapter, not us, consumes
   * them, and a project layer may override `disabled`.
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

  // cwd allow-list for the project-local `disabled` write. Without this, a
  // browser payload could name ANY directory and the writer would mkdir -p it.
  // Same guard shape as kb-plugin's `isAllowedCwd`.
  const hostKnown = ctx.consume<() => string[]>(HOST_KNOWN_FOLDERS);
  const knownCwds = (): string[] => {
    if (hostKnown) return hostKnown();
    return (ctx.sessionManager.listAll() as Array<{ cwd?: string }>)
      .map((s) => s.cwd)
      .filter((c): c is string => typeof c === "string" && c.length > 0);
  };
  const isAllowedCwd = (cwd: string | undefined): cwd is string =>
    typeof cwd === "string" && cwd.length > 0 && knownCwds().includes(cwd);

  let statusCache: { at: number; value: StatusReadout } | null = null;

  function computeStatus(): StatusReadout {
    const cfg = ctx.getPluginConfig<AppleToolsConfig>() ?? {};
    const configured = cfg.imcpServerPath;
    const env = createInstallerEnv({
      ...(configured ? { overridePath: configured } : {}),
    });
    const result = runInstaller(env, { check: true });
    const entry = readImcpEntry(env.configIO, env.mcpJsonPath);
    // check-mode PREDICTS a resolvedPath when brew could install it, so the
    // path existing on disk — not merely being reported — is what decides
    // whether the server can provision without shelling out to brew.
    const appPresent =
      result.resolvedPath !== undefined && env.pathExists(result.resolvedPath);
    return {
      platform: env.platform,
      state: result.state,
      message: result.message,
      ...(result.resolvedPath ? { resolvedPath: result.resolvedPath } : {}),
      imcpServerPath: configured ?? DEFAULT_IMCP_PATH,
      directTools: entry.directTools,
      disabled: entry.disabled,
      appPresent,
    };
  }

  async function reconcile(status: StatusReadout): Promise<void> {
    const cfg = ctx.getPluginConfig<AppleToolsConfig>() ?? {};
    if (shouldReconcilePath(cfg.imcpServerPath, status.resolvedPath ?? null)) {
      await ctx.updatePluginConfig<AppleToolsConfig>({ imcpServerPath: status.resolvedPath });
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

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: flat action switch.
  ctx.registerBrowserHandler("plugin_action", (msg) => {
    const m = msg as { pluginId?: string; action?: string; payload?: Record<string, unknown> };
    if (m.pluginId !== PLUGIN_ID) return;
    switch (m.action) {
      case "run-installer": {
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
        const appPresent = probe.resolvedPath !== undefined && env.pathExists(probe.resolvedPath);
        if (!appPresent) {
          // The panel reads `appPresent` from the status readout and renders the
          // CLI instruction instead of the button, so this is defence in depth.
          ctx.logger.warn(
            "apple-tools run-installer: iMCP is not installed. Run `pi-apple-tools-install` " +
              "in a terminal — the dashboard does not run `brew` in-process.",
          );
          statusCache = null;
          break;
        }
        const result = runInstaller(env, { check: false });
        ctx.logger.info(`apple-tools run-installer → ${result.state}`);
        statusCache = null; // invalidate on mutation (#F7)
        reconcile({ ...cachedStatus(), resolvedPath: result.resolvedPath }).catch((e) =>
          ctx.logger.warn(`apple-tools reconcile failed: ${(e as Error).message}`),
        );
        break;
      }
      case "set-disabled": {
        // Enable/disable the iMCP server. BOTH levels are supported:
        //   scope "global"  → ~/.pi/agent/mcp.json  (default; the global panel)
        //   scope "project" → <cwd>/.pi/mcp.json    (highest-precedence override)
        const payload = m.payload ?? {};
        const disabled = payload.disabled === true;
        const scope = payload.scope === "project" ? "project" : "global";
        const env = createInstallerEnv();
        let target: string;
        if (scope === "project") {
          const cwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
          // Browser-supplied write path — it MUST be a known folder cwd, else
          // this is an arbitrary mkdir -p + file write as the server user.
          if (!isAllowedCwd(cwd)) {
            ctx.logger.warn(`apple-tools set-disabled: cwd not allowed (${cwd ?? "missing"})`);
            return;
          }
          target = join(cwd, ".pi", "mcp.json");
        } else {
          target = env.mcpJsonPath;
        }
        const r = setServerDisabled(env.configIO, target, disabled);
        if (!r.ok) ctx.logger.warn(`apple-tools set-disabled failed: ${r.message}`);
        else ctx.logger.info(`apple-tools set-disabled scope=${scope} disabled=${disabled}`);
        statusCache = null;
        break;
      }
      case "set-direct-tools": {
        // Adapter-owned per-server `directTools` filter on the global entry.
        const payload = m.payload ?? {};
        const tools = Array.isArray(payload.tools)
          ? (payload.tools as unknown[]).filter((t): t is string => typeof t === "string")
          : [];
        const env = createInstallerEnv();
        const r = setDirectTools(env.configIO, env.mcpJsonPath, tools);
        if (!r.ok) ctx.logger.warn(`apple-tools set-direct-tools failed: ${r.message}`);
        statusCache = null;
        break;
      }
      default:
        break;
    }
  });
}

export default registerPlugin;
