/**
 * Client-side fetch helpers for the tool-registry REST API.
 *
 * Endpoints:
 *   GET    /api/tools
 *   GET    /api/tools/:name
 *   POST   /api/tools/rescan              body: { name? }
 *   PUT    /api/tools/:name               body: { path }
 *   DELETE /api/tools/:name
 *   POST   /api/tools/diagnostics         → text/plain
 *
 * See change: consolidate-tool-resolution (specs/tool-settings-ui).
 */
import type { Resolution } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/types.js";
import { getApiBase } from "./api-context.js";

export type { Resolution } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/types.js";

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getApiBase()}${url}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 404) throw new Error(await res.text());
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "request failed");
  return json.data as T;
}

export async function fetchTools(): Promise<Resolution[]> {
  const res = await fetch(`${getApiBase()}/api/tools`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "failed to list tools");
  return (json.data as { tools: Resolution[] }).tools;
}

export async function fetchTool(name: string): Promise<Resolution> {
  const res = await fetch(`${getApiBase()}/api/tools/${encodeURIComponent(name)}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "failed to fetch tool");
  return json.data as Resolution;
}

/** Rescan all tools. */
export async function rescanAll(): Promise<Resolution[]> {
  const data = await post<{ tools: Resolution[] }>("/api/tools/rescan", {});
  return data.tools;
}

/** Rescan one tool. */
export async function rescanOne(name: string): Promise<Resolution[]> {
  const data = await post<{ tools: Resolution[] }>("/api/tools/rescan", { name });
  return data.tools;
}

export async function setOverride(name: string, path: string): Promise<Resolution> {
  const res = await fetch(`${getApiBase()}/api/tools/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "failed to set override");
  return json.data as Resolution;
}

export async function clearOverride(name: string): Promise<Resolution> {
  const res = await fetch(`${getApiBase()}/api/tools/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "failed to clear override");
  return json.data as Resolution;
}

/**
 * Fetch the text/plain diagnostics export. Caller is responsible for
 * triggering a download (see `downloadDiagnostics`).
 */
export async function exportDiagnostics(): Promise<string> {
  const res = await fetch(`${getApiBase()}/api/tools/diagnostics`, { method: "POST" });
  if (!res.ok) throw new Error(`diagnostics export failed: ${res.status}`);
  return res.text();
}

/** Browser-side helper: fetch diagnostics + trigger download as .txt. */
export async function downloadDiagnostics(
  filename = "pi-dashboard-tools.txt",
): Promise<void> {
  const text = await exportDiagnostics();
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
