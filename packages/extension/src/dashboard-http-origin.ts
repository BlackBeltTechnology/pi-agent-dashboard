/**
 * The HTTP origin a REMOTE bridge uses for its `/api/*` calls: ticket mint,
 * server-identity challenge, live trust query.
 *
 * A bridge dials the pi gateway (`PI_DASHBOARD_URL=ws://host:9999`), but the
 * gateway serves bridge WebSockets only; `/api/*` lives on the dashboard HTTP
 * listener (default 8000). Deriving the HTTP origin from the gateway port
 * answered `426` on the mint and read as a revoked credential.
 *
 * Pure: `env` is an argument, never read from `process.env` here, and the
 * bridge machine's own `~/.pi/dashboard/config.json` is deliberately NOT
 * consulted — it describes the local dashboard, not the remote one.
 *
 * Precedence (design D1):
 *   0. `PI_DASHBOARD_HTTP_URL` set but invalid → `bad-http-url`, for every endpoint
 *   1. valid override, in scope (endpoint host == `PI_DASHBOARD_URL` host or override host)
 *   2. plaintext `ws:` with an explicit port → endpoint host + HTTP port env/default
 *   3. `wss:` or port-less `ws:` → endpoint origin with the scheme swapped
 *   4. anything else → `no-http-origin`
 *
 * The bearer therefore only leaves for the endpoint's own host, except where
 * the operator explicitly named another one (step 1, scoped to their hosts).
 *
 * See change: fix-remote-bridge-ticket-origin (D1).
 */
import { resolveDashboardPorts } from "@blackbelt-technology/pi-dashboard-shared/config.js";

/** Env var naming the dashboard's HTTP origin explicitly. */
const DASHBOARD_HTTP_URL_ENV = "PI_DASHBOARD_HTTP_URL";

type HttpOriginSource = "PI_DASHBOARD_HTTP_URL" | "endpoint-host+http-port" | "endpoint-origin";

export type HttpOriginResult =
  | { ok: true; origin: string; source: HttpOriginSource }
  | { ok: false; cause: "bad-http-url" | "no-http-origin"; reason: string };

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** `origin` of a valid http(s) URL without credentials; otherwise null. */
function validOverrideOrigin(raw: string): string | null {
  const u = parseUrl(raw);
  if (!u) return null;
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username !== "" || u.password !== "") return null;
  return u.origin;
}

export function resolveDashboardHttpOrigin(endpoint: string, env: Record<string, string | undefined>): HttpOriginResult {
  const ep = parseUrl(endpoint);
  const override = env[DASHBOARD_HTTP_URL_ENV]?.trim();

  if (override) {
    const origin = validOverrideOrigin(override);
    if (!origin) {
      return {
        ok: false,
        cause: "bad-http-url",
        reason: `${DASHBOARD_HTTP_URL_ENV} is not an http(s) URL without credentials — fix or unset it`,
      };
    }
    if (ep) {
      const pinnedHost = parseUrl(env.PI_DASHBOARD_URL?.trim() ?? "")?.hostname;
      const overrideHost = parseUrl(override)?.hostname;
      if (ep.hostname === pinnedHost || ep.hostname === overrideHost) {
        return { ok: true, origin, source: "PI_DASHBOARD_HTTP_URL" };
      }
    }
  }

  if (ep && ep.protocol === "ws:" && ep.port !== "") {
    const { port } = resolveDashboardPorts(env);
    return { ok: true, origin: `http://${ep.hostname}:${port}`, source: "endpoint-host+http-port" };
  }
  if (ep && (ep.protocol === "ws:" || ep.protocol === "wss:")) {
    return {
      ok: true,
      origin: `${ep.protocol === "wss:" ? "https" : "http"}://${ep.host}`,
      source: "endpoint-origin",
    };
  }
  return { ok: false, cause: "no-http-origin", reason: `${endpoint} has no http origin` };
}
