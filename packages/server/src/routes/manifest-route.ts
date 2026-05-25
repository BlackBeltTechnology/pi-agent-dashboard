/**
 * Dynamic /manifest.json route.
 *
 * Serves a PWA web-app manifest whose `name` and `short_name` vary by
 * server identity, so the same dashboard installed as a PWA from multiple
 * origins (LAN host, tunnel, loopback) shows distinct labels on the
 * launcher. See change: add-dynamic-pwa-manifest-naming.
 *
 * Resolution order for the name `<source>`:
 *   1. `config.dashboardName` (user override; trimmed)
 *   2. Request `Host` header with port stripped (IPv6-safe)
 *   3. `os.hostname()`
 *   4. Literal `"Pi-Dash"`
 *
 * Final manifest fields:
 *   name       = `Pi-Dash \u00b7 ${source}`
 *   short_name = source.slice(0, 12)
 *   id         = "/"
 *
 * All other fields (icons, theme/background color, display, start_url)
 * are spread from the static `manifest.json` shipped in the client bundle.
 *
 * This route is registered BEFORE `@fastify/static` so explicit Fastify
 * route matching wins over the on-disk static asset.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/**
 * Strip the trailing port from a Host header.
 *
 * Handles:
 *   - bare hostnames (`mybox.local`)
 *   - host:port (`mybox.local:8000`)
 *   - bracketed IPv6 with port (`[::1]:8000`)
 *   - bracketed IPv6 without port (`[::1]`)
 *   - empty / undefined input → empty string
 *
 * Lower-cases the result so casing differences across requests don't
 * produce ostensibly distinct labels.
 */
export function stripPort(host: string | undefined | null): string {
  if (!host) return "";
  const trimmed = host.trim();
  if (!trimmed) return "";

  // Bracketed IPv6: "[::1]" or "[::1]:8000"
  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    if (close > 0) return trimmed.slice(1, close).toLowerCase();
    // Malformed — drop bracket, return as-is
    return trimmed.slice(1).toLowerCase();
  }

  // host:port — last colon, but only if there's exactly one colon
  // (bare IPv6 like "::1" has multiple colons; we leave it untouched
  //  since unbracketed IPv6 in a Host header is non-conformant anyway).
  const firstColon = trimmed.indexOf(":");
  const lastColon = trimmed.lastIndexOf(":");
  if (firstColon === lastColon && firstColon > 0) {
    return trimmed.slice(0, firstColon).toLowerCase();
  }
  return trimmed.toLowerCase();
}

/**
 * Resolve the `<source>` string used to build manifest `name` / `short_name`.
 *
 * Pure — no fs or process access. Pass `hostname` explicitly so tests can
 * control it.
 */
export function resolveManifestSource(
  hostHeader: string | undefined | null,
  configDashboardName: string | undefined | null,
  hostname: string,
): string {
  const override = (configDashboardName ?? "").trim();
  if (override) return override;

  const fromHost = stripPort(hostHeader);
  if (fromHost) return fromHost;

  const fromHostname = (hostname ?? "").trim();
  if (fromHostname) return fromHostname;

  return "Pi-Dash";
}

/**
 * Build the dynamic manifest body. Spreads the static base, overrides
 * `name`/`short_name`/`id`. Pure given a `staticBase`.
 */
export function buildManifestBody(
  staticBase: Record<string, unknown>,
  source: string,
): Record<string, unknown> {
  return {
    ...staticBase,
    id: "/",
    name: `Pi-Dash \u00b7 ${source}`,
    short_name: source.slice(0, 12) || "Pi-Dash",
  };
}

/**
 * Load the static manifest JSON shipped in the client bundle. Returns an
 * empty object if missing or unparseable (route still serves a valid
 * minimal manifest in that case).
 *
 * Synchronous + cached — manifest content is immutable per server build.
 */
export function loadStaticManifest(clientDir: string): Record<string, unknown> {
  if (!clientDir) return {};
  try {
    const manifestPath = path.join(clientDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) return {};
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export interface ManifestRouteDeps {
  /** Resolved client-dist directory (where the static manifest.json lives). */
  clientDir: string;
  /** Lazy accessor for the *latest* dashboard config — re-read per request
   *  so Settings panel changes propagate without a server restart. */
  getDashboardName: () => string | undefined;
}

/**
 * Register `GET /manifest.json` on the given Fastify instance.
 *
 * MUST be called BEFORE `fastify.register(fastifyStatic, ...)`. Explicit
 * routes win over the static plugin's fallback handler.
 */
export function registerManifestRoute(
  fastify: FastifyInstance,
  deps: ManifestRouteDeps,
): void {
  const staticBase = loadStaticManifest(deps.clientDir);
  const hostname = os.hostname();

  fastify.get("/manifest.json", async (request, reply) => {
    const source = resolveManifestSource(
      typeof request.headers.host === "string" ? request.headers.host : "",
      deps.getDashboardName(),
      hostname,
    );
    const body = buildManifestBody(staticBase, source);
    reply.header("Content-Type", "application/manifest+json; charset=utf-8");
    reply.header("Cache-Control", "no-cache, must-revalidate");
    return body;
  });
}
