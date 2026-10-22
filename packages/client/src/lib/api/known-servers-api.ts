/**
 * Client-side fetch helpers for known servers management.
 */
import type {
  AddKnownServerRequest,
  DiscoveredServerInfo,
  KnownServerListEntry,
  KnownServerProbeResult,
  KnownServerProbeStatus,
  RemoveKnownServerRequest,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { RouteScheme } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
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

/**
 * Add a route. `fingerprint` is a hint only — the server pins it solely when its
 * challenge proves it. `scheme` defaults to `http` server-side and is sent only when given.
 * `updated` is true exactly when the add attached a NEW route to an existing entry.
 */
export async function addKnownServer(
  host: string,
  port: number,
  label?: string,
  fingerprint?: string,
  scheme?: RouteScheme,
): Promise<{ updated: boolean }> {
  const body: AddKnownServerRequest = {
    host,
    port,
    ...(scheme ? { scheme } : {}),
    ...(label ? { label } : {}),
    ...(fingerprint ? { fingerprint } : {}),
  };
  const json = await fetchJson(`${getApiBase()}/api/known-servers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!json.success) throw new Error(json.error ?? "failed to add server");
  return { updated: json.data?.updated === true };
}

/**
 * Server-side reachability of a known entry (operator-only). A transport
 * failure or refusal returns `null` — callers render "Unreachable".
 */
export async function probeKnownServer(host: string, port: number, scheme?: RouteScheme): Promise<KnownServerProbeStatus | null> {
  return (await probeKnownServerResult(host, port, scheme))?.status ?? null;
}

/** Like {@link probeKnownServer} but the full result, incl. the `fingerprint` the dashboard server proved. */
export async function probeKnownServerResult(
  host: string,
  port: number,
  scheme?: RouteScheme,
): Promise<KnownServerProbeResult | null> {
  try {
    const json = await fetchJson(`${getApiBase()}/api/known-servers/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, port, ...(scheme ? { scheme } : {}) }),
    });
    return json.success && json.data?.status ? (json.data as KnownServerProbeResult) : null;
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

/** Remove one route (and the entry when it was the last one). */
export async function removeKnownServer(host: string, port: number, scheme?: RouteScheme): Promise<void> {
  await deleteKnownServer({ host, port, ...(scheme ? { scheme } : {}) });
}

/** Remove a whole entry (every route) by its pinned fingerprint. */
export async function removeKnownServerByFingerprint(fingerprint: string): Promise<void> {
  await deleteKnownServer({ fingerprint });
}

async function deleteKnownServer(body: RemoveKnownServerRequest): Promise<void> {
  const json = await fetchJson(`${getApiBase()}/api/known-servers`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!json.success) throw new Error(json.error ?? "failed to remove server");
}

export async function discoverServers(): Promise<DiscoveredServerInfo[]> {
  const json = await fetchJson(`${getApiBase()}/api/discover-servers`, { method: "POST" });
  if (!json.success) throw new Error(json.error ?? "failed to discover servers");
  return json.data;
}
