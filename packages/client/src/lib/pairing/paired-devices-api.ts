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
  /** How the token was issued (mirror of the server-side field). */
  source: "pairing" | "manual";
}

/** Plaintext-once result of direct issuance — the token is never retrievable again. */
export interface MintedDeviceToken {
  device: PairedDeviceView;
  token: string;
}

export async function listPairedDevices(): Promise<PairedDeviceView[]> {
  const json = await fetchJson(`${getApiBase()}/api/paired-devices`);
  if (!json.success) throw new Error(json.error ?? "failed to list paired devices");
  return json.data;
}

/**
 * Mint a device token for an MCP client via `POST /api/paired-devices` (D6).
 * The plaintext token rides this ONE response; the row shows up in the list
 * without it, marked `source: "manual"`.
 */
export async function createPairedDevice(label: string): Promise<MintedDeviceToken> {
  const json = await fetchJson(`${getApiBase()}/api/paired-devices`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label }),
  });
  if (!json.success) throw new Error(json.error ?? "failed to mint device token");
  return json.data;
}

export async function revokePairedDevice(id: string): Promise<void> {
  const json = await fetchJson(`${getApiBase()}/api/paired-devices/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!json.success) throw new Error(json.error ?? "failed to revoke device");
}
