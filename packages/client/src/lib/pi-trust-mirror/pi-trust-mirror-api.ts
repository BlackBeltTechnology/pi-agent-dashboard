/**
 * Transport + defaults for the dashboard-trust → pi mirror UI.
 *
 * - `fetchPiTrustMirrorConfig` GET /api/config → `piTrustMirror` (checkbox defaults)
 * - `fetchPiTrustAccess`      GET /api/access/pi-trust (Access page disclosure)
 * - `setPiTrustChoice`        PUT /api/access/pi-trust/choice
 * - `setPiTrustMirrorConfig`  PUT /api/config { piTrustMirror } (server merges nested keys)
 *
 * See change: mirror-dashboard-trust-to-pi, mirror-dashboard-trust-live-remote.
 */
import type {
  MirrorIgnoreReason,
  MirrorSourceKind,
} from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-types.js";
import { getApiBase } from "../api/api-context.js";

export interface PiTrustMirrorSettings {
  enabled: boolean;
  coverInteractive: boolean;
  /** Bridge asks the running server about live (server-lifetime) entries. */
  liveQuery: boolean;
  /** Live-query deadline override; absent = 300 ms local / 1000 ms remote (clamped 50–1000). */
  liveQueryTimeoutMs?: number;
  sources: Record<MirrorSourceKind, boolean>;
}

export const DEFAULT_PI_TRUST_MIRROR_SETTINGS: PiTrustMirrorSettings = {
  enabled: true,
  coverInteractive: false,
  liveQuery: true,
  sources: { worktreeInit: true, workflow: true, pinned: true, folderWorkspaces: true, accessGrants: false, yolo: true },
};

/** How long a live (server-lifetime) entry lasts; mirrors the server's `LiveLifetime`. */
export type PiTrustLiveLifetime =
  | { kind: "restart" }
  | { kind: "yolo-until"; until: number }
  | { kind: "yolo-process" };

export interface PiTrustAccessEntry {
  sourceKind: MirrorSourceKind;
  sourceLabel: string;
  folder: string;
  choice: boolean | null;
  byDefault: boolean;
  confers: boolean;
  reason?: MirrorIgnoreReason;
  reasonLabel?: string;
  /** Live entry (memory-only, server lifetime). */
  live?: boolean;
  lifetime?: PiTrustLiveLifetime;
}

export interface PiTrustAccessView {
  available: boolean;
  config: PiTrustMirrorSettings;
  agentDir: string;
  piEntries: Array<{ folder: string; decision: boolean }>;
  effective: Array<{
    folder: string;
    sourceKind: MirrorSourceKind;
    sourceLabel: string;
    coversSubfolders: boolean;
    live?: boolean;
    lifetime?: PiTrustLiveLifetime;
  }>;
  ignored: PiTrustAccessEntry[];
  entries: PiTrustAccessEntry[];
  sourcesNotInstalled: MirrorSourceKind[];
  choicesReadable?: boolean;
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(`${getApiBase()}${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => ({}))) as Envelope<T> | null;
    return { ok: res.ok && json?.success === true, data: json?.data, error: json?.error };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}

/** Merge a possibly-partial server value over the defaults (never throws). */
function normalizeMirrorSettings(raw: unknown): PiTrustMirrorSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<PiTrustMirrorSettings>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_PI_TRUST_MIRROR_SETTINGS.enabled,
    coverInteractive:
      typeof r.coverInteractive === "boolean" ? r.coverInteractive : DEFAULT_PI_TRUST_MIRROR_SETTINGS.coverInteractive,
    liveQuery: typeof r.liveQuery === "boolean" ? r.liveQuery : DEFAULT_PI_TRUST_MIRROR_SETTINGS.liveQuery,
    ...(typeof r.liveQueryTimeoutMs === "number" && Number.isFinite(r.liveQueryTimeoutMs)
      ? { liveQueryTimeoutMs: r.liveQueryTimeoutMs }
      : {}),
    sources: { ...DEFAULT_PI_TRUST_MIRROR_SETTINGS.sources, ...(r.sources ?? {}) },
  };
}

export async function fetchPiTrustMirrorConfig(): Promise<PiTrustMirrorSettings> {
  const r = await call<{ piTrustMirror?: unknown }>("GET", "/api/config");
  return normalizeMirrorSettings(r.data?.piTrustMirror);
}

export async function fetchPiTrustAccess(): Promise<{ ok: boolean; data?: PiTrustAccessView; error?: string }> {
  const r = await call<PiTrustAccessView>("GET", "/api/access/pi-trust");
  return r.ok && r.data ? { ok: true, data: { ...r.data, config: normalizeMirrorSettings(r.data.config) } } : r;
}

export function setPiTrustChoice(
  sourceKind: MirrorSourceKind,
  folder: string,
  choice: boolean | null,
): Promise<{ ok: boolean; error?: string }> {
  return call("PUT", "/api/access/pi-trust/choice", { sourceKind, folder, choice });
}

export function setPiTrustMirrorConfig(partial: {
  enabled?: boolean;
  coverInteractive?: boolean;
  liveQuery?: boolean;
  /** `null` clears the override (server falls back to its per-class default). */
  liveQueryTimeoutMs?: number | null;
  sources?: Partial<Record<MirrorSourceKind, boolean>>;
}): Promise<{ ok: boolean; error?: string }> {
  return call("PUT", "/api/config", { piTrustMirror: partial });
}
