/**
 * Typed client for the plugin's per-session pipeline route (design D5/D6).
 * One response feeds BOTH surfaces — the MEMORY subcard and the content-view
 * drill-in — so the two can never disagree.
 *
 * Mirrors the server response assembled in `../server/index.ts` +
 * `../server/pipeline-reader.ts`. The reader treats unknown/missing fields as
 * absent and degrades; this client mirrors that tolerance.
 *
 * See change: add-blackhole-session-pipeline.
 */
import { sessionRoute } from "./routes.js";

export type WorkerId = "observer" | "reflector" | "dropper";

export interface WorkerCursorView {
  entryId: string | null;
  state: string | null;
  entry: number | null;
}

export interface WorkerPipelineView {
  model: string | null;
  cooldown: { until: string; reason: string } | null;
}

export interface SessionPipelineResponse {
  sessionId: string;
  activity: "none" | "active";
  pendingBatches: number;
  cursors: Record<WorkerId, WorkerCursorView | null>;
  tip: number | null;
  config: {
    compactAfterTokens: number | null;
    memory: boolean | null;
    compaction: "auto" | "manual" | "off" | null;
  };
  workers: Record<WorkerId, WorkerPipelineView>;
}

export const WORKER_IDS: readonly WorkerId[] = ["observer", "reflector", "dropper"];

/**
 * Fetch one session's pipeline snapshot. A non-200 or malformed body throws —
 * the subcard renders its error posture; the route itself never errors on
 * absent/torn files, so any throw here is a transport failure.
 */
export async function getSessionPipeline(
  sessionId: string,
  apiBase = "",
  signal?: AbortSignal,
): Promise<SessionPipelineResponse> {
  const res = await fetch(`${apiBase}${sessionRoute(sessionId)}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body: unknown = await res.json();
  // Validate before the assertion: a malformed 200 body must reach the
  // caller's catch (error state), not explode during render.
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { config?: unknown }).config !== "object" ||
    (body as { config?: unknown }).config === null ||
    typeof (body as { cursors?: unknown }).cursors !== "object" ||
    (body as { cursors?: unknown }).cursors === null
  ) {
    throw new Error("malformed pipeline payload");
  }
  return body as SessionPipelineResponse;
}
