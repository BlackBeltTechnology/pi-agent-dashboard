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
  const setTimer =
    deps.setTimer ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      if (typeof t.unref === "function") t.unref();
      return { clear: () => clearTimeout(t) };
    });
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
