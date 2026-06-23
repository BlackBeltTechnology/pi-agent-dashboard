/**
 * Minimal standard 5-field cron evaluator (no external dependency).
 *
 * Fields: `minute hour day-of-month month day-of-week`
 *   minute       0-59
 *   hour         0-23
 *   day-of-month 1-31
 *   month        1-12
 *   day-of-week  0-6 (0 = Sunday; 7 also accepted as Sunday)
 *
 * Each field supports `*`, lists (`a,b`), ranges (`a-b`), and steps
 * (`*​/n`, `a-b/n`). Day-of-month and day-of-week use standard cron OR
 * semantics ONLY when both are restricted; if either is `*`, the other
 * applies directly.
 *
 * Evaluation is in LOCAL time. `nextFire(expr, after)` returns the first
 * matching minute strictly after `after` (seconds/ms ignored), or null if
 * the expression is invalid.
 *
 * See change: add-automation-plugin, redesign-automation-editor-and-board (moved to shared for client+server reuse).
 */

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

function parseField(raw: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    let range = part;
    let step = 1;
    const slash = part.split("/");
    if (slash.length === 2) {
      range = slash[0]!;
      step = Number(slash[1]);
      if (!Number.isInteger(step) || step <= 0) return null;
    } else if (slash.length > 2) {
      return null;
    }
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = min;
      hi = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = hi = Number(range);
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size > 0 ? out : null;
}

export function parseCron(expr: string): CronFields | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = parseField(parts[0]!, 0, 59);
  const hour = parseField(parts[1]!, 0, 23);
  const dom = parseField(parts[2]!, 1, 31);
  const month = parseField(parts[3]!, 1, 12);
  let dow = parseField(parts[4]!, 0, 7);
  if (!minute || !hour || !dom || !month || !dow) return null;
  // Normalize 7 → 0 (both Sunday).
  if (dow.has(7)) {
    dow = new Set(dow);
    dow.delete(7);
    dow.add(0);
  }
  return {
    minute,
    hour,
    dom,
    month,
    dow,
    domRestricted: parts[2] !== "*",
    dowRestricted: parts[4] !== "*",
  };
}

function matches(f: CronFields, d: Date): boolean {
  if (!f.minute.has(d.getMinutes())) return false;
  if (!f.hour.has(d.getHours())) return false;
  if (!f.month.has(d.getMonth() + 1)) return false;
  const domOk = f.dom.has(d.getDate());
  const dowOk = f.dow.has(d.getDay());
  // Standard cron: when both DOM and DOW are restricted, match if EITHER
  // matches; otherwise the unrestricted field is `*` and always passes.
  if (f.domRestricted && f.dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}

/**
 * First matching minute strictly after `after`. Scans minute-by-minute up
 * to a 4-year horizon (covers Feb-29 edge cases). Returns null for an
 * invalid expression or no match within the horizon.
 */
export function nextFire(expr: string, after: Date): Date | null {
  const f = parseCron(expr);
  if (!f) return null;
  const d = new Date(after.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // strictly after
  const horizon = d.getTime() + 4 * 366 * 24 * 60 * 60 * 1000;
  while (d.getTime() <= horizon) {
    if (matches(f, d)) return new Date(d.getTime());
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null;
}
