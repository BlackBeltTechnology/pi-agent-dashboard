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
  RunMode,RunStatus, 
  Sandbox,
  Visibility
} from "../shared/automation-types.js";
import type { LeasedHandle, WorkSource } from "../shared/work-source.js";
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
  DEFAULT_MAX_CONCURRENT_SPAWNS,
  effectiveBound,
  resolveChildren,
} from "./resolve-children.js";
import {
  listStaleRunningRuns,
  finishParentRun as storeFinishParentRun,
  finishRun as storeFinishRun,
  setSessionId as storeSetSessionId,
  startChildRun as storeStartChildRun,
  startParentRun as storeStartParentRun,
} from "./run-store.js";
import { createRunner, type Runner } from "./runner.js";
import { scanAutomations } from "./scanner.js";
import { scheduleBatchTrigger } from "./schedule-batch-trigger.js";
import { scheduleTrigger } from "./schedule-trigger.js";
import { automationKey, createScheduler, type Scheduler } from "./scheduler.js";
import { type FireContext, TriggerRegistry } from "./trigger-registry.js";
import { WorkSourceRegistry } from "./work-source-registry.js";

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
  const action = automation.config?.action;
  if (!action) return "";
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
  const action = automation.config?.action;
  if (!action) return { kind: "prompt", text: "" };
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
    automationRun?: { name: string; runId: string; visibility?: Visibility; idempotencyKey?: string };
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
  /**
   * Settings-default cap on concurrent child spawns per fire, used when an
   * automation declares no `maxConcurrentSpawns`. See change:
   * add-automation-concurrent-spawn.
   */
  maxConcurrentSpawns?: number;
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
  /**
   * Stable work-source registry for `schedule.batch` fan-out. A work-source
   * carries lease state, so this MUST be one instance for the engine's life
   * (unlike the per-read action registry). Omitted → an empty registry.
   * See change: automation-work-source-fanout.
   */
  workSources?: WorkSourceRegistry;
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
  /** Parent occurrence run id this child belongs to. */
  parentRunId: string;
  /** Human label of the action this child dispatches. */
  actionLabel: string;
  /**
   * Work-source lease this child holds (work-source fan-out only). Released on
   * every finalize path: `done` acks (drops), any other terminal status nacks
   * (returns to pool). Absent for static `count`/`actions` fan-out.
   * See change: automation-work-source-fanout.
   */
  lease?: { source: WorkSource; token: string };
  /** Stable per-item idempotency key injected on the spawn stamp (work-source). */
  idempotencyKey?: string;
  /**
   * Set when a stop landed during the spawn→register window (no sessionId, no
   * token yet). The spawn continuation aborts immediately with the freshly
   * returned token when it observes this. See change:
   * add-automation-concurrent-spawn (decision 7a).
   */
  stopRequested?: boolean;
  /** Idempotency guard: true once this child has been finalized. */
  finalized?: boolean;
}

/** Per-parent finalization counter (decision 4). */
interface ParentState {
  parentRunId: string;
  key: string;
  scopeBase: string;
  name: string;
  remaining: number;
  statuses: RunStatus[];
  findings: number;
  warning?: string;
  finalized: boolean;
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
  /** Stable work-source registry for `schedule.batch` fan-out. */
  workSources: WorkSourceRegistry;
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
  registry.register(scheduleBatchTrigger);
  registry.register(fileTrigger);
  const workSources = deps.workSources ?? new WorkSourceRegistry();
  const resolveRegistry = deps.resolveRegistry ?? (() => createActionRegistryWithBuiltins({ warn }));

  // cwd(normalized) → FIFO queue of RunContexts awaiting register/end
  // correlation. Keyed by cwd (the only signal available at
  // `session_register`) but a QUEUE per cwd so concurrent runs in the same
  // scope (concurrency: parallel, or mode: local) don't overwrite each
  // other — registers bind to the oldest undelivered context FIFO, ends
  // match by sessionId. Mirrors the server-side pending-automation-run
  // registry's FIFO-per-cwd semantics. See change: add-automation-plugin.
  const pending = new Map<string, RunContext[]>();
  // parentRunId → per-parent finalization counter. A parent finalizes exactly
  // once when its counter reaches zero. See change: add-automation-concurrent-spawn.
  const parents = new Map<string, ParentState>();

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
      // `listStaleRunningRuns` returns child + legacy-flat running records only
      // (never a parent), so the reaper never orphan-finalizes a parent that
      // still has live children — the parent finalizes solely via the child
      // counter. See change: add-automation-concurrent-spawn.
      for (const rec of stale) {
        const ctx = findByRunId(rec.runId);
        if (ctx) {
          // Live wedged child — finalize it (decrements its parent counter).
          finalizeChild(ctx, {
            status: "error",
            error: "run exceeded max age",
            result: "_(run exceeded max age)_",
          });
        } else {
          // Pre-existing on-disk orphan (no live context) — clear the record.
          storeFinishRun(s.base, rec.runId, {
            status: "error",
            error: "run exceeded max age",
            result: "_(run exceeded max age)_",
            retention: cfg.retention,
          });
        }
        // `path=reaper` on a run whose work completed is a delivery defect, not
        // a normal terminal state. See change: fix-automation-run-lifecycle.
        warn(`[finalize] path=reaper run ${rec.runId} (running > ${maxAgeMs}ms)`);
      }
    }
  }

  /** Aggregate child outcomes into a parent status (decision 4). */
  function aggregateStatus(statuses: RunStatus[]): RunStatus {
    if (statuses.some((s) => s === "error")) return "error";
    if (statuses.length > 0 && statuses.every((s) => s === "stopped")) return "stopped";
    return "done";
  }

  /** Finalize the parent occurrence once its child counter reaches zero. Owns
   *  the single `runner.completeRun(key)` call for the whole fire (decision 4a). */
  function finalizeParent(parent: ParentState): void {
    if (parent.finalized) return;
    parent.finalized = true;
    const cfg = deps.config();
    storeFinishParentRun(parent.scopeBase, parent.parentRunId, {
      status: aggregateStatus(parent.statuses),
      findings: parent.findings,
      ...(parent.warning ? { warning: parent.warning } : {}),
      retention: cfg.retention,
    });
    parents.delete(parent.parentRunId);
    runner.completeRun(parent.key);
    log(`[engine] parent run ${parent.parentRunId} finalized (${parent.key})`);
  }

  /**
   * Finalize ONE child record and decrement its parent counter. Does NOT call
   * `runner.completeRun` — only parent finalization does (decision 4a). Idempotent
   * via `ctx.finalized`.
   */
  function finalizeChild(
    ctx: RunContext,
    fin: { status: RunStatus; result?: string; error?: string },
  ): void {
    if (ctx.finalized) return;
    ctx.finalized = true;
    const cfg = deps.config();
    const rec = storeFinishRun(ctx.scopeBase, ctx.runId, {
      status: fin.status,
      ...(fin.result !== undefined ? { result: fin.result } : {}),
      ...(fin.error ? { error: fin.error } : {}),
      retention: cfg.retention,
    });
    removePending(ctx);
    // Release a work-source lease from the terminal status: `done` drops the
    // item (ack); error/stopped/death return it to the pool (nack). Stale/
    // expired tokens are no-ops inside the source. See change:
    // automation-work-source-fanout.
    if (ctx.lease) {
      try {
        if (fin.status === "done") ctx.lease.source.ack(ctx.lease.token);
        else ctx.lease.source.nack(ctx.lease.token);
      } catch (e) {
        warn(`[engine] lease release failed for ${ctx.runId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const findings = rec?.findings ?? 0;
    const parent = parents.get(ctx.parentRunId);
    if (parent) {
      parent.remaining -= 1;
      parent.statuses.push(fin.status);
      parent.findings += findings;
      if (parent.remaining <= 0) finalizeParent(parent);
    } else {
      // Defensive: a child with no tracked parent releases the slot directly.
      runner.completeRun(ctx.key);
    }
  }

  /**
   * Stop ONE child: terminate its process then finalize it `stopped`. When the
   * child is still in the spawn→register window (no sessionId, no token), record
   * `stopRequested` so the spawn continuation aborts on token arrival
   * (decision 7a) — do NOT finalize yet, or the parent counter would drop a
   * child that later registers and runs on.
   */
  async function stopChild(ctx: RunContext): Promise<void> {
    if (ctx.finalized) return;
    if (ctx.sessionId || ctx.spawnToken) {
      if (deps.abortSpawnedRun) {
        // Guard the await: a rejected abort MUST NOT skip finalization, or the
        // child's lease would never be released. See change:
        // automation-work-source-fanout.
        try {
          await deps.abortSpawnedRun({
            ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
            ...(ctx.spawnToken ? { spawnToken: ctx.spawnToken } : {}),
          });
        } catch (e) {
          warn(`[engine] abort failed for ${ctx.runId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      finalizeChild(ctx, { status: "stopped", result: "_(stopped by user)_", error: "stopped by user" });
      return;
    }
    // Spawn window: no handle yet — defer the kill to the spawn continuation.
    ctx.stopRequested = true;
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

  /** Spawn one child session for a resolved child spec. */
  function spawnChild(
    parent: ParentState,
    childAutomation: DiscoveredAutomation,
    actionLabel: string,
    runCwd: string,
    resolved: ReturnType<typeof resolveModel>,
    vis: Visibility,
    fireCtx: FireContext | undefined,
    /** Work-source extras: the lease this child holds + its idempotency key. */
    extra?: { lease?: { source: WorkSource; token: string }; idempotencyKey?: string },
  ): void {
    let ctx: RunContext | undefined;
    try {
    // Build the dispatch BEFORE writing the child record so a dispatch/registry
    // throw leaves no orphan `running` record behind (nothing to finalize).
    const dispatch = buildRunDispatch(childAutomation, resolveRegistry(), fireCtx);
    const promptText = dispatch.kind === "prompt" ? dispatch.text : "";
    const childRec = storeStartChildRun(parent.scopeBase, parent.parentRunId, parent.name, {
      actionLabel,
    });

    ctx = {
      key: parent.key,
      runId: childRec.runId,
      parentRunId: parent.parentRunId,
      actionLabel,
      scopeBase: parent.scopeBase,
      automation: childAutomation,
      cwd: normalize(runCwd),
      promptText,
      ...(extra?.lease ? { lease: extra.lease } : {}),
      ...(extra?.idempotencyKey ? { idempotencyKey: extra.idempotencyKey } : {}),
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
    // Non-optional alias so the async closures see a defined RunContext (the
    // outer `ctx` is `| undefined` only for the synchronous-setup catch below).
    const c: RunContext = ctx;
    enqueuePending(c);

    void deps
      .spawnSession({
        cwd: runCwd,
        ...(resolved.model ? { model: resolved.model } : {}),
        mode: childAutomation.config!.mode,
        sandbox: childAutomation.config!.sandbox,
        automationRun: {
          name: parent.name,
          runId: childRec.runId,
          visibility: vis,
          ...(extra?.idempotencyKey ? { idempotencyKey: extra.idempotencyKey } : {}),
        },
      })
      .then((res) => {
        if (!res.success) {
          warn(`[engine] spawn failed for ${c.key}/${c.runId}: ${res.message ?? "unknown"}`);
          finalizeChild(c, { status: "error", error: res.message ?? "spawn failed" });
          return;
        }
        // Capture the process handle so Stop can kill the child even before its
        // session registers. See change: fix-automation-stop-zombie-runs.
        if (res.spawnToken) c.spawnToken = res.spawnToken;
        // Spawn-window guard (decision 7a): a stop landed before the token
        // arrived — abort now with the freshly returned token + finalize stopped.
        if (c.stopRequested && !c.finalized) {
          if (deps.abortSpawnedRun) {
            void deps.abortSpawnedRun({
              ...(c.sessionId ? { sessionId: c.sessionId } : {}),
              ...(res.spawnToken ? { spawnToken: res.spawnToken } : {}),
            });
          }
          finalizeChild(c, {
            status: "stopped",
            result: "_(stopped by user)_",
            error: "stopped by user",
          });
        }
      })
      .catch((e) => {
        // A rejected spawn promise MUST still finalize the child + decrement the
        // parent, else the fire never completes. See change: add-automation-plugin (CR).
        warn(`[engine] spawn threw for ${c.key}/${c.runId}: ${e instanceof Error ? e.message : String(e)}`);
        finalizeChild(c, { status: "error", error: e instanceof Error ? e.message : String(e) });
      });

    log(`[engine] started child run ${childRec.runId} (${c.key}) model=${resolved.model || "(default)"}`);
    } catch (e) {
      // Synchronous setup failure (child-record write, dispatch build) AFTER the
      // item was leased. Release the lease + settle this child so the fire never
      // strands a leased-but-unspawned item or a parent counter. See change:
      // automation-work-source-fanout.
      warn(`[engine] child setup failed for ${parent.key}: ${e instanceof Error ? e.message : String(e)}`);
      const failed = ctx;
      const err = e instanceof Error ? e.message : String(e);
      // Defer the settle to a microtask: startRunFor runs INSIDE runner.begin
      // BEFORE it records the parent as active, so finalizing synchronously here
      // would call runner.completeRun on a not-yet-active key (a no-op) and then
      // begin would pin the finished parent as active forever. A microtask runs
      // after begin's active.set. See change: automation-work-source-fanout.
      queueMicrotask(() => {
        if (failed) {
          finalizeChild(failed, { status: "error", error: err });
          return;
        }
        if (extra?.lease) {
          try {
            extra.lease.source.nack(extra.lease.token);
          } catch {
            /* best-effort */
          }
        }
        parent.remaining -= 1;
        parent.statuses.push("error");
        if (parent.remaining <= 0) finalizeParent(parent);
      });
    }
  }

  /**
   * Resolve + lease + spawn for a `schedule.batch` work-source fan-out. Leases
   * up to `bound` items and spawns one child per leased handle. Empty vend →
   * completed no-op; `next` throw → errored, nothing leased. Excess items are
   * left unleased (deferred to a later fire) — no truncation warning.
   */
  function startWorkSourceFire(
    automation: DiscoveredAutomation,
    sourceId: string,
    env: {
      cfg: EngineConfig;
      scopeBase: string;
      runCwd: string;
      vis: Visibility;
      resolved: ReturnType<typeof resolveModel>;
      bound: number;
      firedAt?: number;
    },
  ): { runId: string } | null {
    const { cfg, scopeBase, runCwd, vis, resolved, bound } = env;

    const settleParent = (status: RunStatus): void => {
      const rec = storeStartParentRun(scopeBase, automation.name, {});
      storeFinishParentRun(scopeBase, rec.runId, { status, findings: 0, retention: cfg.retention });
    };

    const source = workSources.get(sourceId);
    if (!source) {
      // Defensive: schema isolates an unknown `on.source`, so a live source
      // should always resolve here. Settle errored + lease nothing.
      warn(`[engine] work source "${sourceId}" not registered for ${automation.name}`);
      settleParent("error");
      return null;
    }

    let handles: LeasedHandle[];
    try {
      handles = source.next(bound);
    } catch (e) {
      warn(
        `[engine] work source "${sourceId}" next() failed for ${automation.name}: ${e instanceof Error ? e.message : String(e)}`,
      );
      settleParent("error");
      return null;
    }

    if (handles.length === 0) {
      settleParent("done"); // completed no-op
      log(`[engine] work-source fire ${automation.name} vended 0 items (no-op)`);
      return null;
    }

    // The single `action:` (schema-guaranteed for schedule.batch) + its label.
    const base = resolveChildren(automation, 1).specs[0];
    if (!base) {
      settleParent("error");
      return null;
    }

    const parentRec = storeStartParentRun(scopeBase, automation.name, {});
    const parent: ParentState = {
      parentRunId: parentRec.runId,
      key: automationKey(automation),
      scopeBase,
      name: automation.name,
      remaining: handles.length,
      statuses: [],
      findings: 0,
      finalized: false,
    };
    parents.set(parent.parentRunId, parent);

    const firedAt = env.firedAt ?? (deps.now?.() ?? Date.now());
    for (const handle of handles) {
      // Per-child automation view carrying the single action; each child
      // resolves its OWN `${{trigger}}` from its leased item (per-child ctx).
      const childAutomation: DiscoveredAutomation = {
        ...automation,
        config: { ...automation.config!, action: base.action, actions: undefined },
      };
      const childCtx: FireContext = { firedAt, value: handle.item };
      spawnChild(parent, childAutomation, base.actionLabel, runCwd, resolved, vis, childCtx, {
        lease: { source, token: handle.leaseToken },
        idempotencyKey: handle.idempotencyKey,
      });
    }

    log(
      `[engine] started parent run ${parentRec.runId} (${parent.key}) work-source children=${handles.length}`,
    );
    return { runId: parentRec.runId };
  }

  function startRunFor(automation: DiscoveredAutomation, fireCtx?: FireContext): { runId: string } | null {
    if (!automation.valid || !automation.config) return null;
    const cfg = deps.config();
    const scopeBase = scopeBaseFor(automation);
    const runCwd = scopeBase; // phase-1: run in the scope base (local mode)
    const vis = effectiveVisibility(automation, cfg.defaultVisibility);

    // Resolve the model ONCE for the whole fire (decision 4.1).
    const resolved = resolveModel(automation.config.model, {
      defaultModel: cfg.defaultModel,
      ...(deps.readRoles ? { readRoles: deps.readRoles } : {}),
    });

    const bound = effectiveBound(
      automation,
      cfg.maxConcurrentSpawns ?? DEFAULT_MAX_CONCURRENT_SPAWNS,
    );

    // ── Work-source fan-out (`schedule.batch`) ────────────────────────────
    // The concurrency policy already admitted this fire (the runner drops a
    // skipped/queued fire BEFORE calling startRunFor), so leasing here can
    // never strand items for a non-proceeding fire. One child per leased item;
    // each child resolves its OWN `${{trigger}}` from its item.
    const workSourceId =
      automation.config.on.kind === "schedule.batch" && typeof automation.config.on.source === "string"
        ? automation.config.on.source
        : undefined;
    if (workSourceId) {
      return startWorkSourceFire(automation, workSourceId, {
        cfg,
        scopeBase,
        runCwd,
        vis,
        resolved,
        bound,
        firedAt: fireCtx?.firedAt,
      });
    }

    const { specs, truncated } = resolveChildren(automation, bound);
    if (specs.length === 0) return null; // defensive: schema forbids this
    const warning =
      truncated > 0
        ? `bounded to ${bound} concurrent spawn(s); ${truncated} child(ren) not spawned`
        : undefined;

    const parentRec = storeStartParentRun(scopeBase, automation.name, {
      ...(warning ? { warning } : {}),
    });
    const parent: ParentState = {
      parentRunId: parentRec.runId,
      key: automationKey(automation),
      scopeBase,
      name: automation.name,
      remaining: specs.length,
      statuses: [],
      findings: 0,
      ...(warning ? { warning } : {}),
      finalized: false,
    };
    parents.set(parent.parentRunId, parent);

    for (const spec of specs) {
      // Per-child automation view so `buildRunDispatch` reads THIS child's
      // action (decision 4.2).
      const childAutomation: DiscoveredAutomation = {
        ...automation,
        config: { ...automation.config, action: spec.action, actions: undefined },
      };
      spawnChild(parent, childAutomation, spec.actionLabel, runCwd, resolved, vis, fireCtx);
    }

    log(`[engine] started parent run ${parentRec.runId} (${parent.key}) children=${specs.length}`);
    return { runId: parentRec.runId };
  }

  return {
    scheduler,
    runner,
    registry,
    workSources,
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
            workSources.ids(),
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
      // Persist the child's sessionId on disk for the monitor link (decision 4c).
      storeSetSessionId(ctx.scopeBase, ctx.runId, sessionId);
      log(`[engine] delivering action to run ${ctx.runId} (session ${sessionId})`);
    },

    onSessionRegisteredForRun(sessionId: string, runId: string): void {
      const ctx = firstUndeliveredForRunId(runId);
      if (!ctx) return;
      ctx.sessionId = sessionId;
      ctx.delivered = true;
      // Persist the child's sessionId on disk for the monitor link (decision 4c).
      storeSetSessionId(ctx.scopeBase, ctx.runId, sessionId);
      log(`[engine] delivering action to run ${ctx.runId} (session ${sessionId})`);
    },

    async stopRun(runId: string): Promise<boolean> {
      // Parent stop: cascade to every live child (decision 7). The child
      // counter finalizes the parent once the last child terminates.
      const parent = parents.get(runId);
      if (parent) {
        const children = [...pending.values()]
          .flat()
          .filter((c) => c.parentRunId === runId && !c.finalized);
        if (children.length === 0) return false;
        await Promise.all(children.map((c) => stopChild(c)));
        log(`[engine] parent run ${runId} stop cascaded to ${children.length} child(ren)`);
        return true;
      }
      // Child (or legacy flat) stop: terminate only that run. A run already
      // finalized was removed from `pending`, so this is a no-op — idempotent.
      const ctx = findByRunId(runId);
      if (!ctx || ctx.finalized) return false;
      await stopChild(ctx);
      log(`[engine] run ${ctx.runId} stopped (${ctx.key})`);
      return true;
    },

    onSessionEnded(sessionId: string, result: string): void {
      const found = findBySession(sessionId);
      if (!found || found.finalized) return;
      const spawnToken = found.spawnToken;
      finalizeChild(found, {
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
      if (!found || found.finalized) return; // unknown or already finalized — no-op
      const spawnToken = found.spawnToken;
      const buffered = (result ?? "").trim();
      if (buffered.length > 0) {
        finalizeChild(found, {
          status: found.modelError ? "error" : "done",
          result: buffered,
          ...(found.modelError ? { error: found.modelError } : {}),
        });
      } else {
        finalizeChild(found, {
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
      parents.clear();
    },
  };
}
