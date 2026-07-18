/**
 * Client-side fetch helpers for the paired-devices registry (bearer device auth).
 */
import { getApiBase } from "../api/api-context.js";
import { fetchJson } from "../api/fetch-json.js";

export interface PairedDeviceView {
  id: string;
  label: string;
  createdAt: string;
  lastSeen: string | null;
}

export async function listPairedDevices(): Promise<PairedDeviceView[]> {
  const json = await fetchJson(`${getApiBase()}/api/paired-devices`);
  if (!json.success) throw new Error(json.error ?? "failed to list paired devices");
  return json.data;
}

export async function revokePairedDevice(id: string): Promise<void> {
  const json = await fetchJson(`${getApiBase()}/api/paired-devices/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!json.success) throw new Error(json.error ?? "failed to revoke device");
}
