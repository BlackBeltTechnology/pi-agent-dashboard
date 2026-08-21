/**
 * Read the retained per-session auto-naming outcomes.
 *
 * A permanent naming stop can happen with NO client subscribed — the
 * `auto_name_error` toast only reaches a connected browser — so an operator
 * who opens the dashboard afterwards would otherwise have no route to the
 * reason short of reading `server.log`. This fetch is what makes a stop
 * reported before the surface mounted still discoverable.
 *
 * See change: fix-auto-naming-reasoning-model (design D9, test-plan #F8, #F10).
 */
import type { AutoNameOutcome } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { getApiBase } from "./api-context.js";

export interface AutoNameOutcomeRow {
  sessionId: string;
  outcome: AutoNameOutcome;
  reason: string;
  modelRef?: string;
  at: number;
}

/**
 * A row is usable only when the fields the renderer dereferences are present.
 * An array check alone lets `{ outcomes: [null] }` through, and the renderer
 * reads `r.sessionId` — crashing the whole Settings view over a diagnostics
 * payload, which is precisely the wrong failure for a diagnostics surface.
 */
function isOutcomeRow(v: unknown): v is AutoNameOutcomeRow {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.sessionId === "string"
    && typeof r.outcome === "string"
    && typeof r.reason === "string"
    && typeof r.at === "number"
    && (r.modelRef === undefined || typeof r.modelRef === "string");
}

export async function fetchAutoNameOutcomes(): Promise<AutoNameOutcomeRow[]> {
  const res = await fetch(`${getApiBase()}/api/auto-name-outcomes`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return Array.isArray(body?.outcomes) ? body.outcomes.filter(isOutcomeRow) : [];
}
