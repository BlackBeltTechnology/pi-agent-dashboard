/**
 * Remote access wizard I/O — thin wrappers over EXISTING endpoints that keep
 * what the shared helpers drop: the HTTP status. A 401/403 is a REFUSAL (this
 * browser may not make the change) and must read differently from a failure,
 * and a read failure must stay distinguishable from an empty answer so the UI
 * can say "unknown" instead of rendering a default.
 *
 * No new server route or config key. See change: add-remote-access-wizard (design D2, D4).
 */
import type { TunnelStatusDetail } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { getApiBase } from "../api/api-context.js";
import { fetchJsonResponse } from "../api/fetch-json.js";
import type { RaConfig } from "./steps.js";

export type ActionResult = { ok: true } | { ok: false; kind: "refused" | "failed"; message: string };

const refusal = (res: Response) => res.status === 401 || res.status === 403;
const httpFailure = (status: number): ActionResult => ({ ok: false, kind: "failed", message: ["HTTP", status].join(" ") });

/** Reads throw on ANY failure (non-2xx, `success:false`, transport) — the caller maps that to "unknown". */
async function readData<T>(url: string): Promise<T> {
  const { res, json } = await fetchJsonResponse<{ success?: boolean; data?: T; error?: string }>(url);
  if (!res.ok || json.success === false || json.data === undefined) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.data;
}

export const readConfig = (): Promise<RaConfig> => readData<RaConfig>(`${getApiBase()}/api/config`);

export async function readStatusDetail(): Promise<TunnelStatusDetail> {
  const res = await fetch(`${getApiBase()}/api/tunnel-status-detail`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as TunnelStatusDetail;
}

export async function readEndpoints(): Promise<TunnelEndpoint[]> {
  return (await readData<{ endpoints: TunnelEndpoint[] }>(`${getApiBase()}/api/tunnel/endpoints`)).endpoints;
}

/** POST/PUT with a typed outcome: ok · refused (401/403) · failed(message). */
async function send(url: string, method: "POST" | "PUT", body?: unknown): Promise<ActionResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (refusal(res)) return { ok: false, kind: "refused", message: "not allowed" };
    const json = (await res.json().catch(() => null)) as { success?: boolean; ok?: boolean; error?: string } | null;
    if (!res.ok || json?.success === false || json?.ok === false) {
      return { ok: false, kind: "failed", message: json?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, kind: "failed", message: e instanceof Error ? e.message : "request failed" };
  }
}

export const writeConfig = (partial: Record<string, unknown>) => send(`${getApiBase()}/api/config`, "PUT", partial);
/**
 * `POST /api/restart` answers, then the server exits ~200 ms later — so a dropped
 * connection IS the restart underway, not a failure. Only an HTTP refusal or
 * error response means the restart will not happen.
 */
export async function restartServer(): Promise<ActionResult> {
  try {
    const res = await fetch(`${getApiBase()}/api/restart`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (refusal(res)) return { ok: false, kind: "refused", message: "not allowed" };
    if (!res.ok) return httpFailure(res.status);
    return { ok: true };
  } catch {
    return { ok: true };
  }
}
export const disconnectGateway = () => send(`${getApiBase()}/api/tunnel-disconnect`, "POST", { forget: false });
