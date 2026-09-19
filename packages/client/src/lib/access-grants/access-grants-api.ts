/**
 * Client transport for the Settings → Access review surface (change:
 * add-access-grants-and-review).
 *
 * READ: one aggregate fetch, `GET /api/access/grants` (the server side of this
 * change owns the route). Loading the tab performs ONLY this GET — rendering
 * the page performs zero store writes (task 7.7).
 *
 * REVOKE: each store is revoked against ITS OWN write path (task 7.5):
 * - path grants            → DELETE /api/access/grants
 * - worktree-init trust    → DELETE /api/access/worktree-trust (also clears
 *                            in-memory session trust server-side)
 * - KB source trust        → DELETE /api/access/kb-trust
 * - project trust          → POST /api/resources/trust with `decision: null` —
 *                            the existing `persistTrustDecision` wrapper's
 *                            route (design D13). Revoke means DELETE the
 *                            entry; a standing negative decision is never
 *                            recorded in its place.
 * - trusted networks       → PUT /api/config `trustedNetworks` — the existing
 *                            config write path (spec: revoking a trusted
 *                            network).
 * - auth bypass hosts      → DELETE /api/access/bypass-hosts (the
 *                            `auth.bypassHosts` field, never trustedNetworks)
 * - CORS origins           → PUT /api/config `cors.allowedOrigins`
 * - pinned directories     → PATCH /api/preferences/pinned-directories (the
 *                            preferences-store write path)
 *
 * No function here creates a grant (design D12).
 */
import { getApiBase } from "../api/api-context.js";
import type { AccessEntry, AccessGrantSnapshot } from "./access-grants-types.js";

/** Loose shape of the dashboard's `{ success, data, error }` envelope. */
interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

interface AccessSnapshotResult {
  ok: boolean;
  status: number;
  snapshot?: AccessGrantSnapshot;
  error?: string;
}

/** GET /api/access/grants. Never throws on HTTP errors (network errors do). */
export async function fetchAccessSnapshot(): Promise<AccessSnapshotResult> {
  const res = await fetch(`${getApiBase()}/api/access/grants`);
  const body = (await res.json().catch(() => ({}))) as ApiEnvelope<AccessGrantSnapshot>;
  return {
    ok: res.ok && body?.success === true,
    status: res.status,
    snapshot: body?.data,
    error: body?.error,
  };
}

interface RevokeResult {
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * Revoke one entry against its own store's write path. `snapshot` is the
 * currently-displayed aggregate: config/preferences stores are field-level
 * writes, so the remaining list is computed as displayed-list-minus-entry.
 */
export async function revokeAccessEntry(
  entry: AccessEntry,
  snapshot: AccessGrantSnapshot,
): Promise<RevokeResult> {
  switch (entry.store) {
    case "pathGrants":
      return send("DELETE", "/api/access/grants", { subject: entry.subject, scope: entry.scope });
    case "worktreeTrust":
      return send("DELETE", "/api/access/worktree-trust", { subject: entry.subject });
    case "kbTrust":
      // Owned by the kb-plugin, which can call kb's own trust module.
      return send("DELETE", "/api/kb/source-trust", { hash: entry.id });
    case "projectTrust":
      // Routed through the existing `persistTrustDecision` wrapper server-side,
      // which writes `decision: null` into pi's store — and pi's `setMany`
      // DELETES the key on null, so revocation removes the entry rather than
      // recording a standing refusal (design D13). NOT `/api/resources/trust`:
      // that route is gated on an outstanding trust challenge and takes an
      // option id, so it cannot express a revoke.
      return send("DELETE", "/api/access/project-trust", { subject: entry.subject });
    case "trustedNetworks":
      return send("PUT", "/api/config", {
        trustedNetworks: snapshot.trustedNetworks.filter((v) => v !== entry.subject),
      });
    case "bypassHosts":
      return send("DELETE", "/api/access/bypass-hosts", { host: entry.subject });
    case "corsOrigins":
      return send("PUT", "/api/config", {
        cors: { allowedOrigins: snapshot.corsOrigins.filter((v) => v !== entry.subject) },
      });
    case "pinnedDirectories":
      return send("DELETE", "/api/access/pinned-directory", { subject: entry.subject });
  }
}

async function send(method: string, path: string, body: unknown): Promise<RevokeResult> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<unknown>;
  return { ok: res.ok && json?.success === true, status: res.status, error: json?.error };
}
