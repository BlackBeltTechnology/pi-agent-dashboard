/**
 * Client for `/api/system-one/*`. Relative URLs; the dashboard auth cookie
 * travels with same-origin fetches. Errors surface the server's lowercase
 * machine code in `ApiError.code`; components own the user-facing copy.
 * See change: add-system-one-registry.
 */
import type { Backend, CalibrationRecord, Capabilities, ConsumerDeclaration, Preset } from "@blackbelt-technology/pi-system-one";

export interface ManagedStatus {
  state: "stopped" | "installing" | "starting" | "ready" | "failed" | "unavailable" | "unsupported-platform";
  reason?: string;
  pid?: number;
  port?: number;
  rssKb?: number;
  uptimeMs?: number;
  lastHealthAt?: string;
  healthBudgetMs?: number;
}

export interface BackendView {
  capabilities: Required<Capabilities>;
  offMachine: boolean;
  egress: string;
  keyRef: string | null;
  languageLabel: string | null;
  priceUsdPerMTok: number | null;
  managed: ManagedStatus | null;
}

/** The UI-managed keys (the Save Bar draft). */
export interface Draft {
  allowOffMachine: boolean;
  backends: Record<string, Backend>;
  presets: Record<string, Preset>;
  activePreset: string;
}

export interface ConfigResponse {
  revision: string;
  exists: boolean;
  path: string;
  config: Draft & { calibration: Record<string, CalibrationRecord> };
  backends: Record<string, BackendView>;
}

export interface KeyStatus {
  set: boolean;
  source: "env" | "file" | null;
}

export interface ConsumerRow extends ConsumerDeclaration {
  lastSeen: string | null;
  test: { enabled: boolean; cases: number; reason?: string };
}

interface QuestionReport {
  type: string;
  cases: number;
  correct: number;
  accuracy: number;
  auc: number | null;
  threshold: number | null;
}

export interface EvalReport {
  backendId: string;
  consumerId: string;
  model: string | null;
  cases: number;
  failures: number;
  cancelled: boolean;
  questions: Record<string, QuestionReport>;
  latencyMs: { p50: number | null; p90: number | null };
  inputChars: number;
  estimatedCostUsd: number | null;
  thresholds: Record<string, number>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const BASE = "/api/system-one";

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    signal,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: { error?: unknown } | null = null;
  try {
    json = (await res.json()) as { error?: unknown } | null;
  } catch {
    json = null;
  }
  if (!res.ok) throw new ApiError(res.status, typeof json?.error === "string" ? json.error : `http-${res.status}`);
  return json as unknown as T;
}

export const api = {
  getConfig: () => call<ConfigResponse>("GET", "/config"),
  putConfig: (config: Draft, baseRevision: string) => call<{ revision: string }>("PUT", "/config", { config, baseRevision }),
  getKeys: () => call<{ keys: Record<string, KeyStatus> }>("GET", "/keys"),
  setKey: (keyRef: string, value: string) => call<{ status: KeyStatus }>("POST", `/keys/${encodeURIComponent(keyRef)}`, { value }),
  getConsumers: () => call<{ consumers: ConsumerRow[] }>("GET", "/consumers"),
  runEval: (consumerId: string, backendId: string, signal?: AbortSignal) =>
    call<EvalReport>("POST", "/eval", { consumerId, backendId }, signal),
  saveCalibration: (body: {
    backendId: string;
    consumerId: string;
    mode: "shadow" | "enforce";
    thresholds: Record<string, number>;
    model: string;
    baseRevision: string;
    confirm?: boolean;
  }) => call<{ revision: string }>("POST", "/calibration", body),
  managed: (id: string, action: "start" | "stop") => call<ManagedStatus>("POST", `/managed/${encodeURIComponent(id)}/${action}`),
  managedLog: (id: string) => call<{ lines: string[] }>("GET", `/managed/${encodeURIComponent(id)}/log`),
};
