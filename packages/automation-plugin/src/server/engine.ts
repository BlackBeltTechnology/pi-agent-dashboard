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
import os from "node:os";
import path from "node:path";
import type {
  AutomationScope,
  DiscoveredAutomation,
  RunMode,
  Sandbox,
  Visibility,
} from "../shared/automation-types.js";
import {
  type ActionCompletion,
  type ActionRegistry,
  createActionRegistryWithBuiltins,
  normalizeActionKind,
} from "./action-registry.js";
import { fileTrigger } from "./file-trigger.js";
import { interpolate } from "./interpolate.js";
import { resolveModel } from "./model-resolver.js";
import {
  listStaleRunningRuns,
  finishRun as storeFinishRun,
  startRun as storeStartRun,
} from "./run-store.js";
import { createRunner, type Runner } from "./runner.js";
import { scanAutomations } from "./scanner.js";
import { scheduleTrigger } from "./schedule-trigger.js";
import { automationKey, createScheduler, type Scheduler } from "./scheduler.js";
import { type FireContext, TriggerRegistry } from "./trigger-registry.js";

/**
 * Build the prompt text delivered to a run session for an automation action.
 *
 * Resolves `action.kind` (normalizing bare `prompt`/`skill` to `core.*`)
 * against the registry and delegates to the action's `buildPrompt`. Falls
 * back to the legacy inline prompt/skill behavior when no registry is given
 * or the action is unregistered (defensive). See change:
 * register-plugin-automation-events.
 */
export function buildRunPrompt(
  automation: DiscoveredAutomation,
  actionRegistry?: ActionRegistry,
  /** Per-fire resolved payload (overrides the static `action.payload`). */
  resolvedPayload?: Record<string, unknown>,
): string {
  const action = automation.config!.action;
  const payload = resolvedPayload ?? action.payload ?? {};
  const reg = actionRegistry?.get(normalizeActionKind(action.kind));
  if (reg) {
    return reg.buildPrompt ? reg.buildPrompt({ payload, automation }).trim() : "";
  }
  // Legacy fallback (no registry / unregistered): inline prompt|skill.
  if (action.kind === "skill") {
    return action.skill!.startsWith("$") ? action.skill! : `$${action.skill}`;
  }
  if (action.prompt) {
    const promptPath = path.isAbsolute(action.prompt)
      ? action.prompt
      : path.join(automation.dir, action.prompt);
    try {
      return fs.readFileSync(promptPath, "utf-8").trim();
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * How a run is delivered to its session: seed a prompt, or emit a configured
 * event. Resolved at start from the action's `buildPrompt`/`buildEvent`.
 * See change: automation-emit-configured-event.
 */
export type RunDispatch =
  | { kind: "prompt"; text: string }
  | { kind: "event"; eventType: string; data?: Record<string, unknown>; completion?: ActionCompletion };

/** Resolve the dispatch for an automation's action against the registry. */
export function buildRunDispatch(
  automation: DiscoveredAutomation,
  actionRegistry?: ActionRegistry,
  /** Per-fire context; its `value` resolves `${{trigger}}` in the payload. */
  ctx?: FireContext,
): RunDispatch {
  const action = automation.config!.action;
  // Central per-fire substitution: resolve `${{trigger}}` in the whole payload
  // ONCE, so no action needs its own interpolation logic.
  const payload = interpolate(action.payload ?? {}, ctx?.value) as Record<string, unknown>;
  const reg = actionRegistry?.get(normalizeActionKind(action.kind));
  if (reg?.buildEvent) {
    const ev = reg.buildEvent({ payload, automation });
    if (ev && typeof ev.eventType === "string" && ev.eventType.length > 0) {
      return {
        kind: "event",
        eventType: ev.eventType,
        ...(ev.data ? { data: ev.data } : {}),
        ...(ev.completion ? { completion: ev.completion } : {}),
      };
    }
    return { kind: "prompt", text: "" };
  }
  return { kind: "prompt", text: buildRunPrompt(automation, actionRegistry, payload) };
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
  /**
   * Max age (ms) a run may stay `running` before the reaper finalizes it as
   * `error` and frees its concurrency slot. Transport-independent backstop
   * against a lost terminal event. <= 0 disables the reaper. See change:
   * finalize-automation-run-on-session-death.
   */
  maxRunAgeMs: number;
}

export interface EngineDeps {
  spawnSession: SpawnLike;
  /**
   * Host-provided run termination (Stop + normal completion). Kills the
   * spawned process by `sessionId` (linked) or `spawnToken` (pre-register);
   * `graceful: true` sends a clean-exit hint before the kill ladder. Returns
   * false when untrusted/nothing targeted. See change:
   * fix-automation-stop-zombie-runs.
   */
  abortSpawnedRun?: (args: {
    sessionId?: string;
    spawnToken?: string;
    graceful?: boolean;
  }) => Promise<boolean>;
  /**
   * Shared action registry (built-ins + plugin-registered). When omitted the
   * engine creates one with only the built-ins. See change:
   * register-plugin-automation-events.
   */
  /** Resolve the current action registry (collected fresh from published
   *  contributions). Called at dispatch + scan time. See change:
   *  decouple-automation-action-registry. */
  resolveRegistry?: () => ActionRegistry;
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
  /**
   * When set, dispatch emits this event into the session instead of a prompt.
   * `completion` (when present) is how the run finishes — an event-dispatched
   * run produces no `agent_end`, so the engine finalizes on the declared
   * completion event. See change: finalize-event-dispatched-automation-runs.
   */
  emitEvent?: { eventType: string; data?: Record<string, unknown>; completion?: ActionCompletion };
  modelError?: string;
  sessionId?: string;
  /**
   * Spawn correlation token captured from the `spawnSession` result. Gives
   * Stop a process handle BEFORE any sessionId is bound (the fix for the
   * spawn→register zombie window). See change: fix-automation-stop-zombie-runs.
   */
  spawnToken?: string;
  delivered: boolean;
}

export interface Engine {
  /** Scan + arm everything (boot + folder-set change). */
  start(): void;
  /** Re-scan + re-arm (called by the watcher onChange). */
  refresh(): void;
  /** Spawn-side of a fire — exposed for tests. Returns the run id or null.
   *  `ctx` carries the per-fire value for `${{trigger}}` resolution. */
  startRunFor(automation: DiscoveredAutomation, ctx?: FireContext): { runId: string } | null;
  /**
   * Stop a `running` run: terminate its spawned process via the host hook
   * (hard-kill by sessionId, or by spawnToken during the spawn→register
   * window) and finalize the run record once, AFTER termination is attempted.
   * Idempotent vs `onSessionEnded` — a subsequent end event for that session
   * is a no-op. Returns false when the run is unknown/already finalized.
   * See change: automation-ui-mockup-parity, fix-automation-stop-zombie-runs.
   */
  stopRun(runId: string): Promise<boolean>;
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
  /**
   * Finalize a tracked run whose session DIED (connection close / heartbeat
   * timeout, no reconnect) before delivering a terminal event. Finalizes once
   * with the buffered `result` if present, else `error` with a
   * "session ended before completion" reason, and frees the concurrency slot.
   * Idempotent: a run already finalized (removed from pending) is a no-op, so
   * a late `flow_complete`/`agent_end`/Stop after death does nothing.
   * See change: finalize-automation-run-on-session-death.
   */
  onSessionDeath(sessionId: string, result?: string): void;
  /**
   * Backstop sweep: any `running` run older than `config().maxRunAgeMs` is
   * finalized `error` + its slot freed (live runs) or its on-disk record
   * cleared (pre-existing orphans). Idempotent with every other finalize
   * path. Driven by an internal timer and callable directly (tests).
   * See change: finalize-automation-run-on-session-death.
   */
  reapStaleRuns(): void;
  scheduler: Scheduler;
  runner: Runner;
  registry: TriggerRegistry;
  /** Shared action registry (built-ins + plugin-registered). */
  actionRegistry: ActionRegistry;
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
  registry.register(fileTrigger);
  const resolveRegistry = deps.resolveRegistry ?? (() => createActionRegistryWithBuiltins({ warn }));

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
  function findByRunId(runId: string): RunContext | undefined {
    for (const q of pending.values()) {
      const hit = q.find((c) => c.runId === runId);
      if (hit) return hit;
    }
    return undefined;
  }
  function reapStaleRuns(): void {
    const cfg = deps.config();
    const maxAgeMs = cfg.maxRunAgeMs;
    if (!maxAgeMs || maxAgeMs <= 0) return;
    const now = deps.now?.() ?? Date.now();
    const seenBases = new Set<string>();
    for (const s of deps.listScopes()) {
      if (seenBases.has(s.base)) continue;
      seenBases.add(s.base);
      let stale: ReturnType<typeof listStaleRunningRuns>;
      try {
        stale = listStaleRunningRuns(s.base, maxAgeMs, now);
      } catch {
        continue;
      }
      for (const rec of stale) {
        const ctx = findByRunId(rec.runId);
        if (ctx) {
          // Live wedged run — finalize + free the concurrency slot.
          finishAndRelease(ctx, {
            status: "error",
            error: "run exceeded max age",
            result: "_(run exceeded max age)_",
          });
        } else {
          // Pre-existing on-disk orphan (no live lock held) — clear the record.
          storeFinishRun(s.base, rec.runId, {
            status: "error",
            error: "run exceeded max age",
            result: "_(run exceeded max age)_",
            retention: cfg.retention,
          });
        }
        warn(`[engine] reaped stale run ${rec.runId} (running > ${maxAgeMs}ms)`);
      }
    }
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
    startRun: (automation, ctx) => {
      const r = startRunFor(automation, ctx);
      return r ? { runId: r.runId } : null;
    },
    log,
    warn,
  });

  const scheduler = createScheduler({
    registry,
    onFire: (automation, ctx) => runner.fire(automation, ctx),
    now: deps.now,
    log,
    warn,
  });

  // Stale-run reaper backstop timer. Sweeps on an interval; also callable
  // directly (reapStaleRuns) for tests. See change:
  // finalize-automation-run-on-session-death.
  const REAP_INTERVAL_MS = 60_000;
  let reapTimer: ReturnType<typeof setInterval> | null = null;

  function startRunFor(automation: DiscoveredAutomation, fireCtx?: FireContext): { runId: string } | null {
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
    const dispatch = buildRunDispatch(automation, resolveRegistry(), fireCtx);
    const promptText = dispatch.kind === "prompt" ? dispatch.text : "";

    const ctx: RunContext = {
      key: automationKey(automation),
      runId: rec.runId,
      scopeBase,
      automation,
      cwd: normalize(runCwd),
      promptText,
      ...(dispatch.kind === "event"
        ? {
            emitEvent: {
              eventType: dispatch.eventType,
              ...(dispatch.data ? { data: dispatch.data } : {}),
              ...(dispatch.completion ? { completion: dispatch.completion } : {}),
            },
          }
        : {}),
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
          return;
        }
        // Capture the process handle so Stop can kill the run even before its
        // session registers. See change: fix-automation-stop-zombie-runs.
        if (res.spawnToken) ctx.spawnToken = res.spawnToken;
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
    get actionRegistry() { return resolveRegistry(); },

    start(): void {
      this.refresh();
      if (!reapTimer) {
        reapTimer = setInterval(() => reapStaleRuns(), REAP_INTERVAL_MS);
        if (typeof reapTimer.unref === "function") reapTimer.unref();
      }
    },

    reapStaleRuns,

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
            resolveRegistry().ids(),
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

    async stopRun(runId: string): Promise<boolean> {
      // Find the live pending context for this run (any state). A run already
      // finalized has been removed from `pending`, so this returns false and
      // the call is a no-op — idempotent against a prior stop or agent_end.
      const ctx = findByRunId(runId);
      if (!ctx) return false;
      // Terminate the actual process (immediate hard-kill — the failure mode
      // is a surviving pi, not a stuck turn). Kills by sessionId when linked,
      // else by spawnToken (the spawn→register window). Attempt the kill
      // BEFORE finalizing so we never finalize a still-running process.
      if (deps.abortSpawnedRun) {
        await deps.abortSpawnedRun({
          ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
          ...(ctx.spawnToken ? { spawnToken: ctx.spawnToken } : {}),
        });
      }
      // Finalize once. A non-empty result marker keeps the stopped run out of
      // the auto-archive (empty) bucket so it stays visible in Triage.
      // removePending makes the later onSessionEnded a no-op (findBySession
      // won't find it) — idempotent vs the agent_end capture path.
      finishAndRelease(ctx, { status: "error", result: "_(stopped by user)_", error: "stopped by user" });
      log(`[engine] run ${ctx.runId} stopped (${ctx.key})`);
      return true;
    },

    onSessionEnded(sessionId: string, result: string): void {
      const found = findBySession(sessionId);
      if (!found) return;
      const spawnToken = found.spawnToken;
      finishAndRelease(found, {
        status: found.modelError ? "error" : "done",
        result,
        ...(found.modelError ? { error: found.modelError } : {}),
      });
      // Terminate the now-idle persistent `--mode rpc` session (it does not
      // self-exit on agent_end). Graceful: send a clean-exit hint + escalate
      // via the kill ladder in the host hook. Runs AFTER removePending so any
      // self-triggered end signal is a no-op (idempotent). Fire-and-forget —
      // finalization already happened. See change: fix-automation-stop-zombie-runs.
      if (deps.abortSpawnedRun) {
        void deps.abortSpawnedRun({
          sessionId,
          ...(spawnToken ? { spawnToken } : {}),
          graceful: true,
        });
      }
      log(`[engine] run ${found.runId} ended (${found.key})`);
    },

    onSessionDeath(sessionId: string, result?: string): void {
      const found = findBySession(sessionId);
      if (!found) return; // unknown or already finalized — idempotent no-op
      const spawnToken = found.spawnToken;
      const buffered = (result ?? "").trim();
      if (buffered.length > 0) {
        finishAndRelease(found, {
          status: found.modelError ? "error" : "done",
          result: buffered,
          ...(found.modelError ? { error: found.modelError } : {}),
        });
      } else {
        finishAndRelease(found, {
          status: "error",
          error: found.modelError ?? "session ended before completion",
          result: "_(session ended before completion)_",
        });
      }
      // The session is already gone (WS closed / heartbeat expired). Best-effort
      // hard-kill any surviving process so a hung rpc session cannot linger.
      // Runs after removePending, so a later end signal is a no-op (idempotent).
      if (deps.abortSpawnedRun) {
        void deps.abortSpawnedRun({ sessionId, ...(spawnToken ? { spawnToken } : {}) });
      }
      log(`[engine] run ${found.runId} finalized on session death (${found.key})`);
    },

    dispose(): void {
      scheduler.disposeAll();
      if (reapTimer) {
        clearInterval(reapTimer);
        reapTimer = null;
      }
      pending.clear();
    },
  };
}
