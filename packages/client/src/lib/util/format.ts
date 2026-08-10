/**
 * Formatting utilities for session card display.
 */

import { t } from "../i18n/i18n.js";

/** Format token count: 12400 → "12.4k", 500 → "500" */
export function formatTokens(value: number): string {
  if (!value || isNaN(value)) return "0";
  if (value < 1000) return String(value);
  const k = value / 1000;
  return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_KEYS = [
  "time.weekday.sunday",
  "time.weekday.monday",
  "time.weekday.tuesday",
  "time.weekday.wednesday",
  "time.weekday.thursday",
  "time.weekday.friday",
  "time.weekday.saturday",
];

/** Pad a number to 2 digits */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Pad a number to 2 digits for month/day */
function pad2m(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Format a message timestamp for chat display.
 * - Today: "HH:MM:SS"
 * - Yesterday: "Yesterday HH:MM:SS"
 * - 2-6 days ago: "Weekday HH:MM:SS"
 * - Older: "YYYY-MM-DD HH:MM:SS"
 */
export function formatMessageTime(ts: number, now?: number): string {
  const date = new Date(ts);
  const ref = new Date(now ?? Date.now());

  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;

  // Start of today
  const startOfToday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const tsTime = date.getTime();

  if (tsTime >= startOfToday) {
    return time;
  }
  if (tsTime >= startOfYesterday) {
    return t("time.yesterday", { time }, "Yesterday {time}");
  }
  // Up to 6 days ago
  const sixDaysAgo = startOfToday - 6 * 86_400_000;
  if (tsTime >= sixDaysAgo) {
    const day = date.getDay();
    return `${t(WEEKDAY_KEYS[day], undefined, WEEKDAYS[day])} ${time}`;
  }
  // Full date
  return `${date.getFullYear()}-${pad2m(date.getMonth() + 1)}-${pad2m(date.getDate())} ${time}`;
}

/** Format millisecond duration to relative time: 180000 → "3m" */
export function formatRelativeTime(ms: number): string {
  if (ms <= 0) return "0s";

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  return `${days}d`;
}
