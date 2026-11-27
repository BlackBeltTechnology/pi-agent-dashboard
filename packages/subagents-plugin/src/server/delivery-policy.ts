/**
 * Subagents delivery policy: the defer keys and the bounded deferred copy the
 * browser gateway uses instead of shedding a subagent end / liveness frame on a
 * saturated socket. Moved verbatim from core `browser-gateway.ts`.
 *
 * Keys: `subagent_completed|failed` → `[sessionId, id, real|heal]`,
 * `subagent_stop_result` → `[sessionId, agentId]` (old streams),
 * `subagent_registry_snapshot` → `[sessionId]`. No string id → no key.
 *
 * See change: move-subagents-to-plugin (D10).
 */
import type { PluginDeliveryPolicy } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Scalar `details` fields kept in a deferred end copy: the status plus the
 * scalars the reducer reads. Fixed list, so the copy is bounded by
 * construction (strings cut to 256 bytes each).
 */
const DEFER_DETAIL_SCALARS = [
  "status", "stopReason", "entryCount", "activity", "displayName", "modelName",
  "thinkingLevel", "subagentType", "toolUses", "durationMs", "agentMdPath",
  "agentSessionId", "queuePosition", "activeSlots", "maxConcurrent", "slotGrantedAt",
  "stoppable", "agentId",
] as const;

/** Byte cap of `result` / `error` in a deferred end copy. */
export const SUBAGENT_END_DEFER_TEXT_BYTES = 8192;

/** Cut a string to at most `max` UTF-8 bytes without splitting a code point. */
function cutUtf8(text: string, max: number): string {
  if (Buffer.byteLength(text) <= max) return text;
  let out = Buffer.from(text).subarray(0, max).toString("utf8");
  // A split code point decodes to U+FFFD (3 bytes); trim until within budget.
  while (Buffer.byteLength(out) > max) out = out.slice(0, -1);
  return out;
}

const dataOf = (event: DashboardEvent): Record<string, unknown> =>
  (event.data && typeof event.data === "object" ? event.data : {}) as Record<string, unknown>;

export function createSubagentsDeliveryPolicy(): PluginDeliveryPolicy {
  return {
    deferKey(event, sessionId) {
      if (typeof sessionId !== "string") return undefined;
      const data = dataOf(event);
      switch (event.eventType) {
        case "subagent_completed":
        case "subagent_failed": {
          if (typeof data.id !== "string" || data.id === "") return undefined;
          const kind = data.healedBy !== undefined ? "subagent_heal" : "subagent_end";
          return `${kind}:${sessionId}:${data.id}`;
        }
        case "subagent_stop_result":
          if (typeof data.agentId !== "string" || data.agentId === "") return undefined;
          return `subagent_stop_result:${sessionId}:${data.agentId}`;
        case "subagent_registry_snapshot":
          return `subagent_registry_snapshot:${sessionId}`;
        default:
          return undefined;
      }
    },

    /**
     * An end keeps `id`, `healedBy`, `durationMs`, `tokens`, `toolUses`,
     * `result` / `error` cut to `SUBAGENT_END_DEFER_TEXT_BYTES`, and only the
     * scalar `details` fields (no `entries`, no `liveBlock`, no nested object),
     * plus `deferredProjection: true` so the client replay cache never stores it.
     * Stop answers and snapshots are small and returned unchanged.
     */
    project(event) {
      if (event.eventType !== "subagent_completed" && event.eventType !== "subagent_failed") return event;
      const data = dataOf(event);
      const projected: Record<string, unknown> = { id: data.id };
      if (data.healedBy !== undefined) projected.healedBy = data.healedBy;
      for (const k of ["type", "description"] as const) {
        if (typeof data[k] === "string") projected[k] = cutUtf8(data[k] as string, 512);
      }
      if (typeof data.durationMs === "number") projected.durationMs = data.durationMs;
      if (typeof data.toolUses === "number") projected.toolUses = data.toolUses;
      const tokens = data.tokens as Record<string, unknown> | undefined;
      if (tokens && typeof tokens === "object") {
        const t: Record<string, number> = {};
        for (const k of ["input", "output", "total"]) if (typeof tokens[k] === "number") t[k] = tokens[k] as number;
        projected.tokens = t;
      }
      if (typeof data.result === "string") projected.result = cutUtf8(data.result, SUBAGENT_END_DEFER_TEXT_BYTES);
      if (typeof data.error === "string") projected.error = cutUtf8(data.error, SUBAGENT_END_DEFER_TEXT_BYTES);
      const details = data.details as Record<string, unknown> | undefined;
      if (details && typeof details === "object" && !Array.isArray(details)) {
        const d: Record<string, unknown> = {};
        for (const k of DEFER_DETAIL_SCALARS) {
          const v = details[k];
          if (typeof v === "number" || typeof v === "boolean") d[k] = v;
          else if (typeof v === "string") d[k] = cutUtf8(v, 256);
        }
        projected.details = d;
      }
      projected.deferredProjection = true;
      return { ...event, data: projected };
    },
  };
}
