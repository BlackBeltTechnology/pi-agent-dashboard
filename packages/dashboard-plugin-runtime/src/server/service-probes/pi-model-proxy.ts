/**
 * Service probe for `pi-model-proxy`.
 *
 * Plugins declare `requires.services: ["pi-model-proxy"]` and the
 * dashboard runtime probes it once for every consumer.
 *
 * `detectPiModelProxy` returns `{ installed, reachable, models, error? }`.
 * The simpler "is it reachable?" answer needed by the requirements model
 * is exposed via `probePiModelProxy`.
 *
 * See change: add-plugin-activation-ui (Layer 1.5, task 12).
 */

const PROXY_PACKAGE_ID = "@blackbelt-technology/pi-model-proxy";
const PROXY_MODELS_URL = "http://localhost:9876/v1/models";

export interface ProxyDetection {
  installed: boolean;
  reachable: boolean;
  models: string[];
  error?: string;
}

/**
 * Full installed + reachable probe.
 *
 * Caller passes a `fetch`-equivalent so tests can mock cleanly.
 */
export async function detectPiModelProxy(deps: {
  /** Base URL of the running dashboard server (defaults to same origin). */
  dashboardOrigin?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<ProxyDetection> {
  const f = deps.fetchImpl ?? fetch;
  const origin = deps.dashboardOrigin ?? "http://localhost:8000";
  let installed = false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    const res = await f(`${origin}/api/packages/installed`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { packages?: Array<{ id?: string; name?: string }> }
        | null;
      const list = body?.packages ?? [];
      installed = list.some(
        (p) => p?.id === PROXY_PACKAGE_ID || p?.name === PROXY_PACKAGE_ID,
      );
    }
  } catch {
    /* installed remains false */
  }

  let reachable = false;
  let models: string[] = [];
  let error: string | undefined;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    const res = await f(PROXY_MODELS_URL, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { data?: Array<{ id?: string }> }
        | null;
      reachable = true;
      models = (body?.data ?? [])
        .map((m) => m?.id)
        .filter((id): id is string => typeof id === "string");
    } else {
      error = `HTTP ${res.status}`;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { installed, reachable, models, error };
}

/**
 * Simple reachability probe used by `requirement-probes.ts` to answer
 * "is pi-model-proxy currently running?". Returns satisfied iff the
 * `/v1/models` endpoint responds successfully.
 */
export async function probePiModelProxy(deps: {
  fetchImpl?: typeof fetch;
} = {}): Promise<{ satisfied: boolean; error?: string }> {
  const f = deps.fetchImpl ?? fetch;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    const res = await f(PROXY_MODELS_URL, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { satisfied: false, error: `HTTP ${res.status}` };
    return { satisfied: true };
  } catch (e) {
    return { satisfied: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Model-preference ordering for the proxy.
export const PROXY_MODEL_PREFERENCE: readonly string[] = [
  "anthropic/claude-haiku-4-5",
  "anthropic/claude-haiku-3-5-20241022",
  "openai/gpt-4o-mini",
  "google/gemini-2.5-flash",
];

export function pickProxyDefaultModel(reportedModels: string[]): string | null {
  for (const pref of PROXY_MODEL_PREFERENCE) {
    if (reportedModels.includes(pref)) return pref;
  }
  return reportedModels[0] ?? null;
}
