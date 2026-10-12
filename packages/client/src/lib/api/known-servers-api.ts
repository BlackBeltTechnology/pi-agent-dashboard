/**
 * Client-side fetch helpers for known servers management.
 */
import type {
  DiscoveredServerInfo,
  KnownServerListEntry,
  KnownServerProbeStatus,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getApiBase } from "./api-context.js";
import { fetchJson } from "./fetch-json.js";

export async function listKnownServers(): Promise<KnownServerListEntry[]> {
  return (await listKnownServersWithAccess()).servers;
}

/** The list plus whether the caller holds an operator credential (`canManage`). */
export async function listKnownServersWithAccess(): Promise<{ servers: KnownServerListEntry[]; canManage: boolean }> {
  const json = await fetchJson(`${getApiBase()}/api/known-servers`);
  if (!json.success) throw new Error(json.error ?? "failed to list known servers");
  return { servers: json.data, canManage: json.canManage === true };
}

/** `fingerprint` is a hint only — the server pins it solely when its challenge proves it. */
export async function addKnownServer(
  host: string,
  port: number,
  label?: string,
  fingerprint?: string,
): Promise<{ updated: boolean }> {
  const json = await fetchJson(`${getApiBase()}/api/known-servers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host, port, ...(label ? { label } : {}), ...(fingerprint ? { fingerprint } : {}) }),
  });
  if (!json.success) throw new Error(json.error ?? "failed to add server");
  return { updated: json.data?.updated === true };
}

/**
 * Server-side reachability of a known entry (operator-only). A transport
 * failure or refusal returns `null` — callers render "Unreachable".
 */
export async function probeKnownServer(host: string, port: number): Promise<KnownServerProbeStatus | null> {
  try {
    const json = await fetchJson(`${getApiBase()}/api/known-servers/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, port }),
    });
    return json.success ? (json.data?.status ?? null) : null;
  } catch {
    return null;
  }
}

/** Accept the verified move suggestion of the entry stored at `host:port`. `null` on refusal/failure. */
export async function acceptKnownServerMove(host: string, port: number): Promise<boolean | null> {
  try {
    const json = await fetchJson(`${getApiBase()}/api/known-servers/accept-move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, port }),
    });
    return json.success === true ? true : null;
  } catch {
    return null;
  }
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
