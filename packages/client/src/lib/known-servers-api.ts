/**
 * Client-side fetch helpers for known servers management.
 */
import type { KnownServer } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DiscoveredServerInfo } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getApiBase } from "./api-context.js";
import { fetchJson } from "./fetch-json.js";

export async function listKnownServers(): Promise<KnownServer[]> {
  const json = await fetchJson(`${getApiBase()}/api/known-servers`);
  if (!json.success) throw new Error(json.error ?? "failed to list known servers");
  return json.data;
}

export async function addKnownServer(host: string, port: number, label?: string): Promise<void> {
  const json = await fetchJson(`${getApiBase()}/api/known-servers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host, port, ...(label ? { label } : {}) }),
  });
  if (!json.success) throw new Error(json.error ?? "failed to add server");
}

export async function removeKnownServer(host: string, port: number): Promise<void> {
  const json = await fetchJson(`${getApiBase()}/api/known-servers`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host, port }),
  });
  if (!json.success) throw new Error(json.error ?? "failed to remove server");
}

export async function discoverServers(): Promise<DiscoveredServerInfo[]> {
  const json = await fetchJson(`${getApiBase()}/api/discover-servers`, { method: "POST" });
  if (!json.success) throw new Error(json.error ?? "failed to discover servers");
  return json.data;
}
