/**
 * Client-side fetch helpers for the paired-devices registry (bearer device auth).
 */
import { getApiBase } from "../api/api-context.js";
import { fetchJson, fetchJsonResponse } from "../api/fetch-json.js";
import { getTlsListenerUrls } from "../gateway/gateway-endpoints.js";
import { getStoredTlsConfig } from "../gateway/tls-api.js";

/** Capability tier carried by a paired-device token (mirror of shared/tiers). */
export type Tier = "observe" | "control" | "operate";

export interface PairedDeviceView {
  id: string;
  label: string;
  createdAt: string;
  lastSeen: string | null;
  /** How the token was issued (mirror of the server-side field). */
  source: "pairing" | "manual";
  /** Capability tier recorded at mint. */
  tier: Tier;
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

/** What the dialog is for. Absent = an MCP client / script token (plain form). */
export type TokenPurpose = "bridge";

/** The hub refused a `purpose: "bridge"` issue off a proven channel. `httpsUrl` is the native HTTPS address, when one exists. */
type BridgeRefusal = Error & { code: "bridge_token_requires_https"; httpsUrl?: string };

/**
 * Mint a device token via `POST /api/paired-devices` (D6).
 * The plaintext token rides this ONE response; the row shows up in the list
 * without it, marked `source: "manual"`. `purpose: "bridge"` asks for a TLS-only
 * (`pi_tls_`) operate-tier bridge token; without it the body is unchanged.
 * See change: prove-vault-bridge-tls (D9).
 */
export async function createPairedDevice(label: string, tier: Tier, purpose?: TokenPurpose): Promise<MintedDeviceToken> {
  const { res, json } = await fetchJsonResponse(`${getApiBase()}/api/paired-devices`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(purpose ? { label, tier, purpose } : { label, tier }),
  });
  if (!json.success) {
    if (res.status === 403 && json.error === "bridge_token_requires_https") {
      throw Object.assign(new Error(json.error), {
        code: "bridge_token_requires_https" as const,
        httpsUrl: typeof json.httpsUrl === "string" ? json.httpsUrl : undefined,
      }) satisfies BridgeRefusal;
    }
    throw new Error(json.error ?? "failed to mint device token");
  }
  return json.data;
}

/** What the token-issue dialog needs to offer the bridge purpose. */
export interface BridgeTokenContext {
  /** This browser reached the dashboard over `https:` (the hub still decides authoritatively). */
  httpsChannel: boolean;
  /** `https://` names of the Built-in HTTPS listener; empty while unavailable or loopback-bound. */
  tlsListenerUrls: string[];
  /** `tls.acceptBridges` as stored. */
  acceptBridges: boolean;
}

/** Each source degrades alone: an unreadable one reads as "no TLS listener" / "off". */
export async function getBridgeTokenContext(): Promise<BridgeTokenContext> {
  const [tlsListenerUrls, acceptBridges] = await Promise.all([
    getTlsListenerUrls(),
    getStoredTlsConfig().then((c) => c.acceptBridges === true).catch(() => false),
  ]);
  return { httpsChannel: typeof window !== "undefined" && window.location.protocol === "https:", tlsListenerUrls, acceptBridges };
}

/**
 * The dashboard's currently reachable base URLs (loopback, LAN IPv4, configured
 * public, tunnel), so the emitted `claude mcp add` snippet works from the
 * machine that will run the agent (change: expand-mcp-tiered-surface, D8).
 */
export async function reachableUrls(): Promise<string[]> {
  const json = await fetchJson(`${getApiBase()}/api/pair/reachable-urls`);
  if (!json.success) throw new Error(json.error ?? "failed to load reachable URLs");
  return json.data;
}

export async function revokePairedDevice(id: string): Promise<void> {
  const json = await fetchJson(`${getApiBase()}/api/paired-devices/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!json.success) throw new Error(json.error ?? "failed to revoke device");
}
