/**
 * Provider abstraction for the dashboard tunnel ("Gateway" in the UI).
 *
 * A tunnel can be created by any of several providers (zrok, ngrok,
 * tailscale, zerotier) through one seam. Provider-neutral lifecycle
 * (PID files, spawn timeout/retry, health watchdog, orphan scavenge)
 * lives in the server core; provider-specific behaviour (binary name,
 * spawn args, URL parsing, enrollment check, teardown) lives in each
 * `TunnelProvider` implementation.
 *
 * Internal identifiers stay `tunnel`; the UI relabels to "Gateway".
 * See change: add-tunnel-providers.
 */

/** The four shipped providers. */
export type TunnelProviderId = "zrok" | "ngrok" | "tailscale" | "zerotier";

/**
 * Lifecycle model. `child` — the tunnel IS a child process the server owns
 * and kills (PID file + watchdog apply). `daemon` — the tunnel is state on a
 * long-lived daemon the server does NOT own; connect/disconnect are
 * idempotent control commands and the URL is read back from the daemon's
 * status output (no PID we own, PID-file/watchdog paths skipped).
 */
export type TunnelKind = "child" | "daemon";

/** Public reverse proxy vs private mesh. Both required-explicit when enabled. */
export type TunnelMode = "public" | "private";

/**
 * Classification of a single reachable address, driving where it may be
 * advertised. `public` — TLS reverse-proxy URL. `magicdns` — a mesh name
 * (TLS only when a cert is provisioned). `mesh` — a raw mesh IP (no TLS).
 * `lan` — a same-network IP. `local` — loopback.
 */
export type EndpointKind = "public" | "mesh" | "magicdns" | "lan" | "local";

/**
 * A reachable endpoint. `tls` is the load-bearing flag: only `tls: true`
 * endpoints (https/wss) are eligible for the secure pairing payload; the
 * authoritative gate stays server-side at read time, this tag is advisory.
 */
export interface TunnelEndpoint {
  kind: EndpointKind;
  url: string;
  tls: boolean;
}

/** What a provider's `connect()` yields once the tunnel is reachable. */
export interface ProviderEndpoints {
  endpoints: TunnelEndpoint[];
}

/** Health/liveness snapshot a provider reports via `status()`. */
export interface ProviderStatus {
  /** Active when at least one endpoint is currently reachable. */
  active: boolean;
  endpoints: TunnelEndpoint[];
  /** Provider-specific health note (surfaced by observability, never a secret). */
  health?: string;
}

/**
 * The seam. Generic lifecycle stays in the core; every method here is the
 * provider-specific slice.
 */
export interface TunnelProvider {
  readonly id: TunnelProviderId;
  readonly kind: TunnelKind;
  /** ngrok/zrok → public only; zerotier → private only; tailscale → both. */
  supportsMode(mode: TunnelMode): boolean;
  /** Binary present on PATH (via the shared ToolResolver). */
  detectBinary(): boolean;
  /** Enrolled/authenticated: zrok env | ngrok authtoken | tailscale logged-in | zt joined+authorized. */
  isEnrolled(): boolean;
  /** Bring the tunnel up for `port` in `mode`. Resolves once a URL is known. */
  connect(port: number, mode: TunnelMode, opts?: TunnelConnectOpts): Promise<ProviderEndpoints>;
  /** Tear the tunnel down for `port` (child: kill; daemon: idempotent control command). */
  disconnect(port: number): Promise<void>;
  /** Current endpoints + health. */
  status(): ProviderStatus;
}

/** Per-connect knobs (reserved tokens, timeouts) passed from config. */
export interface TunnelConnectOpts {
  /** zrok reserved share token / ngrok reserved domain, provider-interpreted. */
  reservedToken?: string;
  /**
   * zrok v2 reserved NAME (namespaces + names). Served as
   * `-n public:<name>` → stable `<name>.shares.zrok.io`. Distinct from the
   * legacy v1 `reservedToken` (which the v2 provider ignores). See change:
   * support-zrok-v2.
   */
  reservedName?: string;
  /**
   * zrok v2 persistence opt-in. When true and no `reservedName` is stored,
   * the provider mints one on connect; false → ephemeral rotating URL.
   */
  persistent?: boolean;
  /** Override the spawn/URL-discovery timeout (ms). */
  timeoutMs?: number;
}

/** Static capability matrix — the single source of truth for supportsMode. */
export const PROVIDER_MODES: Record<TunnelProviderId, readonly TunnelMode[]> = {
  zrok: ["public"],
  ngrok: ["public"],
  tailscale: ["public", "private"],
  zerotier: ["private"],
} as const;

/** Lifecycle model per provider — drives PID/watchdog gating in the core. */
export const PROVIDER_KIND: Record<TunnelProviderId, TunnelKind> = {
  zrok: "child",
  ngrok: "child",
  tailscale: "daemon",
  zerotier: "daemon",
} as const;

/** True when `provider` supports `mode` per the static matrix. */
export function providerSupportsMode(provider: TunnelProviderId, mode: TunnelMode): boolean {
  return PROVIDER_MODES[provider].includes(mode);
}

/**
 * Child-model providers run the generic PID-file + health-watchdog lifecycle;
 * daemon-model providers skip it (their tunnel is state on a daemon the server
 * does not own). The single gate the core consults to make PID/watchdog
 * provider-optional. See change: add-tunnel-providers.
 */
export function usesChildLifecycle(kind: TunnelKind): boolean {
  return kind === "child";
}
