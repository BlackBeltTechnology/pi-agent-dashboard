/**
 * Client-side provider matrix metadata (mirrors the server `TunnelProvider`
 * capability flags). Drives the Setup segmented controls: which providers
 * exist, which modes each supports, and the human label.
 *
 * See change: add-tunnel-providers.
 */
import type { TunnelMode } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";

export type GatewayProviderId = "zrok" | "ngrok" | "tailscale" | "zerotier";

export interface GatewayProviderMeta {
  id: GatewayProviderId;
  label: string;
  /** Modes this provider supports (public reverse-proxy / private mesh). */
  modes: TunnelMode[];
  /** Short tagline for the mode sub-labels. */
  hint: string;
}

export const GATEWAY_PROVIDERS: GatewayProviderMeta[] = [
  { id: "zrok", label: "zrok", modes: ["public"], hint: "public reverse proxy" },
  { id: "ngrok", label: "ngrok", modes: ["public"], hint: "public reverse proxy" },
  { id: "tailscale", label: "tailscale", modes: ["public", "private"], hint: "mesh VPN — both modes" },
  { id: "zerotier", label: "zerotier", modes: ["private"], hint: "private mesh only" },
];

export function providerMeta(id: GatewayProviderId): GatewayProviderMeta {
  const m = GATEWAY_PROVIDERS.find((p) => p.id === id);
  if (!m) throw new Error(`unknown gateway provider: ${id}`);
  return m;
}

/** Whether a provider supports a mode (public/private). */
export function supportsMode(id: GatewayProviderId, mode: TunnelMode): boolean {
  return providerMeta(id).modes.includes(mode);
}
