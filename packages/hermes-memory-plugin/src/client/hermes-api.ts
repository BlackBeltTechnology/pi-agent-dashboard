/**
 * Thin REST client for the hermes-memory config endpoints.
 *
 * Same-origin relative `/api/plugins/hermes-memory/config` URLs (matching the
 * kb/goal plugin convention). The routes return plain JSON — the effective
 * shape on success, `{ error, errors }` on a 400 — so responses are read
 * directly with a content-type guard.
 *
 * See change: add-hermes-memory-settings-plugin.
 */

/** Per-field effective view returned by GET. */
export interface FieldView {
  value: unknown;
  default: unknown;
  isDefault: boolean;
}

/** Response shape of GET (and the PUT success echo). */
export interface EffectiveConfig {
  filePath: string;
  exists: boolean;
  raw: Record<string, unknown>;
  fields: Record<string, FieldView>;
}

const ROUTE = "/api/plugins/hermes-memory/config";

async function parseJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
  }
  const json = (await res.json()) as T & { error?: string; errors?: { field: string; message: string }[] };
  if (!res.ok) {
    const detail = json?.errors?.map((e) => e.message).join("; ");
    throw new Error(detail || json?.error || `HTTP ${res.status}`);
  }
  return json;
}

export async function getConfig(apiBase = "", signal?: AbortSignal): Promise<EffectiveConfig> {
  const res = await fetch(`${apiBase}${ROUTE}`, { signal });
  return parseJson<EffectiveConfig>(res);
}

export async function putConfig(full: Record<string, unknown>, apiBase = ""): Promise<EffectiveConfig> {
  const res = await fetch(`${apiBase}${ROUTE}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(full),
  });
  return parseJson<EffectiveConfig>(res);
}
