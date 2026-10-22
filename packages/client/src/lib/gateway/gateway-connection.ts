/**
 * Pure state for the Setup Connect/Disconnect toggle.
 *
 * The toggle reflects what THIS server connected (`connectedProviders` on the
 * gated status detail), not readiness: an OS-level tailscale daemon reads
 * `connected` on the readiness board although the Gateway never connected it,
 * which would pin the toggle to "Disconnect". No I/O.
 */
import { isLoopbackIpv4 } from "@blackbelt-technology/pi-dashboard-shared/bind-reachability.js";
import type {
  GatewayProviderState,
  TunnelStatus,
  TunnelStatusDetail,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

export interface GatewayToggle {
  action: "connect" | "disconnect";
  /** Providers this server holds, for the status line. */
  connected: string[];
  /** Non-null → the button is disabled and this is its reason. */
  disabledReason: string | null;
  /** Every planned provider with its state + reason (empty on older servers). */
  rows: GatewayProviderState[];
  /** Some planned providers are up and some are not. */
  partial: boolean;
}

export function gatewayToggle(status: TunnelStatusDetail | null, dirty: boolean): GatewayToggle {
  // Older servers omit the list; their only tunnel is zrok.
  const connected = status?.connectedProviders ?? (status?.status === "active" ? ["zrok"] : []);
  const rows = status?.providers ?? [];
  const partial = connected.length > 0 && rows.some((r) => r.state !== "connected");
  if (connected.length > 0) return { action: "disconnect", connected, disabledReason: null, rows, partial };
  return {
    action: "connect",
    connected,
    disabledReason: dirty ? "Save the provider/mode change before connecting." : null,
    rows,
    partial,
  };
}

/**
 * The provider's admin-approval link, or null. It is CLI output relayed by the
 * server, so only an https link to the tailscale admin host is ever rendered
 * as an href — never another host or scheme (`javascript:`).
 */
export function safeApprovalUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "login.tailscale.com" ? u.href : null;
  } catch {
    return null;
  }
}

/** Toolbar Remote access state, highest precedence first. */
export type RemoteAccessTone = "failed" | "partial" | "internet" | "network" | "local";

export interface RemoteAccessIndicator {
  tone: RemoteAccessTone;
  /** Full accessible name / title: `Remote access: <state>[, N device(s) waiting]`. */
  title: string;
  /** Bare state phrase (no `Remote access:` prefix, no waiting suffix). */
  state: string;
}

const REMOTE_ACCESS_STATE: Record<RemoteAccessTone, string> = {
  failed: "a connection failed",
  partial: "partly online",
  internet: "internet on",
  network: "listening on the network",
  local: "this computer only",
};

/**
 * Loopback-only bind host. `0.0.0.0` and `::` are ALL interfaces, not loopback.
 * The one definition — the step engine, the landing roads and the toolbar dot
 * must agree, so a malformed `127.x` host cannot read differently in each.
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "localhost" || h === "::1" || h === "[::1]" || isLoopbackIpv4(h);
}

/**
 * Toolbar dot + title for the Remote access button. Precedence
 * failed > partial > internet > network > this computer only.
 *
 * Tunnel states come from `gateway` counts across EVERY planned provider (a
 * tailscale-only gateway is up even when zrok is absent; older servers without
 * counts fall back to the zrok status). `failed` needs the gated `providers`
 * list — the ungated counts cannot tell a failure from an idle provider.
 * `bindHost` is the RUNNING server's resolved bind host, or `null` when it
 * cannot be read: then the dot reflects only the tunnel states and the title
 * says so, never "this computer only".
 *
 * See change: add-remote-access-wizard (design D8).
 */
export function remoteAccessIndicator(
  tunnel: TunnelStatus | TunnelStatusDetail | null,
  bindHost: string | null,
  waiting = 0,
): RemoteAccessIndicator {
  const g = tunnel?.gateway;
  const providers = (tunnel as TunnelStatusDetail | null)?.providers ?? [];
  const failed = providers.some((p) => p.state === "failed" || p.state === "dropped");
  let tone: RemoteAccessTone;
  if (failed) tone = "failed";
  else if (g && g.expected > 0 && g.connected > 0 && g.connected < g.expected) tone = "partial";
  else if ((g && g.expected > 0 && g.connected === g.expected) || (!g && tunnel?.status === "active")) tone = "internet";
  else if (bindHost !== null && !isLoopbackHost(bindHost)) tone = "network";
  else tone = "local";
  const state = tone === "local" && bindHost === null ? "network status unknown" : REMOTE_ACCESS_STATE[tone];
  const suffix = waiting > 0 ? `, ${waiting} ${waiting === 1 ? "device" : "devices"} waiting` : "";
  return { tone, state, title: `Remote access: ${state}${suffix}` };
}
