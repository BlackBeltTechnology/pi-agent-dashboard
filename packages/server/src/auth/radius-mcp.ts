/**
 * Radius MCP server configuration — the dashboard twin of pi 1.0.0's `/login`
 * follow-up (`InteractiveMode.offerRadiusMcpServer`): after a Radius sign-in,
 * point the Radius MCP server in the Pi-global `mcp.json` at that login
 * (`auth: { provider: "radius" }`), then reload sessions.
 *
 * Pure planning ({@link planRadiusMcp}) is separated from the I/O shell
 * ({@link readRadiusMcpStatus}, {@link configureRadiusMcp}), which gets every
 * collaborator injected so the evaluation order is testable without a server.
 * The write goes through the `mcp-client` config writer's single-entry save —
 * never a second `mcp.json` writer. Nothing here logs credentials, headers or
 * request bodies.
 *
 * See change: add-radius-provider-login (D5, D6).
 */

import type {
  ConfigWriteResult,
  EffectiveView,
  McpClientConfigService,
  ServerEntry,
} from "@blackbelt-technology/pi-dashboard-mcp-client-plugin/core";

/** pi `RADIUS_MCP_URL` (`core/radius.js`); pinned by a drift test. */
export const RADIUS_MCP_URL = "https://radius.pi.dev/mcp";

const PROVIDER_ID = "radius";

/** Stable, domain-prefixed refusal codes (client maps each to an `err.*` key). */
export const RADIUS_MCP_CODES = {
  runtimeUnavailable: "provider_auth.radius_mcp_runtime_unavailable",
  noCredential: "provider_auth.radius_mcp_no_credential",
  overridden: "provider_auth.radius_mcp_overridden",
  writeRefused: "provider_auth.radius_mcp_write_refused",
} as const;

const normalizeUrl = (url: string): string => url.replace(/\/+$/u, "");

export interface GlobalServer {
  name: string;
  entry: Record<string, unknown>;
}

export interface RadiusMcpPlan {
  /** A global entry with the Radius URL already carries `auth.provider: "radius"`. */
  configured: boolean;
  /** The entry name a configure writes. */
  name: string;
  /** The full entry to write; absent when already configured. */
  entry?: ServerEntry;
  /** True when the entry replaces a URL-matched one (vs. a new entry). */
  existing: boolean;
}

/** Port of pi's `offerRadiusMcpServer` rules. Pure. */
export function planRadiusMcp(servers: readonly GlobalServer[]): RadiusMcpPlan {
  const existing = servers.find(
    (s) => typeof s.entry.url === "string" && normalizeUrl(s.entry.url) === normalizeUrl(RADIUS_MCP_URL),
  );
  const auth = existing?.entry.auth as { provider?: unknown } | undefined;
  if (existing && auth?.provider === PROVIDER_ID) {
    return { configured: true, name: existing.name, existing: true };
  }
  let name = existing?.name ?? "radius";
  if (!existing && servers.some((s) => s.name === name)) name = "radius-mcp";
  const entry: ServerEntry = existing
    ? ({ ...existing.entry, auth: { provider: PROVIDER_ID } } as ServerEntry)
    : { url: RADIUS_MCP_URL, auth: { provider: PROVIDER_ID } };
  // `auth` replaces the MCP OAuth sign-in.
  delete entry.oauth;
  return { configured: false, name, entry, existing: existing !== undefined };
}

export type RadiusMcpService = Pick<McpClientConfigService, "getEffectiveView" | "saveServer" | "targetPath">;

export interface RadiusMcpDeps {
  /** False when the pi runtime surface (agent dir) is not loaded. */
  runtimeAvailable: () => boolean;
  /** A `radius` OAuth credential is stored in `auth.json`. */
  hasRadiusCredential: () => boolean;
  /** `models.json` declares a custom-gateway `radius`. */
  isOverridden: () => boolean;
  service: () => RadiusMcpService;
  /** Dispatch `/reload` to the fan-out targets; resolves the count that actually reloaded. */
  reload: () => Promise<number>;
}

export interface RadiusMcpResponse {
  status: number;
  body: Record<string, unknown>;
}

const refusal = (status: number, code: string, error: string, vars?: Record<string, unknown>): RadiusMcpResponse => ({
  status,
  body: { error, code, ...(vars ? { vars } : {}) },
});

const unavailable = (): RadiusMcpResponse =>
  refusal(503, RADIUS_MCP_CODES.runtimeUnavailable, "The pi runtime is not available");

const writeRefused = (reason: string, message: string): RadiusMcpResponse =>
  refusal(409, RADIUS_MCP_CODES.writeRefused, message, { reason });

/** Global entries of a view, or a refusal when the global file cannot be parsed. */
function readGlobal(view: EffectiveView): GlobalServer[] | RadiusMcpResponse {
  const layer = view.layers.find((l) => l.layer === "pi-global");
  if (layer && layer.exists && !layer.ok) {
    return writeRefused("unparseable", layer.message ?? "mcp.json is not parseable");
  }
  return view.servers
    .filter((s) => s.provenance === "pi-global")
    .map((s) => ({ name: s.name, entry: s.entry }));
}

const isResponse = (v: GlobalServer[] | RadiusMcpResponse): v is RadiusMcpResponse => !Array.isArray(v);

/** `GET /api/provider-auth/radius/mcp`. */
export function readRadiusMcpStatus(deps: RadiusMcpDeps): RadiusMcpResponse {
  if (!deps.runtimeAvailable()) return unavailable();
  const service = deps.service();
  const servers = readGlobal(service.getEffectiveView({ kind: "global" }));
  if (isResponse(servers)) return servers;
  const plan = planRadiusMcp(servers);
  return {
    status: 200,
    body: { configured: plan.configured, name: plan.name, path: service.targetPath({ kind: "global" }) },
  };
}

/** `POST /api/provider-auth/radius/mcp` — refusals first, then no-op, then write. */
export async function configureRadiusMcp(deps: RadiusMcpDeps): Promise<RadiusMcpResponse> {
  if (!deps.runtimeAvailable()) return unavailable();
  if (!deps.hasRadiusCredential()) {
    return refusal(409, RADIUS_MCP_CODES.noCredential, "Sign in to Radius first");
  }
  if (deps.isOverridden()) {
    return refusal(
      409,
      RADIUS_MCP_CODES.overridden,
      "models.json configures a custom Radius gateway; the default Radius MCP server does not apply",
    );
  }
  const service = deps.service();
  const servers = readGlobal(service.getEffectiveView({ kind: "global" }));
  if (isResponse(servers)) return servers;
  const plan = planRadiusMcp(servers);
  if (plan.configured || !plan.entry) {
    return { status: 200, body: { configured: true, written: false, name: plan.name } };
  }
  let result: ConfigWriteResult;
  try {
    result = service.saveServer(
      plan.name,
      plan.entry,
      { kind: "global" },
      plan.existing ? undefined : { create: true },
    );
  } catch (err) {
    return writeRefused("write-failed", err instanceof Error ? err.message : "write failed");
  }
  if (!result.ok) return writeRefused(result.refusal.code, result.refusal.message);
  const reloaded = await deps.reload();
  return { status: 200, body: { configured: true, written: true, name: plan.name, reloaded } };
}

export type ReloadOutcome = "respawn" | "forwarded" | "refused" | "error" | (string & {});

/**
 * Dispatch `/reload` to every target; count only targets that actually reloaded
 * (`respawn` | `forwarded`). A rejected dispatch is logged by session id (never
 * the error payload's content beyond its message) and not counted.
 */
export async function countReloads(
  targets: readonly string[],
  dispatch: (sessionId: string) => Promise<ReloadOutcome>,
  logError: (message: string) => void = (m) => console.error(m),
): Promise<number> {
  let count = 0;
  for (const sid of targets) {
    try {
      const outcome = await dispatch(sid);
      if (outcome === "respawn" || outcome === "forwarded") count += 1;
    } catch (err) {
      logError(
        `[provider-auth] radius mcp reload failed for session ${sid}: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }
  return count;
}
