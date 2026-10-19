/**
 * Thin REST client for the craft-web plugin routes (`/api/plugins/craft-web/*`).
 * Relative URLs, like every plugin client; response shapes in `status-types.ts`.
 * See change: edit-office-in-pane-with-craft-web.
 */
import { type CraftWebStatus, type PrepareResult, parsePrepare, parseStatus } from "./status-types.js";

const BASE = "/api/plugins/craft-web";

/** Outcome of the status probe: a parsed status, or why none is available. */
export type StatusOutcome =
  | { kind: "status"; status: CraftWebStatus }
  | { kind: "restart-required" }
  | { kind: "unreachable" };

export async function fetchCraftStatus(): Promise<StatusOutcome> {
  try {
    const res = await fetch(`${BASE}/status`);
    if (res.status === 404) return { kind: "restart-required" };
    if (!res.ok) return { kind: "unreachable" };
    const status = parseStatus(await res.json().catch(() => null));
    return status ? { kind: "status", status } : { kind: "unreachable" };
  } catch {
    return { kind: "unreachable" };
  }
}

/** Explicit, user-initiated download. Never called by a static request path. */
export async function prepareCraftApp(appId: string): Promise<PrepareResult> {
  try {
    const res = await fetch(`${BASE}/prepare/${encodeURIComponent(appId)}`, { method: "POST" });
    const body: unknown = await res.json().catch(() => null);
    return parsePrepare(res.ok, res.status, body);
  } catch {
    return { ok: false, reason: "offline" };
  }
}

/** Fire-and-forget CSP violation report (server log only; nothing is shown to the user). */
export function reportCsp(appId: string, directive: string): void {
  void fetch(`${BASE}/csp-report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app: appId, directive }),
  }).catch(() => {});
}
