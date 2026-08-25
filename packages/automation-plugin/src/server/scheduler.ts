/**
 * Central scheduler — single server-owned arming layer.
 *
 * Arms every VALID automation's trigger (via the trigger registry). On
 * config change (create/edit/delete detected by the fs.watch layer) the
 * scheduler disposes the affected armed trigger and re-arms from the new
 * definition. Restart catch-up is SKIP: arming recomputes next-fire forward
 * (implemented in each trigger's `arm`), so missed occurrences never
 * backfill.
 *
 * The scheduler is trigger-agnostic; it delegates the actual "what happens
 * when it fires" to an injected `onFire(automation, ctx)` handler (the run
 * lifecycle in §5).
 *
 * See change: add-automation-plugin.
 */
import type { DiscoveredAutomation } from "../shared/automation-types.js";
import type { TriggerRegistry, Disposable, ArmDeps, FireContext } from "./trigger-registry.js";

export type OnFire = (automation: DiscoveredAutomation, ctx: FireContext) => void;

/** Node's `setTimeout` delay is a 32-bit signed int; delays above this overflow. */
export const MAX_DELAY = 2_147_483_647; // 2^31 − 1 ms ≈ 24.855 days

type RawTimer = (fn: () => void, ms: number) => { clear: () => void };

/**
 * Arm a timer that honors delays beyond the 32-bit `setTimeout` ceiling.
 *
 * A wait longer than {@link MAX_DELAY} is split into bounded hops: each hop
 * sleeps at most `MAX_DELAY`, then on wake recomputes the remaining wait
 * against the ABSOLUTE target instant (`target − now()`), not by naive
 * subtraction — keeping the timer self-correcting across long hops, GC pauses,
 * and OS suspend/resume while the process stays alive. When the recomputed
 * remaining is `≤ 0` (a hop woke at/after the target), it fires once,
 * immediately. `clear()` cancels whichever hop is currently pending.
 *
 * See change: fix-schedule-timer-overflow.
 */
export function setLongTimer(raw: RawTimer, now: () => number, fn: () => void, ms: number): { clear: () => void } {
  const target = now() + ms;
  let handle: { clear: () => void } | null = null;
  const arm = (): void => {
    const remaining = target - now();
    handle = remaining > MAX_DELAY ? raw(arm, MAX_DELAY) : raw(fn, Math.max(0, remaining));
  };
  arm();
  return { clear: () => handle?.clear() };
}

export interface SchedulerDeps extends Partial<ArmDeps> {
  registry: TriggerRegistry;
  onFire: OnFire;
  /** Logger sink (defaults to console). */
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
}

/** Unique armed-key for an automation (scope + name distinguishes collisions). */
export function automationKey(a: DiscoveredAutomation): string {
  return `${a.scope}:${a.name}`;
}

export interface Scheduler {
  /** Replace the full armed set from a fresh scan (dispose-all, re-arm valid). */
  armAll(automations: DiscoveredAutomation[]): void;
  /** Dispose+re-arm a single automation (or dispose if now absent/invalid). */
  rearmOne(key: string, automation: DiscoveredAutomation | null): void;
  /** Armed automation keys currently active. */
  armedKeys(): string[];
  /** Dispose every armed trigger. */
  disposeAll(): void;
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const now = deps.now ?? (() => Date.now());
  // Raw one-hop primitive (injected fake in tests, real setTimeout otherwise).
  const rawSetTimer: RawTimer =
    deps.setTimer ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      if (typeof t.unref === "function") t.unref();
      return { clear: () => clearTimeout(t) };
    });
  // Every trigger arms through the shared chunk-safe seam, so any current or
  // future trigger kind inherits 32-bit-overflow safety.
  // See change: fix-schedule-timer-overflow.
  const setTimer: RawTimer = (fn, ms) => setLongTimer(rawSetTimer, now, fn, ms);
  const armDeps: ArmDeps = { now, setTimer };
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const log = deps.log ?? (() => {});

  // key → { disposable, automation }
  const armed = new Map<string, { disposable: Disposable }>();

  function disposeKey(key: string): void {
    const entry = armed.get(key);
    if (entry) {
      try {
        entry.disposable.dispose();
      } catch {
        /* ignore */
      }
      armed.delete(key);
    }
  }

  function armOne(automation: DiscoveredAutomation): void {
    if (!automation.valid || !automation.config) return; // isolate invalid
    if (automation.config.disabled) {
      log(`[scheduler] skipping disabled ${automationKey(automation)}`);
      return; // valid but disabled — dormant until re-enabled
    }
    const kind = automation.config.on.kind;
    const type = deps.registry.get(kind);
    if (!type) {
      warn(`[scheduler] no trigger type for kind="${kind}" (${automationKey(automation)})`);
      return;
    }
    let cfg: unknown;
    try {
      cfg = type.parse(automation.config.on);
    } catch (e) {
      warn(`[scheduler] parse failed for ${automationKey(automation)}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const disposable = type.arm(
      cfg,
      (ctx: FireContext) => {
        try {
          deps.onFire(automation, ctx);
        } catch (e) {
          warn(`[scheduler] onFire threw for ${automationKey(automation)}: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
      armDeps,
    );
    armed.set(automationKey(automation), { disposable });
    log(`[scheduler] armed ${automationKey(automation)} (kind=${kind})`);
  }

  return {
    armAll(automations: DiscoveredAutomation[]): void {
      for (const key of [...armed.keys()]) disposeKey(key);
      for (const a of automations) armOne(a);
    },

    rearmOne(key: string, automation: DiscoveredAutomation | null): void {
      disposeKey(key);
      if (automation) armOne(automation);
    },

    armedKeys(): string[] {
      return [...armed.keys()];
    },

    disposeAll(): void {
      for (const key of [...armed.keys()]) disposeKey(key);
    },
  };
}
