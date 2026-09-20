/**
 * Namespace coverage — the safety net for the universal network guard.
 *
 * The guard's jurisdiction is prefix-scoped (`/api`, `/v1`, `/editor`, `/live`),
 * so a future dangerous route registered OUTSIDE those prefixes would be
 * silently unguarded. This suite boots the real server (so plugin routes are
 * registered exactly as they are in production), collects every route via
 * `onRoute`, and proves each one is either:
 *
 *   1. inside the guard's jurisdiction (`isGuardJurisdiction`), or
 *   2. `/auth/*` (the login surface), or
 *   3. a static/SPA surface (`*`, `/*`, `/manifest.json`, `/sw.js`, …), or
 *   4. inside an EXPLICITLY ENUMERATED independently-authenticated namespace
 *      (`/mcp` — which authenticates in-handler from the device token and
 *      deliberately distrusts `request.isAuthenticated`).
 *
 * Set 4 is the point of the "enumerated" part: adding a namespace to it is a
 * visible code change in one place, never an implicit fall-through.
 *
 * See change: add-universal-network-guard (spec: trusted-networks).
 * Covers test-plan #S17 and #S24.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isGuardJurisdiction } from "../auth/localhost-guard.js";
import { createServer, type DashboardServer } from "../server.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
/** packages/server/src/__tests__ → repo root */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

interface RegisteredRoute {
  method: string | string[];
  url: string;
}

let server: DashboardServer;
let routes: RegisteredRoute[] = [];

beforeAll(async () => {
  routes = [];
  server = await createServer({
    port: 0,
    piPort: 0,
    host: "127.0.0.1",
    dev: true,
    autoShutdown: false,
    shutdownIdleSeconds: 999,
    tunnel: false,
    onRoute: (r) => routes.push(r),
  });
  await server.start();
}, 90_000);

afterAll(async () => {
  await server?.stop();
});

/**
 * Independently-authenticated namespaces — deliberately OUT of guard
 * jurisdiction. `mcp-server-plugin` authenticates in-handler from the bearer
 * credential alone and does not trust `request.isAuthenticated`; guarding it
 * would 403 every legitimate remote MCP client (a lockout, not a fix).
 * Adding an entry here is a deliberate, reviewable act.
 */
const INDEPENDENTLY_AUTHENTICATED = ["/mcp"] as const;
/** The login surface — reachable pre-auth by design. */
const AUTH_PREFIX = "/auth";
/**
 * Static assets, the SPA shell and the framework fallbacks. `/sw.js` is
 * registered root-scoped by `client/src/main.tsx` and MUST stay out of
 * jurisdiction or the PWA service worker stops loading. `*` is Fastify's
 * not-found/SPA-fallback route; `/*` is `@fastify/static`.
 */
const STATIC_PUBLIC: ReadonlySet<string> = new Set([
  "/",
  "*",
  "/*",
  "/sw.js",
  "/manifest.json",
  "/favicon.ico",
  "/favicon.svg",
  "/robots.txt",
  "/apple-touch-icon.png",
]);

/** `url` is under `prefix` as a path segment (exact, or `/`-continuation). */
function isUnder(candidate: string, prefix: string): boolean {
  return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

function isCovered(routeUrl: string): boolean {
  if (isGuardJurisdiction(routeUrl)) return true;
  if (STATIC_PUBLIC.has(routeUrl)) return true;
  if (isUnder(routeUrl, AUTH_PREFIX)) return true;
  return INDEPENDENTLY_AUTHENTICATED.some((ns) => isUnder(routeUrl, ns));
}

describe("S17: every registered route is guarded or explicitly exempt", () => {
  it("enumerates a non-trivial route table", () => {
    // Guards against a silently-empty enumeration making every assertion below
    // vacuously true.
    expect(routes.length).toBeGreaterThan(100);
  });

  it("has no route outside the guarded namespaces and enumerated exclusions", () => {
    const offenders = routes.filter((r) => !isCovered(r.url));
    expect(
      offenders.map((r) => `${r.method} ${r.url}`),
      "a dangerous route outside the guard's jurisdiction is unguarded — either move it under /api|/v1|/editor|/live, or add its namespace to INDEPENDENTLY_AUTHENTICATED",
    ).toEqual([]);
  });

  it("classifies the model-proxy and editor-proxy prefixes as guarded", () => {
    // Both exist in the table above; assert the jurisdiction predicate agrees.
    for (const u of ["/v1/messages", "/v1/models", "/live/abc", "/live/abc/index.html"]) {
      expect(isGuardJurisdiction(u), u).toBe(true);
    }
  });

  it("keeps /sw.js, the PWA manifest and the SPA shell out of jurisdiction", () => {
    for (const u of ["/sw.js", "/manifest.json", "/", "/settings", "/auth/status", "/mcp"]) {
      expect(isGuardJurisdiction(u), u).toBe(false);
    }
  });
});

describe("S24: /mcp is enumerated, not silently ignored", () => {
  const MCP_ROUTES_SRC = path.join(
    REPO_ROOT,
    "packages",
    "mcp-server-plugin",
    "src",
    "server",
    "routes.ts",
  );

  it("declares every /mcp path outside the guard's jurisdiction (no client lockout)", () => {
    for (const p of ["/mcp", "/mcp/observe", "/mcp/control", "/mcp/anything"]) {
      expect(isGuardJurisdiction(p), p).toBe(false);
    }
  });

  it("authenticates /mcp from the bearer credential alone, never isAuthenticated", () => {
    const src = fs.readFileSync(MCP_ROUTES_SRC, "utf-8");
    // The three static surfaces plus the wildcard are the whole /mcp table.
    expect(src).toContain('const MCP_STATIC_PATHS = ["/mcp", "/mcp/observe", "/mcp/control"] as const;');
    expect(src).toContain('url: "/mcp/*"');
    // Self-authentication from the header is what makes it safe to keep /mcp
    // out of jurisdiction.
    expect(src).toContain("authenticate(request.headers.authorization");
    // The scope guard: this encapsulated instance only ever sees /mcp.
    expect(src).toContain('request.url.startsWith("/mcp")');
  });

  it("does not network-deny a /mcp request from an untrusted peer", async () => {
    // The guard must be a no-op on /mcp. When `mcp-server-plugin` resolves, the
    // plugin answers 401 from its own auth; when it does not (a worktree without
    // the plugin's workspace links), the request falls through to the SPA
    // fallback. Either way it must never be the guard's `network_not_allowed`.
    const res = await fetch(`http://127.0.0.1:${server.httpPort()}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover" }),
    });
    const text = await res.text();
    expect(res.status, "/mcp must not be 403'd by the network guard").not.toBe(403);
    expect(text).not.toContain("network_not_allowed");
  }, 30_000);
});

describe("S24: no client-side SPA route lives under a guarded namespace", () => {
  it("has no useRoute() pattern starting with a guarded prefix", () => {
    const clientSrc = path.join(REPO_ROOT, "packages", "client", "src");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "__tests__") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          const src = fs.readFileSync(full, "utf-8");
          // All three literal forms, so a switch to single quotes or a
          // template literal cannot silently escape this net.
          for (const m of src.matchAll(/useRoute\(\s*(["\x27`])([^"\x27`]+)\1/g)) {
            if (isGuardJurisdiction(m[2])) {
              offenders.push(`${path.relative(REPO_ROOT, full)}: ${m[2]}`);
            }
          }
        }
      }
    };
    walk(clientSrc);
    expect(
      offenders,
      "an unmatched in-jurisdiction path is 403'd instead of reaching the SPA handler, so no client route may live under /api, /v1, /editor or /live",
    ).toEqual([]);
  });
});
