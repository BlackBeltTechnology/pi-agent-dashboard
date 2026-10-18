/**
 * Client helper for the live-server-preview REST API. `start` pre-validates
 * the target with the SAME shared `validateLiveTarget` (SSRF boundary) the
 * server enforces, so free-form remote hosts are refused before any request.
 *
 * See change: improve-content-editor (live-server-preview §6).
 */
import {
  type LiveServerTarget,
  validateLiveTarget,
} from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import { getApiBase } from "./api-context.js";

export type StartResult =
  | { ok: true; target: LiveServerTarget & { path: string } }
  | { ok: false; error: string };

/** List the persisted dev-server allowlist. */
export async function listLiveServers(): Promise<LiveServerTarget[]> {
  const res = await fetch(`${getApiBase()}/api/live-server/list`);
  const body = await res.json();
  return body.success ? (body.data.servers as LiveServerTarget[]) : [];
}

/** Validate (loopback-only) then register a target; returns the proxied path. */
export async function startLiveServer(input: {
  host: string;
  port: number;
  label?: string;
}): Promise<StartResult> {
  const v = validateLiveTarget(input);
  if (!v.ok) return { ok: false, error: v.error };
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}/api/live-server/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
  // Guard `res.json()`: a non-JSON error body (proxy/gateway HTML) would
  // otherwise throw and propagate as an unhandled rejection.
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    return { ok: false, error: body?.error ?? `start failed (${res.status})` };
  }
  return { ok: true, target: body.data };
}

/** Remove a target from the allowlist. */
export async function removeLiveServer(id: string): Promise<void> {
  await fetch(`${getApiBase()}/api/live-server/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export type CapabilityResult = { ok: true; path: string; expiresAt: number } | { ok: false; error: string };

/** `/live/<id>/~c/<token>/` — the only shape the viewer will frame (never a URL the server merely names). */
const CAPABILITY_PATH = /^\/live\/[A-Za-z0-9_-]+\/~c\/[A-Za-z0-9_-]+\/$/;

/**
 * Mint a per-preview capability path (`control` tier). The preview frame is a
 * sandboxed opaque origin that carries no cookie, so this URL is the credential:
 * it is framed, never displayed or logged. The response is flat (`path`,
 * `expiresAt`), not under `data`.
 * See change: retire-trusted-networks-bypass (D5).
 */
export async function mintLiveCapability(id: string): Promise<CapabilityResult> {
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}/api/live-server/${encodeURIComponent(id)}/capability`, { method: "POST" });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) return { ok: false, error: body?.error ?? `capability mint failed (${res.status})` };
  if (typeof body.path !== "string" || !CAPABILITY_PATH.test(body.path) || typeof body.expiresAt !== "number") {
    return { ok: false, error: "capability mint returned an unexpected response" };
  }
  return { ok: true, path: body.path, expiresAt: body.expiresAt };
}
