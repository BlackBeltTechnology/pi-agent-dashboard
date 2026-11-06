/**
 * Human-readable labels for the Automations board (design D7, D9). Pure; every
 * time-relative helper takes `now` (and an optional `locale`, default = the
 * browser's) so tests are deterministic.
 *
 *  - `humanizeCron`  — common cron shapes → "Daily at 09:20"; `null` = show raw cron.
 *  - `runStartLabel` — "Today <t>" / "Yesterday <t>" / short date + <t> (no weekday).
 *  - `relativeFire`  — "today <t>" / "tomorrow <t>" / short date + <t>.
 *  - `runDuration`   — "Ns" / "Nm SSs" / "Hh MMm" (+ " so far" while running).
 *  - `sessionHref`   — live `/session/:id` only for a running tracked run, else
 *                      the archived view, which renders live, restored or archived.
 *
 * See change: polish-automation-board.
 */
import type { RunRecord } from "../shared/automation-types.js";

const pad = (n: number) => String(n).padStart(2, "0");
const INT = /^\d+$/;
const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function inRange(v: string, lo: number, hi: number): number | null {
  if (!INT.test(v)) return null;
  const n = Number(v);
  return n >= lo && n <= hi ? n : null;
}

/** Cron → human text for the common shapes; `null` when it has no rendering. */
export function humanizeCron(expr: string): string | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [mi, ho, dom, mon, dow] = f as [string, string, string, string, string];
  if (mon !== "*") return null;
  const every = /^\*\/(\d+)$/.exec(mi);
  if (every && ho === "*" && dom === "*" && dow === "*") {
    const n = Number(every[1]);
    if (n < 1 || n > 59) return null;
    return n === 1 ? "Every minute" : `Every ${n} minutes`;
  }
  if (mi === "*" && ho === "*" && dom === "*" && dow === "*") return "Every minute";
  const m = inRange(mi, 0, 59);
  if (m === null) return null;
  if (ho === "*") return dom === "*" && dow === "*" ? `Hourly at :${pad(m)}` : null;
  const h = inRange(ho, 0, 23);
  if (h === null) return null;
  const t = `${pad(h)}:${pad(m)}`;
  if (dom === "*" && dow === "*") return `Daily at ${t}`;
  if (dom === "*" && dow === "1-5") return `Weekdays at ${t}`;
  if (dom === "*") {
    const d = inRange(dow, 0, 7);
    return d === null ? null : `${WEEKDAYS[d % 7]} at ${t}`;
  }
  if (dow === "*") {
    const d = inRange(dom, 1, 31);
    return d === null ? null : `Monthly on day ${d} at ${t}`;
  }
  return null;
}

/** Locale hour:minute. `2-digit` hours so 24h locales read "09:20" (test-plan locale rule). */
function timeOf(d: Date, locale?: string): string {
  return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}
function shortDate(d: Date, locale?: string): string {
  return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}
/** Whole local calendar days from `now`'s day to `d`'s day (negative = past). */
function dayDelta(d: Date, now: Date): number {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}

/** Run row label: "Today 09:20", "Yesterday 23:59", else "4 Nov 09:20". */
export function runStartLabel(startedAt: number, now: Date, locale?: string): string {
  const d = new Date(startedAt);
  const t = timeOf(d, locale);
  const delta = dayDelta(d, now);
  if (delta === 0) return `Today ${t}`;
  if (delta === -1) return `Yesterday ${t}`;
  return `${shortDate(d, locale)} ${t}`;
}

/** Next-fire label: "today 16:30", "tomorrow 09:20", else "9 Nov 09:20". */
export function relativeFire(next: Date, now: Date, locale?: string): string {
  const t = timeOf(next, locale);
  const delta = dayDelta(next, now);
  if (delta === 0) return `today ${t}`;
  if (delta === 1) return `tomorrow ${t}`;
  return `${shortDate(next, locale)} ${t}`;
}

/** Duration from start to end (or to `now` + " so far" while `endedAt` is unset). */
export function runDuration(startedAt: number, endedAt: number | undefined, now: number): string {
  const secs = Math.max(0, Math.floor(((endedAt ?? now) - startedAt) / 1000));
  let text: string;
  if (secs < 60) text = `${secs}s`;
  else if (secs < 3600) text = `${Math.floor(secs / 60)}m ${pad(secs % 60)}s`;
  else text = `${Math.floor(secs / 3600)}h ${pad(Math.floor((secs % 3600) / 60))}m`;
  return endedAt === undefined ? `${text} so far` : text;
}

/** Open-session link target, or `null` when the run has no session. */
export function sessionHref(run: Pick<RunRecord, "sessionId" | "status" | "tracked">): string | null {
  if (!run.sessionId) return null;
  const base = `/session/${encodeURIComponent(run.sessionId)}`;
  return run.status === "running" && run.tracked === true ? base : `${base}?archived=1`;
}
