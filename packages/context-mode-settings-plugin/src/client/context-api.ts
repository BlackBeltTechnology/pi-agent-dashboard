/**
 * Thin REST client for the context-mode settings endpoints (same-origin).
 * See change: add-context-mode-settings-plugin.
 */
interface FieldView {
  value: unknown;
  default: unknown;
  isDefault: boolean;
}

export interface EffectiveSettings {
  filePath: string;
  exists: boolean;
  raw: Record<string, unknown>;
  fields: Record<string, FieldView>;
}

const ROUTE = "/api/plugins/context-mode-settings/config";

async function parseJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as T & { error?: string; errors?: { key: string; error: string }[] };
  if (!res.ok) {
    const detail = json?.errors?.map((e) => `${e.key}: ${e.error}`).join("; ");
    throw new Error(detail || json?.error || `HTTP ${res.status}`);
  }
  return json;
}

export async function getSettings(apiBase = "", signal?: AbortSignal): Promise<EffectiveSettings> {
  return parseJson<EffectiveSettings>(await fetch(`${apiBase}${ROUTE}`, { signal }));
}

export async function putSettings(full: Record<string, unknown>, apiBase = ""): Promise<EffectiveSettings> {
  const res = await fetch(`${apiBase}${ROUTE}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(full),
  });
  return parseJson<EffectiveSettings>(res);
}
