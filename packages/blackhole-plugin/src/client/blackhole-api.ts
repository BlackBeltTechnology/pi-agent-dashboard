/**
 * Thin REST client for the blackhole config endpoints plus the installed-ness
 * probe.
 *
 * Installed-ness comes from `GET /api/plugins/blackhole/status` — the plugin's
 * own route, whose answer is the registry-backed `isPiExtensionInstalled`
 * capability (degrading to config-file existence only when the host lacks the
 * capability) — NOT from a client-side guess. During a scan failure (503) or
 * any unknown answer this resolves to `true` (fail-open): an unknown answer
 * must not fabricate a not-installed state over a working config. The client
 * boot gate fails CLOSED on the same uncertainty — opposite stakes, deliberate
 * postures (design D1).
 *
 * See change: add-blackhole-plugin, add-blackhole-session-pipeline.
 */

import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export interface FieldView {
  value: unknown;
  default: unknown;
  isDefault: boolean;
}

export interface ConfigOk {
  status: "ok";
  filePath: string;
  exists: boolean;
  fields: Record<string, FieldView>;
  unmanagedKeys: string[];
}

export interface ConfigParseError {
  status: "parse-error";
  filePath: string;
  message: string;
}

export type ConfigResult = ConfigOk | ConfigParseError;

const ROUTE = "/api/plugins/blackhole/config";
const STATUS_ROUTE = "/api/plugins/blackhole/status";
const MODELS_ROUTE = "/api/models";

async function parseJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
  }
  return (await res.json()) as T;
}

/**
 * Read the config. A 409 parse-error is a RESULT, not a thrown error — the UI
 * renders a recovery state for it rather than a generic failure.
 */
export async function getConfig(apiBase = "", signal?: AbortSignal): Promise<ConfigResult> {
  const res = await fetch(`${apiBase}${ROUTE}`, { signal });
  const body = await parseJson<ConfigResult & { error?: string }>(res);
  if (!res.ok && body?.status !== "parse-error") {
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return body;
}

export interface SaveResponse extends ConfigOk {
  preservedUnmanagedKeys: string[];
  externalWriteDetected: boolean;
}

export async function putConfig(managed: Record<string, unknown>, apiBase = ""): Promise<SaveResponse> {
  const res = await fetch(`${apiBase}${ROUTE}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(managed),
  });
  const body = await parseJson<SaveResponse & { error?: string; errors?: { message: string }[] }>(res);
  if (!res.ok) {
    const detail = body?.errors?.map((e) => e.message).join("; ");
    throw new Error(detail || body?.error || `HTTP ${res.status}`);
  }
  return body;
}

/**
 * Is `pi-blackhole` installed? Answers from the plugin's own `/status` route
 * (design D1). Fail-open on unknown: network error, non-200 (incl. the 503 of
 * a scan failure), or a malformed body resolve to `true` so an unknown answer
 * cannot fabricate a not-installed state over a working config.
 */
export async function isExtensionInstalled(apiBase = "", signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase}${STATUS_ROUTE}`, { signal });
    const body = await parseJson<{ installed?: unknown }>(res);
    if (res.ok && typeof body?.installed === "boolean") return body.installed;
  } catch {
    // network failure — unknown, fail open
  }
  return true;
}

export type ModelsResult =
  | { kind: "ok"; models: ModelInfo[] }
  | { kind: "unavailable"; reason: string };

function extractProviderAndId(row: Record<string, unknown>): { provider: string; id: string } | null {
  if (typeof row.id !== "string" || !row.id.trim()) return null;
  const rawId = row.id.trim();
  const rawProvider = typeof row.provider === "string" ? row.provider.trim() : "";

  if (!rawProvider) {
    if (!rawId.includes("/")) return null;
    const slashIdx = rawId.indexOf("/");
    return { provider: rawId.slice(0, slashIdx), id: rawId.slice(slashIdx + 1) };
  }

  const id = rawId.startsWith(`${rawProvider}/`)
    ? rawId.slice(rawProvider.length + 1)
    : rawId;

  return id ? { provider: rawProvider, id } : null;
}

function parseModelRow(raw: unknown): ModelInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const pair = extractProviderAndId(row);
  if (!pair) return null;

  const model: ModelInfo = { provider: pair.provider, id: pair.id };
  if (typeof row.name === "string" && row.name.trim()) {
    model.name = row.name.trim();
  }
  if (typeof row.reasoning === "boolean") {
    model.reasoning = row.reasoning;
  }
  if (typeof row.vision === "boolean") {
    model.vision = row.vision;
  }
  if (typeof row.contextWindow === "number" && !Number.isNaN(row.contextWindow)) {
    model.contextWindow = row.contextWindow;
  }

  return model;
}

/**
 * Fetch available models from `GET /api/models` (design D1).
 *
 * Resolves to `{ kind: "ok", models }` or `{ kind: "unavailable", reason }` (never rejects).
 *
 * Write direction note:
 * Consumers picking from this list MUST resolve the picked row by exact match against
 * the fetched list (`models.find(m => `${m.provider}/${m.id}` === label)`), NEVER by
 * splitting `label` on `/`, as model ids may contain slashes (e.g. meta/llama-3).
 */
export async function getModels(apiBase = "", signal?: AbortSignal): Promise<ModelsResult> {
  try {
    const res = await fetch(`${apiBase}${MODELS_ROUTE}`, { signal });
    if (!res.ok) {
      return {
        kind: "unavailable",
        reason: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`,
      };
    }
    const body = await parseJson<{ object?: string; data?: unknown[] }>(res);
    if (!body || !Array.isArray(body.data)) {
      return { kind: "unavailable", reason: "Invalid model list response format" };
    }

    const models: ModelInfo[] = [];
    for (const raw of body.data) {
      const parsed = parseModelRow(raw);
      if (parsed) models.push(parsed);
    }

    return { kind: "ok", models };
  } catch (err) {
    return {
      kind: "unavailable",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
