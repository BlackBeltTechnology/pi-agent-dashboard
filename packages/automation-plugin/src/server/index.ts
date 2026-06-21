/**
 * automation-plugin SERVER entry.
 *
 * Owns the central scheduler + trigger registry, scans both automation
 * scopes, arms each valid automation's trigger, and spawns run sessions
 * (stamped `kind="automation"`) when a trigger fires. Run results land in
 * the on-disk run/triage store.
 *
 * Wired by the dashboard plugin loader via the `server` field in the
 * manifest. See change: add-automation-plugin.
 *
 * Boot-cost note: `registerPlugin` returns immediately and defers all engine
 * initialization (and its heavier imports — `yaml`, scheduler, scanner) to a
 * detached, unref'd timer so plugin load does NOT block server boot AND the
 * post-boot scan/fs.watch work does not compete for the event loop during
 * the brief window short-lived server-boot tests assert in. Arming
 * automations ~1 s after boot is operationally negligible.
 */
const ENGINE_INIT_DELAY_MS = 1000;
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { Visibility } from "../shared/automation-types.js";
import { mountAutomationRoutes } from "./routes.js";

const PLUGIN_ID = "automation";

interface AutomationPluginConfig {
  defaultVisibility?: Visibility;
  retentionPerAutomation?: number;
  scanFolderScope?: boolean;
  scanGlobalScope?: boolean;
  defaultModel?: string;
}

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("automation-plugin server entry activated");
  // Mount REST routes synchronously (must register before fastify.listen).
  // Handler bodies lazy-import heavy modules so this stays cheap.
  mountAutomationRoutes(ctx.fastify);
  // Detach: do not block server boot on engine init / heavy imports, and
  // delay past the immediate post-boot window so short integration tests
  // (which boot + assert + tear down within ~1 s) never race the engine's
  // scan/fs.watch work.
  const initTimer = setTimeout(() => {
    void initEngine(ctx).catch((e) =>
      ctx.logger.error(`automation-plugin engine init failed: ${e instanceof Error ? e.message : String(e)}`),
    );
  }, ENGINE_INIT_DELAY_MS);
  if (typeof initTimer.unref === "function") initTimer.unref();
}

async function initEngine(ctx: ServerPluginContext): Promise<void> {
  const os = await import("node:os");
  const path = await import("node:path");
  const { createEngine } = await import("./engine.js");
  const { createAutomationWatcher } = await import("./automation-watcher.js");
  const { logger } = ctx;
  const homeDir = os.homedir();

  function pluginConfig() {
    const cfg = ctx.getPluginConfig<AutomationPluginConfig>() ?? {};
    return {
      defaultVisibility: cfg.defaultVisibility ?? ("hidden" as Visibility),
      retention: cfg.retentionPerAutomation ?? 100,
      ...(cfg.defaultModel ? { defaultModel: cfg.defaultModel } : {}),
      scanFolder: cfg.scanFolderScope !== false,
      scanGlobal: cfg.scanGlobalScope !== false,
    };
  }

  /** Distinct repo roots derived from known session cwds (per-folder scope). */
  function folderScopeBases(): string[] {
    const bases = new Set<string>();
    try {
      const sessions = ctx.sessionManager.listAll() as Array<{ cwd?: string }>;
      for (const s of sessions) {
        if (typeof s.cwd === "string" && s.cwd.length > 0) bases.add(path.resolve(s.cwd));
      }
    } catch {
      /* ignore */
    }
    return [...bases];
  }

  function listScopes() {
    const cfg = pluginConfig();
    const scopes: Array<{ base: string; scope: "folder" | "global" }> = [];
    if (cfg.scanGlobal) scopes.push({ base: homeDir, scope: "global" });
    if (cfg.scanFolder) {
      for (const base of folderScopeBases()) scopes.push({ base, scope: "folder" });
    }
    return scopes;
  }

  const engine = createEngine({
    spawnSession: (opts) => ctx.spawnSession(opts),
    listScopes,
    config: pluginConfig,
    homeDir,
    log: (m) => logger.info(m),
    warn: (m) => logger.warn(m),
  });

  const watcher = createAutomationWatcher({
    onChange: () => engine.refresh(),
    logger: (m) => logger.warn(m),
  });
  function attachWatchers(): void {
    watcher.detachAll();
    for (const s of listScopes()) watcher.attach(s.base);
  }

  engine.start();
  attachWatchers();

  // Per-run transcript buffer (run sessionId → captured assistant text),
  // flushed to result.md on `agent_end`. Best-effort tolerant extraction.
  const runText = new Map<string, string[]>();
  let rescanTimer: ReturnType<typeof setTimeout> | null = null;

  ctx.onEvent((sessionId, rawEvent) => {
    const event = rawEvent as { eventType?: string; data?: Record<string, unknown> } | undefined;

    // Correlate a registering run session to its pending run (prompt delivery).
    const session = ctx.sessionManager.getSession(sessionId) as { cwd?: string } | undefined;
    if (session?.cwd) {
      const pendingRun = engine.pendingForCwd(session.cwd);
      if (pendingRun && !pendingRun.delivered) {
        engine.onSessionRegistered(sessionId, session.cwd);
        runText.set(sessionId, []);
        if (pendingRun.promptText) ctx.sendToSession(sessionId, pendingRun.promptText);
      }
    }

    // Buffer assistant text + flush on agent_end for tracked run sessions.
    if (runText.has(sessionId)) {
      const text = extractAssistantText(event);
      if (text) runText.get(sessionId)!.push(text);
      if (event?.eventType === "agent_end") {
        const result = (runText.get(sessionId) ?? []).join("\n\n").trim();
        runText.delete(sessionId);
        engine.onSessionEnded(sessionId, result);
      }
    }

    // Light re-scan + re-watch on activity (folder set may have changed).
    if (!rescanTimer) {
      rescanTimer = setTimeout(() => {
        rescanTimer = null;
        engine.refresh();
        attachWatchers();
      }, 2000);
      if (typeof rescanTimer.unref === "function") rescanTimer.unref();
    }
  });

  void PLUGIN_ID;
}

/**
 * Tolerant assistant-text extraction over a raw forwarded pi event. Returns
 * non-empty text only for assistant/message output events. Phase-1 capture.
 */
function extractAssistantText(
  event: { eventType?: string; data?: Record<string, unknown> } | undefined,
): string | null {
  if (!event?.data) return null;
  const d = event.data as Record<string, unknown>;
  const role = (d.role ?? (d.message as Record<string, unknown> | undefined)?.role) as string | undefined;
  if (role && role !== "assistant") return null;
  const candidate =
    (typeof d.text === "string" && d.text) ||
    (typeof d.content === "string" && d.content) ||
    (typeof (d.message as Record<string, unknown> | undefined)?.content === "string" &&
      ((d.message as Record<string, unknown>).content as string)) ||
    null;
  const trimmed = candidate?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export default registerPlugin;
