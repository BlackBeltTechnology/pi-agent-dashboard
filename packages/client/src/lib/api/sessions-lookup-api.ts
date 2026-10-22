/**
 * `GET /api/sessions?id=<id>` — resolve one session (exact id or an
 * >= 8-character prefix) against the full non-archived registry, for deep
 * links that name a session outside the windowed snapshot.
 * See change: add-session-ui-deep-links-for-agents (D3).
 */
import type { SessionListItem } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getApiBase } from "./api-context.js";
import { ApiHttpError, fetchJson } from "./fetch-json.js";

/** The lookup was refused for lack of (valid) sign-in — hand to the auth-loss path. */
export class SessionLookupAuthError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`session lookup refused (HTTP ${status})`);
    this.name = "SessionLookupAuthError";
    this.status = status;
  }
}

export async function lookupSessionsById(id: string): Promise<SessionListItem[]> {
  try {
    const json = await fetchJson<{ success: boolean; data?: SessionListItem[] }>(
      `${getApiBase()}/api/sessions?id=${encodeURIComponent(id)}`,
      { credentials: "same-origin" },
    );
    return json.data ?? [];
  } catch (err) {
    if (err instanceof ApiHttpError && (err.status === 401 || err.status === 403)) {
      throw new SessionLookupAuthError(err.status);
    }
    throw err;
  }
}
