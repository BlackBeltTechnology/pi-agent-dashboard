/**
 * The `schedule` trigger type (phase-1 core kind).
 *
 * Parses `on: { kind: schedule, cron: "<expr>" }` and arms a self-rescheduling
 * timer that fires `fire()` exactly once per cron occurrence. Restart catch-up
 * is SKIP: arming always computes the next fire strictly after `now`, so a
 * fire missed while the server was down is never backfilled.
 *
 * See change: add-automation-plugin.
 */
import { nextFire, isValidCron } from "./cron.js";
import type { TriggerType, Disposable, ArmDeps, FireContext } from "./trigger-registry.js";

export interface ScheduleConfig {
  cron: string;
}

export const scheduleTrigger: TriggerType<ScheduleConfig> = {
  kind: "schedule",

  parse(rawOn: unknown): ScheduleConfig {
    const on = rawOn as Record<string, unknown> | null;
    const cron = on?.cron;
    if (typeof cron !== "string" || !isValidCron(cron)) {
      throw new Error(`schedule trigger requires a valid 5-field \`cron\` (got: ${JSON.stringify(cron)})`);
    }
    return { cron };
  },

  arm(cfg: ScheduleConfig, fire: (ctx: FireContext) => void, deps: ArmDeps): Disposable {
    let timer: { clear: () => void } | null = null;
    let disposed = false;

    const schedule = (): void => {
      if (disposed) return;
      const now = new Date(deps.now());
      const next = nextFire(cfg.cron, now);
      if (!next) return; // invalid (shouldn't happen post-parse) — stay dormant
      const delay = Math.max(0, next.getTime() - deps.now());
      timer = deps.setTimer(() => {
        if (disposed) return;
        fire({ firedAt: next.getTime() });
        schedule(); // re-arm for the following occurrence
      }, delay);
    };

    schedule();

    return {
      dispose(): void {
        disposed = true;
        timer?.clear();
        timer = null;
      },
    };
  },
};
