/**
 * HTTP road classification (openspec add-multi-user-identity-plane, D10/D14/D24;
 * tasks 18.14 + 18.28). Maps a Fastify route PATTERN (never a concrete URL) to
 * exactly one road:
 *
 *  - `identity`        pre-auth + identity infrastructure — never gated here.
 *  - `session`         carries a session id param — exact owner equality,
 *                      applied centrally by `identity-road-gate.ts`.
 *  - `session-handler` session list / query-param / archive roads whose
 *                      handler applies the owner gate itself (per-item filter
 *                      or live-OR-archived owner lookup).
 *  - `non-session`     `{ action, resource }` for the OPTIONAL host policy (D9).
 *
 * `undefined` = unclassified ⇒ denied fail-closed when a policy is registered.
 * Totality over `ROUTE_TIERS` is asserted by `http-road-classification.test.ts`.
 *
 * Actions: `<family>.read` (GET/HEAD) / `<family>.write` (anything else) for
 * core families; plugin-owned routes are namespaced `plugin:<id>:<read|write>`
 * (D24). Resources are bounded and secret-free: `{ kind, route, pluginId? }`.
 */
import type { HostAction, HostResource } from "@blackbelt-technology/pi-dashboard-shared/identity.js";

export type HttpRoad =
  | { road: "identity" }
  | { road: "session"; param: string }
  | { road: "session-handler" }
  | { road: "non-session"; action: HostAction; resource: HostResource };

type Family =
  | "workspace"
  | "openspec"
  | "branch"
  | "files"
  | "config"
  | "providers"
  | "plugins"
  | "packages"
  | "access"
  | "gateway"
  | "system";

/** First `/api/<segment>` → core family. */
const FAMILY_BY_SEGMENT: Readonly<Record<string, Family>> = {
  // workspace: folders, directory pickers, pinned dirs
  browse: "workspace",
  "pinned-dirs": "workspace",
  // openspec
  openspec: "openspec",
  "openspec-archive": "openspec",
  // branch / git
  git: "branch",
  // files
  file: "files",
  grep: "files",
  diagram: "files",
  "reveal-in-file-manager": "files",
  "open-in-system": "files",
  "pi-resource-file": "files",
  // config / settings / preferences
  config: "config",
  preferences: "config",
  "favorite-models": "config",
  "custom-event-groups": "config",
  "canvas-types": "config",
  "auto-name-outcomes": "config",
  "pi-retry": "config",
  // providers / models
  providers: "providers",
  "provider-auth": "providers",
  models: "providers",
  "model-proxy": "providers",
  // packages / runtimes / tools
  packages: "packages",
  resources: "packages",
  "pi-resources": "packages",
  "pi-core": "packages",
  pi: "packages",
  node: "packages",
  tools: "packages",
  runtime: "packages",
  electron: "packages",
  // access / trust / pairing records
  access: "access",
  auth: "access",
  "paired-devices": "access",
  "host-gate": "access",
  // gateway: tunnel, pairing handshake, discovery, push
  tunnel: "gateway",
  "tunnel-connect": "gateway",
  "tunnel-disconnect": "gateway",
  "tunnel-status": "gateway",
  "tunnel-status-detail": "gateway",
  "tunnel-readiness": "gateway",
  "tunnel-reserved-name": "gateway",
  pair: "gateway",
  "known-servers": "gateway",
  "discover-servers": "gateway",
  "network-interfaces": "gateway",
  push: "gateway",
  // system
  restart: "system",
  shutdown: "system",
  doctor: "system",
  "spawn-failures": "system",
  "live-server": "system",
};

const IDENTITY_ROUTES: ReadonlySet<string> = new Set(["/api/health", "/api/ws-ticket"]);

const verbOf = (method: string): "read" | "write" =>
  method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD" ? "read" : "write";

const core = (family: Family, method: string, route: string): HttpRoad => ({
  road: "non-session",
  action: `${family}.${verbOf(method)}`,
  resource: { kind: family === "plugins" ? "plugin" : family, route },
});

const plugin = (pluginId: string, method: string, route: string): HttpRoad => ({
  road: "non-session",
  action: `plugin:${pluginId}:${verbOf(method)}`,
  resource: { kind: "plugin", pluginId, route },
});

/**
 * Classify an `/api/*` route pattern. Non-`/api` routes return `undefined`.
 * `ownerOf` = the plugin that registered the route (`route-owner-registry.ts`),
 * so plugin routes outside `/api/plugins/<id>/` are namespaced without core
 * naming any plugin.
 */
export function classifyHttpRoad(
  method: string,
  route: string,
  ownerOf?: (route: string) => string | undefined,
): HttpRoad | undefined {
  if (!route.startsWith("/api/")) return undefined;
  if (IDENTITY_ROUTES.has(route) || route.startsWith("/api/identity/")) return { road: "identity" };

  const segs = route.slice("/api/".length).split("/");
  const [seg, second] = segs;

  // ── session roads ────────────────────────────────────────────────────────
  if (seg === "session") {
    if (second === ":id") return { road: "session", param: "id" };
    if (second === "spawn") return core("workspace", method, route);
    return undefined;
  }
  if (seg === "sessions") {
    if (second === ":sessionId") return { road: "session", param: "sessionId" };
    return { road: "session-handler" }; // list, archived list, archived/:id
  }
  if (seg === "events" || seg === "session-change") {
    return second === ":sessionId" ? { road: "session", param: "sessionId" } : undefined;
  }
  if (seg === "session-diff" || seg === "session-file") return { road: "session-handler" };

  // ── plugins ──────────────────────────────────────────────────────────────
  if (seg === "plugins") {
    if (second === undefined) return core("plugins", method, route);
    if (second === ":id") return core("plugins", method, route);
    return plugin(second, method, route);
  }
  if (seg === "config" && second === "plugins") return core("plugins", method, route);
  const owner = ownerOf?.(route);
  if (owner) return plugin(owner, method, route);

  // ── core families ────────────────────────────────────────────────────────
  const family = FAMILY_BY_SEGMENT[seg];
  return family ? core(family, method, route) : undefined;
}
