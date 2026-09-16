/**
 * E15/E16 (test-plan expand-mcp-tiered-surface) — manifest completeness.
 *
 * Boots the real server, collects every registered route R via `onRoute`, and
 * proves the MCP manifest is a total partition over R ∪ V (V = the browser-WS
 * verb union): every route/verb is either bound by a manifest row or on the
 * explicit denylist, and every `/api/*` route has a `ROUTE_TIERS` entry.
 *
 * See change: expand-mcp-tiered-surface (D6).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasRouteTier,
} from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import {
  ALLOWLISTED_CONTEXT_MEMBERS,
  DENYLIST,
  GENERATED_TOOLS,
  isDenylisted,
  MANIFEST,
} from "@blackbelt-technology/pi-dashboard-mcp-server-plugin/manifest";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type DashboardServer } from "../server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PROTOCOL_FILE = path.join(REPO_ROOT, "packages/shared/src/browser-protocol.ts");

let server: DashboardServer;
let routes: Array<{ method: string | string[]; url: string }> = [];

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
}, 60_000);

afterAll(async () => {
  await server?.stop();
});

/** Every member of the `BrowserToServerMessage` union (its `type` literal). */
function enumerateVerbUnion(): string[] {
  const program = ts.createProgram([PROTOCOL_FILE], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(PROTOCOL_FILE);
  if (!source) throw new Error(`cannot load ${PROTOCOL_FILE}`);
  let unionType: ts.Type | undefined;
  ts.forEachChild(source, (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === "BrowserToServerMessage") {
      unionType = checker.getTypeAtLocation(node);
    }
  });
  if (!unionType) throw new Error("union not found");
  const members = unionType.isUnion() ? unionType.types : [unionType];
  const out: string[] = [];
  for (const member of members) {
    const prop = member.getProperty("type");
    if (!prop) continue;
    const propType = checker.getTypeOfSymbolAtLocation(
      prop,
      prop.valueDeclaration ?? source,
    );
    if (propType.isStringLiteral()) out.push(propType.value);
  }
  return out;
}

/** `/api/*` route patterns (HEAD dropped — derived from GET). */
function apiRoutes(): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  for (const r of routes) {
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    for (const m of methods) {
      if (!r.url.startsWith("/api/")) continue;
      if (m === "HEAD") continue;
      out.push({ method: m, path: r.url });
    }
  }
  return out;
}

describe("E15 — the manifest is a total partition over routes + verbs", () => {
  it("bound names ∪ denylist cover R ∪ V exactly", () => {
    const restPaths = new Set(
      MANIFEST.filter((r) => r.bind.kind === "rest").map((r) => (r.bind as { path: string }).path),
    );
    const sessionMessages = new Set(
      MANIFEST.filter((r) => r.bind.kind === "session").map((r) => (r.bind as { message: string }).message),
    );
    const bound = new Set<string>([...restPaths, ...sessionMessages]);

    const universe = [...new Set([...apiRoutes().map((r) => r.path), ...enumerateVerbUnion()])];
    const unbound = universe.filter((n) => !bound.has(n) && !isDenylisted(n));
    expect(unbound, "routes/verbs neither bound nor denylisted").toEqual([]);

    // A manifest row that binds a route the server does not register is a
    // dangling row (route patterns; the four lifecycle rows share one path).
    const registered = new Set(apiRoutes().map((r) => r.path));
    const dangling = [...restPaths].filter((p) => !registered.has(p) && !isDenylisted(p));
    expect(dangling, "manifest rows binding an unregistered route").toEqual([]);
  });

  it("is NOT vacuous — removing a denylist entry leaves that route uncovered", () => {
    const universe = apiRoutes().map((r) => r.path);
    const restPaths = new Set(
      MANIFEST.filter((r) => r.bind.kind === "rest").map((r) => (r.bind as { path: string }).path),
    );
    // Drop the denylist entirely; a known denied route must then surface.
    const uncovered = universe.filter((p) => !restPaths.has(p));
    expect(uncovered.length).toBeGreaterThan(0);
    expect(uncovered.some((p) => p.includes("/api/model-proxy/"))).toBe(true);
  });

  it("context rows are backed by allowlisted context members", () => {
    for (const row of MANIFEST.filter((r) => r.bind.kind === "context")) {
      if (row.bind.kind !== "context") throw new Error("filtered");
      expect(ALLOWLISTED_CONTEXT_MEMBERS as readonly string[]).toContain(row.bind.member);
    }
  });

  it("denylist entries all carry a reason", () => {
    for (const e of DENYLIST) expect(e.reason.length, e.pattern).toBeGreaterThan(0);
  });
});

describe("E16 — every /api route has a ROUTE_TIERS entry", () => {
  it("no route is left to the fail-closed default", () => {
    for (const { method, path } of apiRoutes()) {
      expect(hasRouteTier(method, path), `${method} ${path}`).toBe(true);
    }
  });

  it("is NOT vacuous — a fixture route without an entry fails", () => {
    expect(hasRouteTier("POST", "/api/fixture-not-registered")).toBe(false);
  });
});

describe("generated rows resolve to a manifest row", () => {
  it("counts and names line up", () => {
    expect(GENERATED_TOOLS.map((t) => t.name).sort()).toEqual(MANIFEST.map((r) => r.name).sort());
  });
});
