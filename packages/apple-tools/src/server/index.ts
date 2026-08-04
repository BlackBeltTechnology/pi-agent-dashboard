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
import { setServerDisabled } from "../mcp-config.js";
import { DEFAULT_IMCP_PATH, shouldReconcilePath } from "../reconcile.js";

const PLUGIN_ID = "apple-tools";
const HOST_KNOWN_FOLDERS = "host.knownFolderCwds";
/** Status readout TTL — the traversal shells out to `sw_vers`/`which`, so a
 *  polling panel must not re-run it per request. Mirrors the 30s requirement-
 *  probe cache. */
const STATUS_TTL_MS = 10_000;

interface AppleToolsConfig {
  imcpServerPath?: string;
  directTools?: string[];
}

interface StatusReadout {
  platform: string;
  state: TerminalState;
  message: string;
  resolvedPath?: string;
  imcpServerPath: string;
  directTools: string[];
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
    return {
      platform: env.platform,
      state: result.state,
      message: result.message,
      ...(result.resolvedPath ? { resolvedPath: result.resolvedPath } : {}),
      imcpServerPath: configured ?? DEFAULT_IMCP_PATH,
      directTools: cfg.directTools ?? [],
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
        const result = runInstaller(env, { check: false });
        ctx.logger.info(`apple-tools run-installer → ${result.state}`);
        statusCache = null; // invalidate on mutation (#F7)
        reconcile({ ...computeStatus(), resolvedPath: result.resolvedPath }).catch((e) =>
          ctx.logger.warn(`apple-tools reconcile failed: ${(e as Error).message}`),
        );
        break;
      }
      case "set-disabled": {
        // Server enable/disable → project-local .pi/mcp.json disabled override.
        const payload = m.payload ?? {};
        const cwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
        const disabled = payload.disabled === true;
        // The write path is browser-supplied — it MUST be a known folder cwd,
        // else this is an arbitrary mkdir -p + file write as the server user.
        if (!isAllowedCwd(cwd)) {
          ctx.logger.warn(`apple-tools set-disabled: cwd not allowed (${cwd ?? "missing"})`);
          return;
        }
        const io = createInstallerEnv().configIO;
        const projectMcp = join(cwd, ".pi", "mcp.json");
        const r = setServerDisabled(io, projectMcp, disabled);
        if (!r.ok) ctx.logger.warn(`apple-tools set-disabled failed: ${r.message}`);
        statusCache = null;
        break;
      }
      default:
        break;
    }
  });
}

export default registerPlugin;
