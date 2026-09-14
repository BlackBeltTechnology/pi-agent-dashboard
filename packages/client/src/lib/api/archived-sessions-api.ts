/**
 * Client-side fetch helpers for the archived-session REST endpoints.
 *
 * `GET /api/sessions/archived` — per-folder (cwd) or cross-folder (q) listing,
 * cursor-paginated, served from the server's in-memory archive index.
 * `GET /api/sessions/archived/:id` — one row (read-only open reseed).
 * `DELETE /api/sessions/archived/:id` — removes transcript + sidecar.
 *
 * See change: archive-sessions-lazy-load.
 */
import type { ArchivedSessionSummary } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { getApiBase } from "./api-context.js";
import { fetchJson } from "./fetch-json.js";

export interface ArchivedSessionsPage {
  items: ArchivedSessionSummary[];
  nextCursor?: string;
}

export interface ArchivedSessionsQuery {
  /** Folder group path (absolute). */
  cwd?: string;
  /** Server-side substring search over name / firstMessage. ≥ 3 chars. */
  q?: string;
  /** Page size, clamped server-side to 1–200. */
  limit?: number;
  /** Opaque cursor from a previous page. */
  cursor?: string;
}

export async function fetchArchivedSessions(query: ArchivedSessionsQuery = {}): Promise<ArchivedSessionsPage> {
  const qs = new URLSearchParams();
  if (query.cwd) qs.set("cwd", query.cwd);
  if (query.q) qs.set("q", query.q);
  qs.set("limit", String(query.limit ?? 50));
  if (query.cursor) qs.set("cursor", query.cursor);
  const json = await fetchJson<{ success: boolean; data: ArchivedSessionsPage }>(
    `${getApiBase()}/api/sessions/archived?${qs.toString()}`,
    { credentials: "same-origin" },
  );
  return json.data;
}

export async function fetchArchivedSessionById(id: string): Promise<ArchivedSessionSummary> {
  const json = await fetchJson<{ success: boolean; data: { item: ArchivedSessionSummary } }>(
    `${getApiBase()}/api/sessions/archived/${encodeURIComponent(id)}`,
    { credentials: "same-origin" },
  );
  return json.data.item;
}

export async function deleteArchivedSession(id: string): Promise<void> {
  await fetchJson<{ success: boolean }>(
    `${getApiBase()}/api/sessions/archived/${encodeURIComponent(id)}`,
    { method: "DELETE", credentials: "same-origin" },
  );
}
