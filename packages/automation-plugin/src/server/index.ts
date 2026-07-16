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

import os from "node:os";
import path from "node:path";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { AutomationScope, Visibility } from "../shared/automation-types.js";
import {
  ACTION_CONTRIBUTION_PREFIX,
  type ActionRegistry,
  collectActionRegistry,
  coreActionContributions,
} from "./action-registry.js";
import type { Engine } from "./engine.js";
import { mountAutomationRoutes, unknownActionKind } from "./routes.js";

const PLUGIN_ID = "automation";

/** Key under which automation publishes its own built-in contributions. */
export const CORE_ACTION_KEY = "automation.action.core";

interface AutomationPluginConfig {
  defaultVisibility?: Visibility;
  retentionPerAutomation?: number;
  scanFolderScope?: boolean;
  scanGlobalScope?: boolean;
  defaultModel?: string;
  /**
   * Max age (ms) a run may stay `running` before the stale-run reaper
   * finalizes it `error` + frees its slot. Default 30 min; <= 0 disables.
   * See change: finalize-automation-run-on-session-death.
   */
  maxRunAgeMs?: number;
}

/** Shared holder so the synchronously-mounted run route can reach the engine
 *  once it inits (~1 s after boot). */
let engineRef: Engine | null = null;

/** Module-scoped collector so route hooks + engine resolve the same live set.
 *  Set at registerPlugin. Collects published contributions on each call
 *  (publish/collect). See change: decouple-automation-action-registry. */
let collectRegistry: (() => ActionRegistry) | null = null;

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("automation-plugin server entry activated");
  // Publish automation's OWN built-in actions (core.prompt/core.skill) for
  // collection — built-ins are peers, not privileged. Any plugin publishes
  // under `automation.action.<source>`; automation collects lazily on read,
  // so load order is irrelevant. See change: decouple-automation-action-registry.
  ctx.provide(CORE_ACTION_KEY, coreActionContributions());
  collectRegistry = () =>
    collectActionRegistry(ctx.consumeAll(ACTION_CONTRIBUTION_PREFIX), { warn: (m) => ctx.logger.warn(m) });
  const actionRegistry = { descriptorsForCwd: (cwd: string) => collectRegistry!().descriptorsForCwd(cwd) };
  // Per-cwd descriptor cache: descriptorsForCwd() runs each action's
  // available(cwd) + enum options(cwd), which hit the filesystem (e.g. flows
  // discovery). Cache briefly so a burst of `/actions` requests for one cwd
  // does not re-walk disk per call; the TTL keeps it responsive to on-disk
  // flow changes. See change: register-plugin-automation-events.
  const descriptorCache = new Map<string, { ts: number; value: ReturnType<typeof actionRegistry.descriptorsForCwd> }>();
  const DESCRIPTOR_TTL_MS = 3000;
  function descriptorsForCwdCached(cwd: string) {
    const hit = descriptorCache.get(cwd);
    const now = Date.now();
    if (hit && now - hit.ts < DESCRIPTOR_TTL_MS) return hit.value;
    const value = actionRegistry.descriptorsForCwd(cwd);
    descriptorCache.set(cwd, { ts: now, value });
    return value;
  }
  // Mount REST routes synchronously (must register before fastify.listen).
  // Handler bodies lazy-import heavy modules so this stays cheap.
  mountAutomationRoutes(ctx.fastify, {
    runNow: ({ scope, cwd, name }) => runNowViaEngine(scope, cwd, name),
    stopRun: ({ runId }) => stopRunViaEngine(runId),
    listActions: (cwd) => descriptorsForCwdCached(cwd ?? process.cwd()),
    actionIds: () => collectRegistry!().ids(),
  });
  // plugin_action handler: run/stop/create dispatch to the SAME engine cores
  // and writer the REST routes call (no HTTP re-entry). Fan-out routes this
  // only for pluginId==="automation"; the guard is defense-in-depth.
  // See change: fix-plugin-action-fanout-and-handlers.
  ctx.registerBrowserHandler("plugin_action", (msg) => {
    const m = msg as { pluginId?: string; action?: string; payload?: Record<string, unknown> };
    if (m.pluginId !== PLUGIN_ID) return;
    const p = m.payload ?? {};
    const scope: AutomationScope = p.scope === "global" ? "global" : "folder";
    const cwd = typeof p.cwd === "string" ? p.cwd : undefined;
    void (async () => {
      try {
        switch (m.action) {
          case "run": {
            const name = typeof p.name === "string" ? p.name : "";
            if (!name) return ctx.logger.warn("automation run: name required");
            const r = await runNowViaEngine(scope, cwd, name);
            ctx.logger.info(`automation run "${name}" scope=${scope} ok=${r.ok}${r.runId ? ` runId=${r.runId}` : ""}${r.error ? ` error=${r.error}` : ""}`);
            break;
          }
          case "stop": {
            const runId = typeof p.runId === "string" ? p.runId : "";
            if (!runId) return ctx.logger.warn("automation stop: runId required");
            const r = await stopRunViaEngine(runId);
            ctx.logger.info(`automation stop runId=${runId} ok=${r.ok}${r.error ? ` error=${r.error}` : ""}`);
            break;
          }
          case "create": {
            const name = typeof p.name === "string" ? p.name : "";
            const config = p.config as import("../shared/automation-types.js").AutomationConfig | undefined;
            if (!name || !config) return ctx.logger.warn("automation create: name and config required");
            const { writeAutomation, isValidAutomationName } = await import("./automation-writer.js");
            if (!isValidAutomationName(name)) return ctx.logger.warn(`automation create: invalid name "${name}"`);
            const badKind = unknownActionKind(config, collectRegistry?.().ids());
            if (badKind) return ctx.logger.warn(`automation create: unknown action kind "${badKind}"`);
            const base = scope === "global" ? os.homedir() : cwd ? path.resolve(cwd) : process.cwd();
            const result = writeAutomation({
              scopeBase: base,
              name,
              config,
              ...(typeof p.promptBody === "string" ? { promptBody: p.promptBody } : {}),
            });
            ctx.logger.info(`automation create "${name}" scope=${scope} dir=${result.dir}`);
            break;
          }
          default:
            ctx.logger.warn(`unknown automation action: ${m.action}`);
        }
      } catch (err) {
        ctx.logger.error(`automation ${m.action ?? "(no action)"} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  });

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
      maxRunAgeMs: cfg.maxRunAgeMs ?? 30 * 60 * 1000,
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
    abortSpawnedRun: (args) => ctx.abortSpawnedRun(args),
    resolveRegistry: () => collectActionRegistry(ctx.consumeAll(ACTION_CONTRIBUTION_PREFIX), { warn: (m) => ctx.logger.warn(m) }),
    listScopes,
    config: pluginConfig,
    homeDir,
    log: (m) => logger.info(m),
    warn: (m) => logger.warn(m),
  });
  engineRef = engine;

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
  // flushed to result.md on `agent_end`. `runPrompt` holds the injected
  // action prompt per session so capture can defensively exclude it.
  const runText = new Map<string, string[]>();
  const runPrompt = new Map<string, string>();
  // Event-dispatched runs declare how they finish via `emitEvent.completion`
  // (the ACTION owns the completion event name/shape — the automation plugin
  // knows none). Recorded at delivery so `onEvent` can finalize generically:
  // an event run emits no `agent_end`, so without this it would stay `running`
  // forever and starve `concurrency: skip`.
  // See change: finalize-event-dispatched-automation-runs.
  const runCompletion = new Map<
    string,
    { eventType: string; summarize?: (d: Record<string, unknown> | undefined) => string }
  >();
  let rescanTimer: ReturnType<typeof setTimeout> | null = null;

  ctx.onEvent((sessionId, rawEvent) => {
    const event = rawEvent as { eventType?: string; data?: Record<string, unknown> } | undefined;

    // Correlate a registering run session to its pending run (prompt delivery).
    //
    // Correlate strictly by the host-applied `automationRun.runId` stamp: the
    // server stamps the *spawned* session on `session_register` (before any
    // pi event reaches this handler), so matching by runId targets the
    // correct session exactly. A cwd match must NOT be used — onEvent fires
    // for ANY session sharing the run's cwd (incl. pre-existing busy ones
    // with no stamp), and a cwd-FIFO bind delivers the run's prompt to the
    // wrong session, leaving the real run session idle forever.
    // See change: fix-automation-run-correlation.
    const session = ctx.sessionManager.getSession(sessionId) as
      | { automationRun?: { runId?: string } }
      | undefined;
    const stampedRunId = session?.automationRun?.runId;
    if (stampedRunId) {
      const pendingRun = engine.pendingForRunId(stampedRunId);
      if (pendingRun && !pendingRun.delivered) {
        // Deliver the prompt BEFORE marking the run delivered: if
        // sendToSession throws, leave the run undelivered (a later event
        // retries) and clear the half-initialized buffers instead of
        // stranding a "delivered" run that never received its prompt.
        try {
          if (pendingRun.emitEvent) {
            // Event-dispatch action: emit the configured event into the run
            // session instead of seeding a prompt. Record the action-declared
            // completion (if any) so this run finalizes on it, not agent_end.
            ctx.emitEventToSession(sessionId, pendingRun.emitEvent.eventType, pendingRun.emitEvent.data);
            if (pendingRun.emitEvent.completion) {
              runCompletion.set(sessionId, pendingRun.emitEvent.completion);
            }
          } else if (pendingRun.promptText) {
            runPrompt.set(sessionId, pendingRun.promptText);
            ctx.sendToSession(sessionId, pendingRun.promptText);
          }
          engine.onSessionRegisteredForRun(sessionId, stampedRunId);
          runText.set(sessionId, []);
        } catch (err) {
          runPrompt.delete(sessionId);
          runText.delete(sessionId);
          runCompletion.delete(sessionId);
          logger.warn(
            `automation action delivery failed for runId=${stampedRunId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // Buffer assistant text + flush on agent_end for tracked run sessions.
    if (runText.has(sessionId)) {
      const text = extractAssistantText(event, runPrompt.get(sessionId));
      if (text) runText.get(sessionId)!.push(text);
      // Generic finalize. An event-dispatched run with an action-declared
      // completion finalizes on THAT event (it emits no agent_end); every other
      // tracked run (prompt-dispatch, or an event action that declared no
      // completion) finalizes on agent_end. Finalization is idempotent
      // (engine.onSessionEnded via removePending), so a later agent_end after a
      // completion finalize is a no-op.
      const completion = runCompletion.get(sessionId);
      if (completion && event?.eventType === completion.eventType) {
        const buffered = (runText.get(sessionId) ?? []).join("\n\n").trim();
        runText.delete(sessionId);
        runCompletion.delete(sessionId);
        engine.onSessionEnded(sessionId, buffered || (completion.summarize?.(event?.data) ?? ""));
      } else if (event?.eventType === "agent_end") {
        const result = (runText.get(sessionId) ?? []).join("\n\n").trim();
        runText.delete(sessionId);
        runPrompt.delete(sessionId);
        runCompletion.delete(sessionId);
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

  // Finalize a run whose session DIES before its terminal event crosses the
  // bridge — the proven code-only teardown race. Fires on every unregister
  // path (WS close for a headless automation session, heartbeat-timeout,
  // dead-TCP cleanup). Passes the buffered assistant/flow text if any; the
  // engine finalizes `error` with a "session ended before completion" reason
  // when nothing was buffered, and no-ops when the run already finalized
  // (idempotent vs a late flow_complete/agent_end/Stop).
  // See change: finalize-automation-run-on-session-death.
  ctx.onSessionEnded((sessionId) => {
    const buffered = (runText.get(sessionId) ?? []).join("\n\n").trim();
    runText.delete(sessionId);
    runPrompt.delete(sessionId);
    runCompletion.delete(sessionId);
    engine.onSessionDeath(sessionId, buffered);
  });

  void PLUGIN_ID;
}

/**
 * Assistant-text extraction over a raw forwarded pi event.
 *
 * Capture is anchored to the `turn_end` event — the live-verified event that
 * carries the FINALIZED assistant message for a turn
 * (`data.message.role === "assistant"`). Verified against a live Gemini run
 * (task 1.1): the run session forwards assistant output as
 * `message_start` (empty) → `message_update`* (streaming) → `turn_end`
 * (complete message) → `agent_end`, with NO assistant `message_end`; only
 * USER messages emit `message_end`. Anchoring on `turn_end` therefore
 * captures the reply exactly once and never the injected prompt (which
 * arrives as an `input` event + a user `message_start`/`message_end`).
 *
 * Content is the real array-of-blocks shape — only `{ type: "text" }` blocks
 * are concatenated, so `thinking` blocks are excluded; a string `content`
 * (older shape) is also accepted. The explicit-assistant-role guard rejects
 * any non-assistant `turn_end`. Defensively excludes any captured text equal
 * to the run's injected `promptText` (belt-and-suspenders against future
 * event-shape drift). See change: fix-automation-result-capture.
 */
export function extractAssistantText(
  event: { eventType?: string; data?: Record<string, unknown> } | undefined,
  promptText?: string,
): string | null {
  if (!event?.data) return null;
  if (event.eventType !== "turn_end") return null;
  const d = event.data as Record<string, unknown>;
  const message = d.message as Record<string, unknown> | undefined;
  const role = (message?.role ?? d.role) as string | undefined;
  if (role !== "assistant") return null;
  const trimmed = concatText(message?.content ?? d.content ?? d.text).trim();
  if (trimmed.length === 0) return null;
  if (promptText && trimmed === promptText.trim()) return null;
  return trimmed;
}

/** Concatenate the text of `{type:"text"}` content blocks; pass through strings. */
function concatText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type?: string; text?: string } => !!b && typeof b === "object")
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

/**
 * Manual single-run trigger for the Run-now board action. Scans the target
 * scope for the named automation and fires exactly one run via the engine.
 */
async function runNowViaEngine(
  scope: AutomationScope,
  cwd: string | undefined,
  name: string,
): Promise<{ ok: boolean; runId?: string; error?: string }> {
  const eng = engineRef;
  if (!eng) return { ok: false, error: "engine not ready" };
  const base = scope === "global" ? os.homedir() : cwd ? path.resolve(cwd) : process.cwd();
  // Lazy import keeps the scanner out of the cheap route-mount path.
  const { scanAutomations } = await import("./scanner.js");
  const found = scanAutomations(
    scope === "global"
      ? { homeDir: base, scanGlobal: true, scanFolder: false }
      : { repoRoot: base, scanFolder: true, scanGlobal: false },
    eng.registry.kinds(),
    eng.actionRegistry.ids(),
  ).find((a) => a.name === name && a.scope === scope && a.valid);
  if (!found) return { ok: false, error: `automation "${name}" not found or invalid in ${scope} scope` };
  const r = eng.startRunFor(found);
  return r ? { ok: true, runId: r.runId } : { ok: false, error: "run not started" };
}

/** Stop a running run via the engine (terminate process + finalize idempotently). */
async function stopRunViaEngine(runId: string): Promise<{ ok: boolean; error?: string }> {
  const eng = engineRef;
  if (!eng) return { ok: false, error: "engine not ready" };
  return (await eng.stopRun(runId))
    ? { ok: true }
    : { ok: false, error: `run "${runId}" not running or already finished` };
}

export default registerPlugin;
