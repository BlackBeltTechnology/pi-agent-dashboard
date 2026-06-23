/**
 * Automation engine — wires registry + scheduler + runner + scanner +
 * watcher + run-store + model-resolver into the server plugin entry.
 *
 * Responsibilities:
 *   - scan both scopes, arm valid automations (scheduler), re-arm on edits
 *     (watcher);
 *   - on fire (respecting concurrency), resolve the model, write a `running`
 *     run record, and spawn a run session via the `ServerPluginContext`
 *     spawn hook stamped `kind="automation"` + effective visibility;
 *   - deliver the action (prompt.md contents OR `$skill` token) into the run
 *     session once it registers;
 *   - capture `result.md` + transition status when the run ends.
 *
 * I/O (spawn, prompt delivery, transcript read) is injected so the engine is
 * unit-testable without a live server. See change: add-automation-plugin.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type {
  DiscoveredAutomation,
  AutomationScope,
  Visibility,
  RunMode,
  Sandbox,
} from "../shared/automation-types.js";
import { TriggerRegistry } from "./trigger-registry.js";
import { scheduleTrigger } from "./schedule-trigger.js";
import { createScheduler, automationKey, type Scheduler } from "./scheduler.js";
import { createRunner, type Runner } from "./runner.js";
import { scanAutomations } from "./scanner.js";
import { resolveModel } from "./model-resolver.js";
import { startRun as storeStartRun, finishRun as storeFinishRun } from "./run-store.js";

/** Build the prompt text delivered to a run session for an automation action. */
export function buildRunPrompt(automation: DiscoveredAutomation): string {
  const action = automation.config!.action;
  if (action.kind === "skill") {
    // `$skill-name` token is delivered as-is so pi's skill router picks it up.
    return action.skill!.startsWith("$") ? action.skill! : `$${action.skill}`;
  }
  // prompt action: read the durable prompt.md (path resolved against dir).
  const promptPath = path.isAbsolute(action.prompt!)
    ? action.prompt!
    : path.join(automation.dir, action.prompt!);
  try {
    return fs.readFileSync(promptPath, "utf-8").trim();
  } catch {
    return "";
  }
}

/** Effective board visibility: per-automation field ?? settings default. */
export function effectiveVisibility(
  automation: DiscoveredAutomation,
  settingsDefault: Visibility,
): Visibility {
  return automation.config!.visibility ?? settingsDefault;
}

/** Scope base + scope tag the engine scans + arms. */
export interface ScopeTarget {
  base: string;
  scope: AutomationScope;
}

export interface SpawnLike {
  (opts: {
    cwd: string;
    model?: string;
    /** Run isolation mode (worktree|local). Honored by the host spawn hook. */
    mode?: RunMode;
    /** Sandbox level requested for the run. Honored by the host spawn hook. */
    sandbox?: Sandbox;
    automationRun?: { name: string; runId: string; visibility?: Visibility };
  }): Promise<{ success: boolean; spawnToken?: string; message?: string }>;
}

export interface EngineConfig {
  defaultVisibility: Visibility;
  retention: number;
  defaultModel?: string;
  scanFolder: boolean;
  scanGlobal: boolean;
}

export interface EngineDeps {
  spawnSession: SpawnLike;
  /** Scope targets to scan/arm (global + per-folder). */
  listScopes: () => ScopeTarget[];
  config: () => EngineConfig;
  homeDir?: string;
  readRoles?: () => Record<string, string>;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
  now?: () => number;
}

/** Mutable per-run context tracked from spawn → register → end. */
export interface RunContext {
  key: string;
  runId: string;
  scopeBase: string;
  automation: DiscoveredAutomation;
  cwd: string;
  promptText: string;
  modelError?: string;
  sessionId?: string;
  delivered: boolean;
}

export interface Engine {
  /** Scan + arm everything (boot + folder-set change). */
  start(): void;
  /** Re-scan + re-arm (called by the watcher onChange). */
  refresh(): void;
  /** Spawn-side of a fire — exposed for tests. Returns the run id or null. */
  startRunFor(automation: DiscoveredAutomation): { runId: string } | null;
  /** Run-context lookup by cwd (used by the register correlation). */
  pendingForCwd(cwd: string): RunContext | undefined;
  /** Run-context lookup by runId (exact, race-free correlation). */
  pendingForRunId(runId: string): RunContext | undefined;
  /** Mark a registered run session, delivering its action prompt once. */
  onSessionRegistered(sessionId: string, cwd: string): void;
  /**
   * Bind a registered session to its run by the host-applied automationRun
   * stamp (runId). Exact — immune to the same-cwd FIFO races that
   * `onSessionRegistered` is subject to. Preferred correlation path.
   */
  onSessionRegisteredForRun(sessionId: string, runId: string): void;
  /** Capture result.md + transition status when a run session ends. */
  onSessionEnded(sessionId: string, result: string): void;
  scheduler: Scheduler;
  runner: Runner;
  registry: TriggerRegistry;
  dispose(): void;
}

function normalize(p: string): string {
  return p.replace(/[/\\]+$/, "");
}

export function createEngine(deps: EngineDeps): Engine {
  const log = deps.log ?? (() => {});
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const homeDir = deps.homeDir ?? os.homedir();

  const registry = new TriggerRegistry();
  registry.register(scheduleTrigger);

  // cwd(normalized) → FIFO queue of RunContexts awaiting register/end
  // correlation. Keyed by cwd (the only signal available at
  // `session_register`) but a QUEUE per cwd so concurrent runs in the same
  // scope (concurrency: parallel, or mode: local) don't overwrite each
  // other — registers bind to the oldest undelivered context FIFO, ends
  // match by sessionId. Mirrors the server-side pending-automation-run
  // registry's FIFO-per-cwd semantics. See change: add-automation-plugin.
  const pending = new Map<string, RunContext[]>();

  function enqueuePending(ctx: RunContext): void {
    const q = pending.get(ctx.cwd) ?? [];
    q.push(ctx);
    pending.set(ctx.cwd, q);
  }
  function removePending(ctx: RunContext): void {
    const q = pending.get(ctx.cwd);
    if (!q) return;
    const i = q.indexOf(ctx);
    if (i >= 0) q.splice(i, 1);
    if (q.length === 0) pending.delete(ctx.cwd);
  }
  function firstUndeliveredForCwd(cwd: string): RunContext | undefined {
    return (pending.get(normalize(cwd)) ?? []).find((c) => !c.delivered);
  }
  function firstUndeliveredForRunId(runId: string): RunContext | undefined {
    for (const q of pending.values()) {
      const hit = q.find((c) => c.runId === runId && !c.delivered);
      if (hit) return hit;
    }
    return undefined;
  }
  function findBySession(sessionId: string): RunContext | undefined {
    for (const q of pending.values()) {
      const hit = q.find((c) => c.sessionId === sessionId);
      if (hit) return hit;
    }
    return undefined;
  }
  function finishAndRelease(ctx: RunContext, fin: { status: "done" | "error"; result?: string; error?: string }): void {
    const cfg = deps.config();
    storeFinishRun(ctx.scopeBase, ctx.runId, {
      status: fin.status,
      ...(fin.result !== undefined ? { result: fin.result } : {}),
      ...(fin.error ? { error: fin.error } : {}),
      retention: cfg.retention,
    });
    removePending(ctx);
    runner.completeRun(ctx.key);
  }

  function scopeBaseFor(a: DiscoveredAutomation): string {
    // The run store lives under the same scope base the automation was found
    // in. Folder automations carry their repo root via `dir` (…/.pi/automation
    // /<name>); strip the trailing `.pi/automation/<name>` to recover the base.
    const marker = path.join(".pi", "automation");
    const idx = a.dir.indexOf(marker);
    if (idx >= 0) return a.dir.slice(0, idx).replace(/[/\\]+$/, "");
    return a.scope === "global" ? homeDir : a.dir;
  }

  const runner: Runner = createRunner({
    startRun: (automation) => {
      const r = startRunFor(automation);
      return r ? { runId: r.runId } : null;
    },
    log,
    warn,
  });

  const scheduler = createScheduler({
    registry,
    onFire: (automation) => runner.fire(automation),
    now: deps.now,
    log,
    warn,
  });

  function startRunFor(automation: DiscoveredAutomation): { runId: string } | null {
    if (!automation.valid || !automation.config) return null;
    const cfg = deps.config();
    const scopeBase = scopeBaseFor(automation);
    const runCwd = scopeBase; // phase-1: run in the scope base (local mode)
    const vis = effectiveVisibility(automation, cfg.defaultVisibility);

    const resolved = resolveModel(automation.config.model, {
      defaultModel: cfg.defaultModel,
      ...(deps.readRoles ? { readRoles: deps.readRoles } : {}),
    });

    const rec = storeStartRun(scopeBase, automation.name);
    const promptText = buildRunPrompt(automation);

    const ctx: RunContext = {
      key: automationKey(automation),
      runId: rec.runId,
      scopeBase,
      automation,
      cwd: normalize(runCwd),
      promptText,
      ...(resolved.error ? { modelError: resolved.error } : {}),
      delivered: false,
    };
    enqueuePending(ctx);

    void deps
      .spawnSession({
        cwd: runCwd,
        ...(resolved.model ? { model: resolved.model } : {}),
        mode: automation.config.mode,
        sandbox: automation.config.sandbox,
        automationRun: { name: automation.name, runId: rec.runId, visibility: vis },
      })
      .then((res) => {
        if (!res.success) {
          warn(`[engine] spawn failed for ${ctx.key}: ${res.message ?? "unknown"}`);
          finishAndRelease(ctx, { status: "error", error: res.message ?? "spawn failed" });
        }
      })
      .catch((e) => {
        // A rejected spawn promise MUST still finish the run + release the
        // runner slot, else skip/queue automations deadlock (the prior run
        // stays "active" forever). See change: add-automation-plugin (CR).
        warn(`[engine] spawn threw for ${ctx.key}: ${e instanceof Error ? e.message : String(e)}`);
        finishAndRelease(ctx, { status: "error", error: e instanceof Error ? e.message : String(e) });
      });

    log(`[engine] started run ${rec.runId} (${ctx.key}) model=${resolved.model || "(default)"}`);
    return { runId: rec.runId };
  }

  return {
    scheduler,
    runner,
    registry,

    start(): void {
      this.refresh();
    },

    refresh(): void {
      const scopes = deps.listScopes();
      const all: DiscoveredAutomation[] = [];
      for (const s of scopes) {
        all.push(
          ...scanAutomations(
            {
              ...(s.scope === "folder" ? { repoRoot: s.base, scanFolder: true, scanGlobal: false } : {}),
              ...(s.scope === "global" ? { homeDir: s.base, scanGlobal: true, scanFolder: false } : {}),
            },
            registry.kinds(),
          ),
        );
      }
      scheduler.armAll(all);
      log(`[engine] armed ${scheduler.armedKeys().length} automation(s) across ${scopes.length} scope(s)`);
    },

    startRunFor,

    pendingForCwd(cwd: string): RunContext | undefined {
      return firstUndeliveredForCwd(cwd);
    },

    pendingForRunId(runId: string): RunContext | undefined {
      return firstUndeliveredForRunId(runId);
    },

    onSessionRegistered(sessionId: string, cwd: string): void {
      const ctx = firstUndeliveredForCwd(cwd);
      if (!ctx) return;
      ctx.sessionId = sessionId;
      ctx.delivered = true;
      log(`[engine] delivering action to run ${ctx.runId} (session ${sessionId})`);
    },

    onSessionRegisteredForRun(sessionId: string, runId: string): void {
      const ctx = firstUndeliveredForRunId(runId);
      if (!ctx) return;
      ctx.sessionId = sessionId;
      ctx.delivered = true;
      log(`[engine] delivering action to run ${ctx.runId} (session ${sessionId})`);
    },

    onSessionEnded(sessionId: string, result: string): void {
      const found = findBySession(sessionId);
      if (!found) return;
      finishAndRelease(found, {
        status: found.modelError ? "error" : "done",
        result,
        ...(found.modelError ? { error: found.modelError } : {}),
      });
      log(`[engine] run ${found.runId} ended (${found.key})`);
    },

    dispose(): void {
      scheduler.disposeAll();
      pending.clear();
    },
  };
}
