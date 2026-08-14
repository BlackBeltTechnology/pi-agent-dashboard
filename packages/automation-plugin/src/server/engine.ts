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
  // Central per-fire substitution: resolve `${{trigger}}` (and per-invoice
  // `${invoice_id}` from `ctx.vars`) in the whole payload ONCE, so no action
  // needs its own interpolation logic.
  const payload = interpolate(action.payload ?? {}, ctx?.value, ctx?.vars) as Record<string, unknown>;
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

/**
 * Resolve the action `env` map for a per-invoice fire into a string→string map
 * scoped to the bound invoice. Returns undefined for a non-per-invoice fire, an
 * absent/non-object `env`, or an empty result. Uses the same trigger+vars
 * substitution as the payload, so `${invoice_id}` resolves to the bound id.
 * See change: wire-per-invoice-automation-drain.
 */
export function resolveScopedEnv(
  automation: DiscoveredAutomation,
  fireCtx?: FireContext,
): Record<string, string> | undefined {
  if (!fireCtx?.invoiceId) return undefined;
  const rawEnv = (automation.config?.action?.payload as Record<string, unknown> | undefined)?.env;
  if (!rawEnv || typeof rawEnv !== "object" || Array.isArray(rawEnv)) return undefined;
  const resolved = interpolate(rawEnv, fireCtx.value, fireCtx.vars) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(resolved)) {
    if (typeof v === "string") out[k] = v;
    else if (v !== undefined && v !== null) out[k] = String(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
    /**
     * Caller-supplied env forwarded into the spawned run session. A per-invoice
     * run passes its resolved action `env` (e.g. `IB_TOOLSET`/`IB_INVOICE_ID`)
     * to scope the session to one invoice. Absent ⇒ unchanged. See change:
     * wire-per-invoice-automation-drain.
     */
    env?: Record<string, string>;
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
   * Max age (ms) a `running` run may stay UNDELIVERED (no session ever bound,
   * so its action was never dispatched) before it is finalized `error` and its
   * concurrency slot freed. Far shorter than `maxRunAgeMs`: such a run has no
   * session it will ever hear from, so waiting the full backstop only starves
   * the schedule. <= 0 disables. See change: fix-automation-stamp-correlation.
   */
  undeliveredRunTimeoutMs?: number;
  /**
   * Max quiet time (ms) a DELIVERED event-dispatched run (its action declared
   * an `ActionEvent.completion`) may go without any observed session activity
   * before it is finalized `error` and its concurrency slot freed. Such a run
   * emits no `agent_end` and its session is only terminated by the completion
   * event, so a dropped completion frame otherwise wedges it `running` until
   * `maxRunAgeMs`. Silence IS the stall signal: a live flow run keeps
   * forwarding events. Prompt-dispatch runs are never subject to this bound —
   * a long think is legitimate. <= 0 disables.
   * See change: bound-stalled-event-run-settle.
   */
  stalledRunTimeoutMs?: number;
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
   * Enumerate the invoice ids currently queued for a workspace `cwd`. Injected
   * (cross-plugin service seam) so the generic engine carries no invoice
   * knowledge. Drives `scope: per-invoice` action fan-out: each fired automation
   * with that scope fans out to one run per returned id. Returns `null`/absent
   * when no enumerator is wired (fan-out fire is then skipped rather than run
   * with an unresolved token). See change: wire-per-invoice-automation-drain.
   */
  enumerateQueued?: (cwd: string) => Promise<string[] | null>;
  /**
   * Per-invoice run name: for a fire bound to a single invoice, surface the
   * spawned run's `automationRun.name` under a consumer-provided identity so a
   * consumer's own session resolution can recognise (and adopt) the producer.
   * Injected (cross-plugin service seam) so this generic plugin carries no
   * consumer-specific naming. Absent / undefined return ⇒ the automation's own
   * name is used. See change: adopt-scoped-producer-session.
   */
  perInvoiceRunName?: (invoiceId: string) => string | undefined;
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
  /** Wall-clock start, used by the undelivered-run bound. */
  startedAt: number;
  /**
   * Spawn correlation token captured from the `spawnSession` result. Gives
   * Stop a process handle BEFORE any sessionId is bound (the fix for the
   * spawn→register zombie window). See change: fix-automation-stop-zombie-runs.
   */
  spawnToken?: string;
  delivered: boolean;
  /**
   * Last observed session activity for this run (set at delivery, refreshed by
   * `noteRunActivity`). Drives the stalled-event-run bound.
   * See change: bound-stalled-event-run-settle.
   */
  lastActivityAt?: number;
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
   * Fan-out-aware fire entrypoint (the scheduler's `onFire`). A `scope:
   * per-invoice` action fans out to one run per queued invoice through the
   * runner's concurrency policy; every other action fires once. Exposed for
   * tests. See change: wire-per-invoice-automation-drain.
   */
  fire(automation: DiscoveredAutomation, ctx?: FireContext): Promise<void>;
  /**
   * Fan-out-aware manual run-now. A `scope: per-invoice` action force-starts one
   * run per queued invoice (each bound to its invoice id + scoped env); every
   * other action starts exactly one run. Returns the first started run's id.
   * Empty queue → `{ ok: true }` (no id); missing/failed enumerator →
   * `{ ok: false }`. See change: run-now-fans-out-per-invoice.
   */
  runNow(automation: DiscoveredAutomation): Promise<{ ok: boolean; runId?: string; error?: string }>;
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
  /**
   * Record observed activity for a tracked run session, resetting its stall
   * clock. Called for every forwarded event of a tracked run session, so a
   * genuinely live event-dispatched run is never reaped by the stall bound.
   * Unknown sessions are a no-op. See change: bound-stalled-event-run-settle.
   */
  noteRunActivity(sessionId: string): void;
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
  /** Best-effort terminate a reaped run's spawned process. A reaped
   *  `--mode rpc` session never self-exits, so without this it outlives its
   *  run. Fire-and-forget; finalization already happened.
   *  See change: fix-automation-stamp-correlation. */
  function terminate(ctx: RunContext): void {
    if (!deps.abortSpawnedRun) return;
    void deps.abortSpawnedRun({
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      ...(ctx.spawnToken ? { spawnToken: ctx.spawnToken } : {}),
    });
  }

  /**
   * Sweep runs that never reached delivery. Such a run's stamped session never
   * registered (or registered carrying someone else's stamp), so no completion
   * event, `agent_end`, or session-death signal will ever name it — only the
   * 30-minute backstop would, holding a `concurrency: skip` slot the whole time.
   * See change: fix-automation-stamp-correlation.
   */
  function reapUndeliveredRuns(): void {
    const timeoutMs = deps.config().undeliveredRunTimeoutMs ?? 0;
    if (timeoutMs <= 0) return;
    const now = deps.now?.() ?? Date.now();
    for (const q of [...pending.values()]) {
      for (const ctx of [...q]) {
        if (ctx.delivered) continue;
        if (now - ctx.startedAt <= timeoutMs) continue;
        warn(`[finalize] path=undelivered-reap run ${ctx.runId} (undelivered > ${timeoutMs}ms)`);
        finishAndRelease(ctx, {
          status: "error",
          error: "run action never delivered",
          result: "_(run action never delivered)_",
        });
        terminate(ctx);
      }
    }
  }

  /**
   * Sweep DELIVERED event-dispatched runs that went silent. Such a run
   * declared a completion event, produces no `agent_end`, and its session is
   * only terminated on that completion — so a dropped completion frame leaves
   * it `running` (and its `concurrency: skip` slot held) until the 30-minute
   * max-age backstop. A live run keeps forwarding events, so quiet past the
   * bound is the stall signal. See change: bound-stalled-event-run-settle.
   */
  function reapStalledEventRuns(): void {
    const timeoutMs = deps.config().stalledRunTimeoutMs ?? 0;
    if (timeoutMs <= 0) return;
    const now = deps.now?.() ?? Date.now();
    for (const q of [...pending.values()]) {
      for (const ctx of [...q]) {
        if (!ctx.delivered) continue; // the undelivered bound owns these
        if (!ctx.emitEvent?.completion) continue; // prompt runs may think long
        if (now - (ctx.lastActivityAt ?? ctx.startedAt) <= timeoutMs) continue;
        warn(`[finalize] path=stalled-reap run ${ctx.runId} (quiet > ${timeoutMs}ms)`);
        finishAndRelease(ctx, {
          status: "error",
          error: "run stalled: completion event never observed",
          result: "_(run stalled: completion event never observed)_",
        });
        terminate(ctx);
      }
    }
  }

  function reapStaleRuns(): void {
    reapUndeliveredRuns();
    reapStalledEventRuns();
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
          // Live wedged run — finalize, free the concurrency slot, kill the
          // session (it never self-exits).
          finishAndRelease(ctx, {
            status: "error",
            error: "run exceeded max age",
            result: "_(run exceeded max age)_",
          });
          terminate(ctx);
        } else {
          // Pre-existing on-disk orphan (no live lock held) — clear the record.
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

  /** True when the automation's action requests per-invoice fan-out. */
  function isPerInvoice(automation: DiscoveredAutomation): boolean {
    return (automation.config?.action?.payload as Record<string, unknown> | undefined)?.scope === "per-invoice";
  }

  /**
   * Shared per-invoice fan-out core used by BOTH entry points (the scheduler's
   * `dispatchFire` and the manual `runNow`), so the enumerate→resolve step has a
   * single implementation and the two paths never drift.
   *
   * Returns a per-invoice `FireContext` list (one per queued invoice — each
   * carrying that invoice's id as the `invoice_id` var + `invoiceId`, so the
   * payload resolves per invoice and the spawn is scoped by env), or a `skip`
   * verdict when fan-out is impossible: no enumerator wired, or enumeration
   * threw. An empty queue is `skip: false` with an empty `contexts` list.
   * See change: wire-per-invoice-automation-drain, run-now-fans-out-per-invoice.
   */
  async function perInvoiceFanout(
    automation: DiscoveredAutomation,
    baseCtx?: FireContext,
  ): Promise<{ skip: true; reason: string } | { skip: false; contexts: FireContext[] }> {
    const key = automationKey(automation);
    const enumerate = deps.enumerateQueued;
    if (!enumerate) return { skip: true, reason: `per-invoice fan-out for ${key}: no queued-invoice enumerator wired` };
    const cwd = scopeBaseFor(automation);
    let ids: string[] | null;
    try {
      ids = await enumerate(cwd);
    } catch (e) {
      return { skip: true, reason: `per-invoice enumerate failed for ${key}: ${e instanceof Error ? e.message : String(e)}` };
    }
    const contexts = (ids ?? []).map<FireContext>((id) => ({
      firedAt: baseCtx?.firedAt ?? deps.now?.() ?? Date.now(),
      ...(baseCtx?.value !== undefined ? { value: baseCtx.value } : {}),
      vars: { ...(baseCtx?.vars ?? {}), invoice_id: id },
      invoiceId: id,
    }));
    return { skip: false, contexts };
  }

  /**
   * Fan-out-aware SCHEDULER fire. An action declaring `scope: per-invoice` fans
   * out to one run per queued invoice; an empty queue fires nothing; a missing
   * enumerator skips the fire (never a single literal-`${invoice_id}` run). Every
   * fan-out fire flows through `runner.fire`, so the automation's `concurrency`
   * policy is honoured unchanged (`queue` drains the invoices serially under one
   * key). A non-per-invoice action fires exactly once, as before.
   * See change: wire-per-invoice-automation-drain.
   */
  async function dispatchFire(automation: DiscoveredAutomation, ctx?: FireContext): Promise<void> {
    if (!isPerInvoice(automation)) {
      runner.fire(automation, ctx);
      return;
    }
    const key = automationKey(automation);
    const res = await perInvoiceFanout(automation, ctx);
    if (res.skip) {
      warn(`[engine] ${res.reason}; skipping fire`);
      return;
    }
    if (res.contexts.length === 0) {
      log(`[engine] per-invoice fan-out for ${key}: no queued invoices; no fire`);
      return;
    }
    log(`[engine] per-invoice fan-out for ${key}: ${res.contexts.length} queued invoice(s)`);
    for (const fireCtx of res.contexts) runner.fire(automation, fireCtx);
  }

  /**
   * Fan-out-aware MANUAL run-now. Mirrors `dispatchFire`'s per-invoice fan-out but
   * FORCE-STARTS each run directly via `startRunFor` (Run-now deliberately
   * ignores the concurrency gate that gates scheduled fires). A non-per-invoice
   * automation starts exactly one run, unchanged.
   *
   * Because run-now is an explicit operator action it ALWAYS issues a settling
   * run id: on an EMPTY queue it starts ONE idle run (no invoice bound) that
   * settles on the empty pick, rather than the silent no-op the SCHEDULER path
   * (`dispatchFire`) does. Two consecutive empty run-nows each mint a distinct
   * run id (the run store issues a fresh id per `startRunFor`). A missing/failed
   * enumerator is genuinely unavailable → failure (not "empty"). Returns the
   * started run's id (the first, when it fans out) so the route contract holds.
   * See change: run-now-fans-out-per-invoice, settle-idle-run-now-and-add-run-now-control.
   */
  async function runNow(
    automation: DiscoveredAutomation,
  ): Promise<{ ok: boolean; runId?: string; error?: string }> {
    if (!isPerInvoice(automation)) {
      const r = startRunFor(automation);
      return r ? { ok: true, runId: r.runId } : { ok: false, error: "run not started" };
    }
    const key = automationKey(automation);
    const res = await perInvoiceFanout(automation);
    if (res.skip) {
      warn(`[engine] run-now ${res.reason}; skipping`);
      return { ok: false, error: `per-invoice run-now unavailable: ${res.reason}` };
    }
    if (res.contexts.length === 0) {
      // Manual run-now on an empty pick: issue ONE idle settling run so the
      // operator's click always yields a run id. The scheduler still skips.
      log(`[engine] run-now per-invoice fan-out for ${key}: empty queue; starting one idle settling run`);
      const r = startRunFor(automation);
      return r ? { ok: true, runId: r.runId } : { ok: false, error: "run not started" };
    }
    log(`[engine] run-now per-invoice fan-out for ${key}: ${res.contexts.length} queued invoice(s)`);
    let first: string | undefined;
    for (const fireCtx of res.contexts) {
      const r = startRunFor(automation, fireCtx);
      if (r && !first) first = r.runId;
    }
    return first ? { ok: true, runId: first } : { ok: false, error: "run not started" };
  }

  const scheduler = createScheduler({
    registry,
    onFire: (automation, ctx) => {
      void dispatchFire(automation, ctx);
    },
    now: deps.now,
    log,
    warn,
  });

  // Stale-run reaper backstop timer. Sweeps on an interval; also callable
  // directly (reapStaleRuns) for tests. See change:
  // finalize-automation-run-on-session-death.
  // Sweep cadence. 15 s (was 60 s) so the much tighter undelivered bound is a
  // real bound and not rounded up by the timer.
  // See change: fix-automation-stamp-correlation.
  const REAP_INTERVAL_MS = 15_000;
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
    // Per-invoice run: resolve the action `env` map (with the same trigger+vars
    // substitution) and forward it to the spawn so the session is scoped to this
    // one invoice (IB_TOOLSET/IB_INVOICE_ID). See change:
    // wire-per-invoice-automation-drain.
    const spawnEnv = resolveScopedEnv(automation, fireCtx);
    // A fire bound to a single invoice surfaces its run under the injected
    // per-invoice name (the consumer's scoped-session identity) so the consumer
    // adopts THIS producer as the invoice's canonical session instead of
    // spawning a fresh one. Folder/global fires keep the automation's own name.
    // See change: adopt-scoped-producer-session.
    const runName =
      (fireCtx?.invoiceId ? deps.perInvoiceRunName?.(fireCtx.invoiceId) : undefined) ?? automation.name;

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
      startedAt: deps.now?.() ?? Date.now(),
      delivered: false,
    };
    enqueuePending(ctx);

    void deps
      .spawnSession({
        cwd: runCwd,
        ...(resolved.model ? { model: resolved.model } : {}),
        mode: automation.config.mode,
        sandbox: automation.config.sandbox,
        automationRun: { name: runName, runId: rec.runId, visibility: vis },
        ...(spawnEnv ? { env: spawnEnv } : {}),
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
    fire: dispatchFire,
    runNow,

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
      ctx.lastActivityAt = deps.now?.() ?? Date.now();
      log(`[engine] delivering action to run ${ctx.runId} (session ${sessionId})`);
    },

    onSessionRegisteredForRun(sessionId: string, runId: string): void {
      const ctx = firstUndeliveredForRunId(runId);
      if (!ctx) return;
      ctx.sessionId = sessionId;
      ctx.delivered = true;
      ctx.lastActivityAt = deps.now?.() ?? Date.now();
      log(`[engine] delivering action to run ${ctx.runId} (session ${sessionId})`);
    },

    noteRunActivity(sessionId: string): void {
      const ctx = findBySession(sessionId);
      if (!ctx) return;
      ctx.lastActivityAt = deps.now?.() ?? Date.now();
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
