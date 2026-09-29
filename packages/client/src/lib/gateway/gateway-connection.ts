/**
 * Pure state for the Setup Connect/Disconnect toggle.
 *
 * The toggle reflects what THIS server connected (`connectedProviders` on the
 * gated status detail), not readiness: an OS-level tailscale daemon reads
 * `connected` on the readiness board although the Gateway never connected it,
 * which would pin the toggle to "Disconnect". No I/O.
 */
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

/** Toolbar Gateway indicator. `unset`: nothing set up; `off`: set up, none connected. */
export interface GatewayIndicator {
  tone: "ok" | "partial" | "off" | "unset";
  title: string;
}

/**
 * Toolbar colour + title across EVERY planned provider (`gateway` counts), not
 * only zrok: a tailscale-only Gateway is up even when zrok is absent. Older
 * servers without counts fall back to the zrok status.
 */
export function gatewayIndicator(status: TunnelStatus | null): GatewayIndicator {
  const g = status?.gateway;
  if (g && g.expected > 0) {
    const counts = `${g.connected}/${g.expected} connected`;
    if (g.connected === g.expected) return { tone: "ok", title: `Gateway: ${counts} (click to open)` };
    if (g.connected > 0) return { tone: "partial", title: `Gateway: ${counts} (click to open)` };
    return { tone: "off", title: `Gateway: ${counts} (click to connect)` };
  }
  if (status?.status === "active") return { tone: "ok", title: `Gateway: ${status.url} (click to open)` };
  if (status?.status === "inactive") return { tone: "off", title: "Gateway: disconnected (click to configure)" };
  return { tone: "unset", title: status ? "Gateway: not set up (click for setup)" : "Gateway status" };
}
