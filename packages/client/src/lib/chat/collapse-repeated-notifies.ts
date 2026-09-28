/**
 * Render-time collapse of adjacent identical notify rows.
 *
 * A run of ≥2 consecutive display rows that are all notify rows with the same
 * normalized level and the same non-empty rendered text becomes ONE row: a
 * shallow clone of the first member whose `args.params.repeat` carries
 * `{ count, firstTs, lastTs }`. Stored rows are never mutated; the clone keeps
 * the first member's `id` so the virtual-row key is stable while a live run
 * grows. Runs over `displayRows` (already visibility-filtered), so a hidden
 * row never breaks a run. See change: collapse-and-order-notify-rows (D3).
 */
import { normalizeNotifyLevel } from "@blackbelt-technology/pi-dashboard-shared/notify.js";
import type { ChatMessage } from "./event-reducer.js";

/** Repeat annotation carried by a collapsed notify row's `args.params`. */
export interface NotifyRepeat {
  count: number;
  firstTs: number;
  lastTs: number;
}

/**
 * The text `NotifyRenderer` renders: `params.message`, else the legacy
 * `params.title`, else `""`. Shared so the collapse key matches what shows.
 */
export function notifyRenderedText(params: Record<string, unknown> | undefined): string {
  if (typeof params?.message === "string") return params.message;
  if (typeof params?.title === "string") return params.title;
  return "";
}

/** Collapse key for a notify row, or `null` when the row can't join a run. */
function notifyKey(row: unknown): string | null {
  const m = row as Partial<ChatMessage> | null;
  if (!m || m.role !== "interactiveUi" || m.content !== "notify") return null;
  const args = m.args as Record<string, unknown> | undefined;
  if (args?.method !== "notify") return null;
  const params = args.params as Record<string, unknown> | undefined;
  const text = notifyRenderedText(params);
  if (!text) return null;
  return `${normalizeNotifyLevel(params?.level)}\u0000${text}`;
}

export function collapseRepeatedNotifies<T>(rows: T[]): T[] {
  let out: T[] | null = null;
  let i = 0;
  while (i < rows.length) {
    const key = notifyKey(rows[i]);
    let j = i + 1;
    if (key !== null) {
      while (j < rows.length && notifyKey(rows[j]) === key) j++;
    }
    const runLength = j - i;
    if (runLength >= 2) {
      out ??= rows.slice(0, i);
      const first = rows[i] as unknown as ChatMessage;
      const last = rows[j - 1] as unknown as ChatMessage;
      const args = first.args as Record<string, unknown>;
      const repeat: NotifyRepeat = {
        count: runLength,
        firstTs: first.timestamp,
        lastTs: last.timestamp,
      };
      out.push({
        ...first,
        args: { ...args, params: { ...(args.params as object), repeat } },
      } as unknown as T);
    } else if (out) {
      out.push(rows[i]);
    }
    i = j;
  }
  // No run → hand back the input reference (memo consumers see no churn).
  return out ?? rows;
}
