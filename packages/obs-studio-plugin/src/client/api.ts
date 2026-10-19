/**
 * Panel ↔ plugin-route types and helpers (design D6/D7). The client never sees
 * the OBS password: routes return managed-service state, bridge info and live
 * OBS data only. See change: add-obs-studio-plugin.
 */
export const API = "/api/plugins/obs-studio";

interface LiveStatus {
  obsVersion?: string;
  currentScene?: string | null;
  current?: string | null;
  scenes?: string[];
  virtualCam?: boolean | null;
  recording?: boolean | null;
}

export interface InstanceStatus {
  id: string;
  mode: string;
  state: string;
  reason?: string;
  hint?: string;
  exposure?: string;
  recoverySuspended?: boolean;
  bridge?: { open: boolean; restarts: number; lastError?: string };
  live?: LiveStatus;
  liveError?: string;
}

export type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Record<string, unknown>;
  constructor(status: number, code: string, body: Record<string, unknown>) {
    super(code);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export async function api<T>(fetcher: Fetcher, path: string, init?: RequestInit): Promise<T> {
  const res = await fetcher(path, { ...init, headers: init?.body ? { "content-type": "application/json" } : undefined });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, typeof body.error === "string" ? body.error : `http-${res.status}`, body);
  return body as T;
}

/** Auth state shown on the card: from live data, else the bridge's last error. */
export function authState(s: InstanceStatus): "ok" | "failed" | "unknown" {
  if (s.live) return "ok";
  if (s.liveError === "auth-failed" || /auth-failed/.test(s.bridge?.lastError ?? "")) return "failed";
  return "unknown";
}

/** Which lifecycle action the panel offers (never Stop; nothing while `blocked`). */
export function lifecycleAction(state: string): "start" | "retry" | null {
  if (state === "stopped" || state === "idle") return "start";
  if (state === "failed" || state === "unavailable" || state === "stop-failed") return "retry";
  return null;
}
