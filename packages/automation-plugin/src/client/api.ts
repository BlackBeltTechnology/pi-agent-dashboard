/**
 * Thin REST client for the automation-plugin endpoints (plain JSON; the
 * routes return unwrapped objects). See change: add-automation-plugin.
 */
import type {
  DiscoveredAutomation,
  AutomationConfig,
  AutomationScope,
  RunRecord,
} from "../shared/automation-types.js";

const BASE = "/api/plugins/automation";

export async function listAutomations(cwd?: string): Promise<DiscoveredAutomation[]> {
  const url = cwd ? `${BASE}/list?cwd=${encodeURIComponent(cwd)}` : `${BASE}/list`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as { automations?: DiscoveredAutomation[] };
    return json.automations ?? [];
  } catch {
    return [];
  }
}

export async function listRuns(
  scope: AutomationScope,
  cwd: string | undefined,
  name?: string,
): Promise<RunRecord[]> {
  const params = new URLSearchParams({ scope });
  if (cwd) params.set("cwd", cwd);
  if (name) params.set("name", name);
  try {
    const res = await fetch(`${BASE}/runs?${params.toString()}`);
    if (!res.ok) return [];
    const json = (await res.json()) as { runs?: RunRecord[] };
    return json.runs ?? [];
  } catch {
    return [];
  }
}

export async function getRunResult(
  scope: AutomationScope,
  cwd: string | undefined,
  runId: string,
): Promise<string | null> {
  const params = new URLSearchParams({ scope, runId });
  if (cwd) params.set("cwd", cwd);
  try {
    const res = await fetch(`${BASE}/result?${params.toString()}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: string };
    return json.result ?? null;
  } catch {
    return null;
  }
}

export interface CreateAutomationBody {
  scope: AutomationScope;
  cwd?: string;
  name: string;
  config: AutomationConfig;
  promptBody?: string;
}

export async function createAutomation(
  body: CreateAutomationBody,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE}/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (res.ok && json.ok) return { ok: true };
    return { ok: false, error: json.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteAutomation(
  scope: AutomationScope,
  cwd: string | undefined,
  name: string,
): Promise<boolean> {
  const params = new URLSearchParams({ scope, name });
  if (cwd) params.set("cwd", cwd);
  try {
    const res = await fetch(`${BASE}?${params.toString()}`, { method: "DELETE" });
    if (!res.ok) return false;
    const json = (await res.json()) as { ok?: boolean };
    return json.ok ?? false;
  } catch {
    return false;
  }
}
