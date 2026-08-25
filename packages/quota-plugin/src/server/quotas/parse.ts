/**
 * Provider payload → `QuotaWindowDto[]`. Pure functions, no I/O, no secrets.
 *
 * Each provider reports usage in its own shape; these normalize onto the one
 * wire DTO the client understands. A window is only emitted when it carries a
 * usable reset stamp AND a positive window length, because pace/burn-rate is
 * meaningless without both — dropping is honest, faking a reset is not.
 *
 * See change: publish-quota-plugin.
 */
import type { QuotaWindowDto } from "../../types.js";

const HOUR = 3600;
const DAY = 24 * HOUR;

/** Percent of `used` against `limit`, clamped, 0 when the limit is unusable. */
export function safePercent(used: number, limit: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.max(0, Math.min(100, (used / limit) * 100));
}

/** Accept ISO strings, epoch seconds, and epoch millis; else null. */
function toIso(value: unknown): string | null {
  let date: Date | null = null;
  if (typeof value === "number" && Number.isFinite(value)) {
    date = new Date(value > 1e11 ? value : value * 1000);
  } else if (typeof value === "string" && value.trim()) {
    date = new Date(value);
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  // Epoch zero is a "no reset" sentinel, not a real timestamp.
  if (date.getTime() <= 0) return null;
  return date.toISOString();
}

/** Build a window, or null when it lacks the basis for a pace calculation. */
function win(
  label: string,
  usedPercent: number,
  resetsAt: unknown,
  windowSeconds: number,
  extra?: Partial<QuotaWindowDto>,
): QuotaWindowDto | null {
  const iso = toIso(resetsAt);
  if (!iso || !Number.isFinite(windowSeconds) || windowSeconds <= 0) return null;
  return {
    label,
    usedPercent: Number.isFinite(usedPercent) ? Math.max(0, Math.min(100, usedPercent)) : 0,
    resetsAt: iso,
    windowSeconds,
    ...extra,
  };
}

/** Drop the nulls. */
function compact(windows: Array<QuotaWindowDto | null>): QuotaWindowDto[] {
  return windows.filter((w): w is QuotaWindowDto => w !== null);
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? Number.NaN));

/**
 * Anthropic `/api/oauth/usage`: utilization percentages per rolling window,
 * plus optional per-model 7d windows and a paid overage budget.
 */
export function parseAnthropic(data: unknown): QuotaWindowDto[] {
  const d = obj(data);
  const out: Array<QuotaWindowDto | null> = [];

  const fiveHour = obj(d.five_hour);
  if (Object.keys(fiveHour).length) {
    out.push(win("5h", num(fiveHour.utilization ?? 0), fiveHour.resets_at, 5 * HOUR, { usedValue: num(fiveHour.utilization ?? 0), limitValue: 100 }));
  }
  const sevenDay = obj(d.seven_day);
  if (Object.keys(sevenDay).length) {
    out.push(win("7d", num(sevenDay.utilization ?? 0), sevenDay.resets_at, 7 * DAY, { usedValue: num(sevenDay.utilization ?? 0), limitValue: 100 }));
  }

  // Per-model 7d windows. `seven_day_omelette` is Anthropic's real key for Opus.
  for (const [key, label] of [
    ["seven_day_sonnet", "7d Sonnet"],
    ["seven_day_omelette", "7d Opus"],
    ["seven_day_opus", "7d Opus (legacy)"],
  ] as const) {
    const entry = obj(d[key]);
    if (entry.utilization != null) {
      out.push(win(label, num(entry.utilization), entry.resets_at, 7 * DAY, { usedValue: num(entry.utilization), limitValue: 100 }));
    }
  }

  // Paid overage budget, reported in cents.
  const extra = obj(d.extra_usage);
  if (extra.is_enabled === true && num(extra.monthly_limit) > 0) {
    const limitDollars = num(extra.monthly_limit) / 100;
    const usedDollars = num(extra.used_credits ?? 0) / 100;
    const now = new Date();
    out.push(
      win(
        `Extra (${typeof extra.currency === "string" ? extra.currency : "USD"})`,
        extra.utilization != null ? num(extra.utilization) : safePercent(usedDollars, limitDollars),
        new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
        30 * DAY,
        { isCurrency: true, usedValue: usedDollars, limitValue: limitDollars },
      ),
    );
  }

  return compact(out);
}

/** Codex reports remaining percent; convert to used. */
function usedFromPercentLeft(limit: Record<string, unknown>): number {
  if (limit.percent_left != null) return Math.max(0, 100 - num(limit.percent_left));
  if (limit.remaining_percent != null) return Math.max(0, 100 - num(limit.remaining_percent));
  if (limit.used_percent != null) return num(limit.used_percent);
  return 0;
}

/** Human label for an arbitrary window length. */
function durationLabel(seconds: number): string {
  if (seconds % DAY === 0) return `${seconds / DAY}d`;
  if (seconds % HOUR === 0) return `${seconds / HOUR}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

/** OpenAI Codex `/backend-api/wham/usage`: primary + secondary rate windows. */
export function parseCodex(data: unknown): QuotaWindowDto[] {
  const d = obj(data);
  const rate = obj(d.rate_limit ?? d.rate_limits);
  const out: Array<QuotaWindowDto | null> = [];

  for (const [keys, fallbackSeconds] of [
    [["primary_window", "primary", "five_hour_limit", "five_hour"], 5 * HOUR],
    [["secondary_window", "secondary", "weekly_limit", "weekly"], 7 * DAY],
  ] as const) {
    const raw = keys.map((k) => rate[k]).find((v) => v != null);
    if (raw == null) continue;
    const entry = obj(raw);
    const seconds = Number.isFinite(num(entry.limit_window_seconds)) && num(entry.limit_window_seconds) > 0 ? num(entry.limit_window_seconds) : fallbackSeconds;
    const used = usedFromPercentLeft(entry);
    out.push(win(durationLabel(seconds), used, entry.reset_at ?? entry.reset_time_ms, seconds, { usedValue: used, limitValue: 100 }));
  }

  return compact(out);
}

/** GitHub Copilot `/copilot_internal/user`: monthly entitlement snapshots. */
export function parseCopilot(data: unknown): QuotaWindowDto[] {
  const d = obj(data);
  const resetsAt = d.quota_reset_date ?? d.quota_reset_date_utc ?? d.limited_user_reset_date;
  const out: Array<QuotaWindowDto | null> = [];

  const snapshots = obj(d.quota_snapshots);
  if (Object.keys(snapshots).length) {
    for (const [key, label] of [
      ["premium_interactions", "Premium / month"],
      ["chat", "Chat / month"],
      ["completions", "Completions / month"],
    ] as const) {
      const snap = obj(snapshots[key]);
      if (!Object.keys(snap).length || snap.unlimited === true) continue;
      const entitlement = num(snap.entitlement ?? 0);
      if (!(entitlement > 0)) continue;
      const remaining = num(snap.remaining ?? snap.quota_remaining ?? 0);
      out.push(
        win(label, safePercent(entitlement - remaining, entitlement), resetsAt, 30 * DAY, {
          usedValue: entitlement - remaining,
          limitValue: entitlement,
        }),
      );
    }
    return compact(out);
  }

  // Legacy shape.
  const monthly = obj(d.monthly_quotas);
  const limited = obj(d.limited_user_quotas);
  for (const [key, label] of [
    ["chat", "Chat / month"],
    ["completions", "Completions / month"],
  ] as const) {
    const limitValue = num(monthly[key] ?? 0);
    if (!(limitValue > 0)) continue;
    const remaining = num(limited[key] ?? 0);
    out.push(
      win(label, safePercent(limitValue - remaining, limitValue), resetsAt, 30 * DAY, {
        usedValue: limitValue - remaining,
        limitValue,
      }),
    );
  }
  return compact(out);
}

/** Next UTC midnight / next month start, for providers that report no reset stamp. */
function nextMidnightUtc(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1)).toISOString();
}
function nextMonthStartUtc(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)).toISOString();
}

/**
 * OpenRouter `/api/v1/key`: a spend budget. Only the budgeted window is
 * emitted — the peer also surfaced daily/weekly "tracking" rows pinned at 0%,
 * which rendered as permanently-empty bars and told the user nothing.
 */
export function parseOpenRouter(data: unknown): QuotaWindowDto[] {
  const keyData = obj(obj(data).data);
  if (!Object.keys(keyData).length) return [];
  const limit = num(keyData.limit);
  const usageMonthly = num(keyData.usage_monthly ?? keyData.usage ?? 0);
  if (!(limit > 0)) return [];
  return compact([
    win("Monthly Budget", safePercent(usageMonthly, limit), nextMonthStartUtc(), 30 * DAY, {
      isCurrency: true,
      usedValue: usageMonthly,
      limitValue: limit,
    }),
  ]);
}

/** Z.ai `/api/monitor/usage/quota/limit`: token windows + a monthly count window. */
export function parseZai(data: unknown): QuotaWindowDto[] {
  const d = obj(data);
  const raw = (obj(d.data).limits ?? d.limits) as unknown;
  if (!Array.isArray(raw)) return [];
  const out: Array<QuotaWindowDto | null> = [];

  for (const item of raw) {
    const entry = obj(item);
    if (entry.type === "TOKENS_LIMIT") {
      const count = num(entry.number ?? 1) || 1;
      // Observed units: 3=hour, 4=day, 6=week.
      const seconds = entry.unit === 3 ? count * HOUR : entry.unit === 4 ? count * DAY : entry.unit === 6 ? count * 7 * DAY : 0;
      const label = entry.unit === 6 ? `${count * 7}d` : entry.unit === 4 ? `${count}d` : entry.unit === 3 ? `${count}h` : "Tokens";
      out.push(win(label, num(entry.percentage ?? 0), entry.nextResetTime, seconds, { usedValue: num(entry.percentage ?? 0), limitValue: 100 }));
      continue;
    }
    if (entry.type === "TIME_LIMIT") {
      const limit = num(entry.usage ?? 0);
      if (!(limit > 0)) continue;
      const used = num(entry.currentValue ?? 0);
      out.push(win("Web / month", safePercent(used, limit), entry.nextResetTime, 30 * DAY, { usedValue: used, limitValue: limit }));
    }
  }

  out.sort((a, b) => (a?.windowSeconds ?? 0) - (b?.windowSeconds ?? 0));
  return compact(out);
}

/** Kimi `/coding/v1/usages`: a weekly allowance plus rolling windows. */
export function parseKimi(data: unknown): QuotaWindowDto[] {
  const d = obj(data);
  const out: Array<QuotaWindowDto | null> = [];

  const weekly = obj(d.usage);
  const wLimit = num(weekly.limit ?? 0);
  if (wLimit > 0) {
    const used = num(weekly.used ?? 0);
    out.push(win("Weekly", safePercent(used, wLimit), weekly.resetTime, 7 * DAY, { usedValue: used, limitValue: wLimit }));
  }

  const limits = Array.isArray(d.limits) ? d.limits : [];
  const unitSeconds: Record<string, number> = {
    TIME_UNIT_SECOND: 1,
    TIME_UNIT_MINUTE: 60,
    TIME_UNIT_HOUR: HOUR,
    TIME_UNIT_DAY: DAY,
  };
  for (const item of limits) {
    const entry = obj(item);
    const detail = obj(entry.detail);
    const window = obj(entry.window);
    const limit = num(detail.limit ?? 0);
    const duration = num(window.duration ?? 0);
    const unit = unitSeconds[String(window.timeUnit)];
    if (!(limit > 0) || !(duration > 0) || !unit) continue;
    const seconds = duration * unit;
    const used = num(detail.used ?? 0);
    out.push(win(durationLabel(seconds), safePercent(used, limit), detail.resetTime, seconds, { usedValue: used, limitValue: limit }));
  }

  out.sort((a, b) => (a?.windowSeconds ?? 0) - (b?.windowSeconds ?? 0));
  return compact(out);
}

/** Parse "$24.00" → 24. */
function currency(value: unknown): number {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Synthetic `/v2/quotas`: weekly credits + a rolling request window. */
export function parseSynthetic(data: unknown): QuotaWindowDto[] {
  const d = obj(data);
  const out: Array<QuotaWindowDto | null> = [];

  const weekly = obj(d.weeklyTokenLimit);
  if (Object.keys(weekly).length) {
    const limitValue = currency(weekly.maxCredits);
    const remaining = currency(weekly.remainingCredits);
    out.push(
      win("Credits / week", 100 - num(weekly.percentRemaining ?? 0), weekly.nextRegenAt, 7 * DAY, {
        isCurrency: true,
        usedValue: limitValue - remaining,
        limitValue,
      }),
    );
  }

  const rolling = obj(d.rollingFiveHourLimit);
  const max = num(rolling.max ?? 0);
  if (max > 0) {
    const used = max - num(rolling.remaining ?? 0);
    out.push(win("Requests / 5h", safePercent(used, max), rolling.nextTickAt, 5 * HOUR, { usedValue: Math.round(used), limitValue: max }));
  }

  return compact(out);
}
