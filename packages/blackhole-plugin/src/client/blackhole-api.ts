/**
 * Thin REST client for the blackhole config endpoints plus the installed-ness
 * probe.
 *
 * Installed-ness comes from `GET /api/plugins` — pi's package registry as the
 * host's own requirement probes report it — NOT from the presence of blackhole's
 * directory or config file, which the extension creates on first run and which
 * therefore only means "has run at least once" (spec: installed-ness comes from
 * the package registry).
 *
 * See change: add-blackhole-plugin.
 */

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
const PLUGIN_ID = "blackhole";
const EXTENSION_ID = "pi-blackhole";

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

interface PluginRow {
  id: string;
  status: { missingRequirements?: string[] } | null;
}

/**
 * Is `pi-blackhole` present in pi's installed-package registry? Answers from the
 * host's own requirement report. A probe that has not reported yet (or a plugin
 * row the host does not know) resolves to `true` — an unknown answer must not
 * fabricate a not-installed state over a working config.
 */
export async function isExtensionInstalled(apiBase = "", signal?: AbortSignal): Promise<boolean> {
  const res = await fetch(`${apiBase}/api/plugins`, { signal });
  const body = await parseJson<{ plugins?: PluginRow[] }>(res);
  const row = body.plugins?.find((p) => p.id === PLUGIN_ID);
  const missing = row?.status?.missingRequirements;
  if (!Array.isArray(missing)) return true;
  return !missing.some((m) => m === EXTENSION_ID || m.includes(EXTENSION_ID));
}
