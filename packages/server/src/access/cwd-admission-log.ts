/**
 * Rate-limited sink for `indeterminate` plugin cwd admissions.
 *
 * Today a probe timeout is invisible (it surfaces as a bare 403). Each
 * `indeterminate` decision is worth one warn line, but a burst of 25 sidebar
 * pills would flood the log, so at most one line is emitted per canonical cwd
 * per `CWD_ADMISSION_LOG_INTERVAL_MS`. The throttle map is LRU-bounded so a
 * stream of distinct attacker-chosen cwds cannot grow it without limit.
 *
 * See change: harden-plugin-cwd-admission (D7).
 */
import type { IndeterminateInfo } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";

export const CWD_ADMISSION_LOG_INTERVAL_MS = 60_000;
export const CWD_ADMISSION_LOG_MAX_ENTRIES = 512;

export interface IndeterminateLogger {
  (info: IndeterminateInfo): void;
  /** Current throttle-map size (tests). */
  readonly size: number;
}

export function createIndeterminateLogger(
  logger: { warn(message: string): void },
  now: () => number = Date.now,
): IndeterminateLogger {
  // Map iteration order = insertion order, so delete+set keeps it LRU.
  const lastLogged = new Map<string, number>();
  const log = (info: IndeterminateInfo): void => {
    const t = now();
    const prev = lastLogged.get(info.cwd);
    if (prev !== undefined && t - prev < CWD_ADMISSION_LOG_INTERVAL_MS) return;
    lastLogged.delete(info.cwd);
    lastLogged.set(info.cwd, t);
    while (lastLogged.size > CWD_ADMISSION_LOG_MAX_ENTRIES) {
      const oldest = lastLogged.keys().next().value;
      if (oldest === undefined) break;
      lastLogged.delete(oldest);
    }
    logger.warn(
      `[cwd-admission] indeterminate cwd=${JSON.stringify(info.cwd)} failedProbes=${JSON.stringify(info.failedProbes)} elapsedMs=${info.elapsedMs}`,
    );
  };
  Object.defineProperty(log, "size", { get: () => lastLogged.size });
  return log as IndeterminateLogger;
}
