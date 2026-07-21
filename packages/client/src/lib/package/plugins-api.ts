/**
 * Client API for /api/plugins activation endpoints.
 * See change: add-plugin-activation-ui.
 */
import { getApiBase } from "../api/api-context.js";

export interface PluginRequirementReport {
  piExtensions: { name: string; satisfied: boolean }[];
  binaries: { name: string; satisfied: boolean; resolvedPath?: string }[];
  services: { name: string; satisfied: boolean; error?: string }[];
}

export interface PluginRowStatus {
  id: string;
  displayName: string;
  enabled: boolean;
  loaded: boolean;
  error?: string;
  claims: number;
  requirements?: PluginRequirementReport;
  missingRequirements?: string[];
}

export interface PluginRow {
  id: string;
  displayName: string;
  priority: number;
  hasServer: boolean;
  hasBridge: boolean;
  hasClient: boolean;
  claims: Array<{
    slot: string;
    component?: string;
    tab?: string;
    command?: string;
    toolName?: string;
  }>;
  requires?: {
    piExtensions?: string[];
    binaries?: string[];
    services?: string[];
  } | null;
  /** Plugin ids this plugin depends on (verbatim from manifest). */
  dependsOn?: string[];
  /** Plugin ids that transitively depend on this plugin (computed). */
  dependents?: string[];
  status: PluginRowStatus | null;
}

export interface TogglePluginResult {
  restartRequired: boolean;
  cascade?: {
    enable?: string[];
    disable?: string[];
  };
}

export interface TogglePluginBlocked {
  blockers: string[];
}

export class TogglePluginBlockedError extends Error {
  constructor(public readonly blockers: string[]) {
    super(`Cannot enable plugin: missing deps ${blockers.join(", ")}`);
    this.name = "TogglePluginBlockedError";
  }
}

/**
 * Persist a partial plugin config via the canonical route.
 * `POST /api/config/plugins/:id` validates against the plugin's configSchema,
 * merges, applies defaults, persists, and broadcasts `plugin_config_update`.
 * Rejects on non-2xx (404 unknown / 409 disabled / 400 schema-invalid) so the
 * settings draft `commit()` can stay dirty + surface the error.
 * See change: fix-plugin-config-write-persistence.
 */
export async function writePluginConfig(
  id: string,
  config: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${getApiBase()}/api/config/plugins/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = String(body.error);
    } catch {
      /* empty */
    }
    throw new Error(`POST /api/config/plugins/${id} failed: ${msg}`);
  }
}

/**
 * Route a plugin `send` message: `plugin_config_write` persists via the
 * canonical REST route (returning the awaitable POST so `commit()` can reject);
 * everything else passes through to the WebSocket transport. Generic by `id` —
 * every plugin auto-handled, no per-plugin branching.
 * See change: fix-plugin-config-write-persistence.
 */
export function dispatchPluginMessage(
  msg: unknown,
  wsSend: (message: unknown) => void,
): void | Promise<void> {
  const m = msg as { type?: string; id?: string; config?: Record<string, unknown> };
  if (m?.type === "plugin_config_write" && typeof m.id === "string") {
    return writePluginConfig(m.id, m.config ?? {});
  }
  return wsSend(msg);
}

export async function listPlugins(): Promise<PluginRow[]> {
  const res = await fetch(`${getApiBase()}/api/plugins`);
  if (!res.ok) throw new Error(`GET /api/plugins failed: ${res.status}`);
  const body = (await res.json()) as { success: boolean; plugins: PluginRow[] };
  return body.plugins ?? [];
}

export async function togglePlugin(
  id: string,
  enabled: boolean,
): Promise<TogglePluginResult> {
  const res = await fetch(`${getApiBase()}/api/plugins/${encodeURIComponent(id)}/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (res.status === 409) {
    let body: { reason?: string; blockers?: string[] } = {};
    try {
      body = await res.json();
    } catch {
      /* empty */
    }
    if (body.reason === "blockers" && Array.isArray(body.blockers)) {
      throw new TogglePluginBlockedError(body.blockers);
    }
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = String(body.error);
    } catch {
      /* empty */
    }
    throw new Error(`POST /api/plugins/${id}/toggle failed: ${msg}`);
  }
  return (await res.json()) as TogglePluginResult;
}
