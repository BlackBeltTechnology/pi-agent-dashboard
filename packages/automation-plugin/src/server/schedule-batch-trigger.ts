/**
 * The `schedule.batch` trigger — a cron timer whose fire fans out one child
 * per leased work item.
 *
 * Arming is identical to `schedule` (a self-rescheduling timer, restart
 * catch-up SKIP). The trigger itself vends nothing: on each occurrence it
 * fires a bare `FireContext`, and the engine leases up to the effective bound
 * of items from the `on.source` work-source and spawns one child per handle.
 * The parsed config carries `source` so an unknown/invalid id is caught here
 * (isolating the automation) as well as by the schema.
 *
 * See change: automation-work-source-fanout.
 */
import { isValidCron, nextFire } from "./cron.js";
import type { ArmDeps, Disposable, FireContext, TriggerType } from "./trigger-registry.js";

export interface ScheduleBatchConfig {
  cron: string;
  source: string;
}

export const scheduleBatchTrigger: TriggerType<ScheduleBatchConfig> = {
  kind: "schedule.batch",

  parse(rawOn: unknown): ScheduleBatchConfig {
    const on = rawOn as Record<string, unknown> | null;
    const cron = on?.cron;
    if (typeof cron !== "string" || !isValidCron(cron)) {
      throw new Error(
        `schedule.batch trigger requires a valid 5-field \`cron\` (got: ${JSON.stringify(cron)})`,
      );
    }
    const source = on?.source;
    if (typeof source !== "string" || source.length === 0) {
      throw new Error("schedule.batch trigger requires a non-empty `on.source`");
    }
    return { cron, source };
  },

  arm(cfg: ScheduleBatchConfig, fire: (ctx: FireContext) => void, deps: ArmDeps): Disposable {
    let timer: { clear: () => void } | null = null;
    let disposed = false;

    const schedule = (): void => {
      if (disposed) return;
      const next = nextFire(cfg.cron, new Date(deps.now()));
      if (!next) return;
      const delay = Math.max(0, next.getTime() - deps.now());
      timer = deps.setTimer(() => {
        if (disposed) return;
        fire({ firedAt: next.getTime() });
        schedule();
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
