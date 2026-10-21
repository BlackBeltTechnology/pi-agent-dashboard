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
  ALLOWLISTED_CONTEXT_MEMBERS,
  DENYLIST,
  GENERATED_TOOLS,
  isDenylisted,
  MANIFEST,
} from "@blackbelt-technology/pi-dashboard-mcp-server-plugin/manifest";
import {
  hasRouteTier,
  ROUTE_TIERS,
} from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
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

// Push routes: always registered, tiered, and denylisted from MCP (v1).
// See change: add-server-push-notifications (test-plan #E33, Decision 12).
describe("E33 — /api/push/* routes are tiered and denylisted", () => {
  const PUSH_ROUTES = [
    { method: "GET", path: "/api/push/vapid-public-key", tier: "observe" },
    { method: "GET", path: "/api/push/register", tier: "operate" },
    { method: "POST", path: "/api/push/register", tier: "operate" },
    { method: "DELETE", path: "/api/push/register/:tokenId", tier: "operate" },
    { method: "POST", path: "/api/push/test", tier: "operate" },
  ] as const;

  it("all five are registered even with push disabled", () => {
    const registered = apiRoutes().filter((r) => r.path.startsWith("/api/push/"));
    expect(registered.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
      PUSH_ROUTES.map((r) => `${r.method} ${r.path}`).sort(),
    );
  });

  it("each has its ROUTE_TIERS tier and a DENYLIST entry", () => {
    for (const r of PUSH_ROUTES) {
      const row = ROUTE_TIERS.find((e) => e.method === r.method && e.path === r.path);
      expect(row?.tier, `${r.method} ${r.path}`).toBe(r.tier);
      expect(isDenylisted(r.path), r.path).toBe(true);
    }
  });
});

// See change: streamline-first-run (test-plan #E16).
describe("E16 — create-project is control-tier, denylisted and never a generated tool", () => {
  it("resolves to control, is denylisted, and no tool name contains create_project", () => {
    const row = ROUTE_TIERS.find((e) => e.method === "POST" && e.path === "/api/browse/create-project");
    expect(row?.tier).toBe("control");
    expect(isDenylisted("/api/browse/create-project")).toBe(true);
    expect(GENERATED_TOOLS.some((t) => t.name.includes("create_project"))).toBe(false);
    expect(MANIFEST.some((r) => r.name.includes("create_project"))).toBe(false);
  });
});

// See change: gate-changed-on-disk-by-content (test-plan #E20).
describe("E20 — /api/file/digest is registered, observe-tier and denylisted", () => {
  it("is registered, has an observe ROUTE_TIERS row, is on the denylist, and is not a generated tool", () => {
    expect(apiRoutes().some((r) => r.method === "GET" && r.path === "/api/file/digest")).toBe(true);
    const row = ROUTE_TIERS.find((e) => e.method === "GET" && e.path === "/api/file/digest");
    expect(row?.tier).toBe("observe");
    expect(isDenylisted("/api/file/digest")).toBe(true);
    expect(GENERATED_TOOLS.some((t) => t.name.includes("file_digest"))).toBe(false);
  });
});

describe("generated rows resolve to a manifest row", () => {
  it("counts and names line up", () => {
    expect(GENERATED_TOOLS.map((t) => t.name).sort()).toEqual(MANIFEST.map((r) => r.name).sort());
  });
});

// See change: add-pending-question-stack (D9, test-plan #X8 — tier + denylist half;
// the "registered" half lands with the routes in task 5.2).
describe("X8 — /api/questions routes are tiered and denylisted", () => {
  const QUESTION_ROUTES = [
    { method: "GET", path: "/api/questions", tier: "observe" },
    { method: "GET", path: "/api/questions/:id", tier: "observe" },
    { method: "POST", path: "/api/questions/:id/answer", tier: "control" },
    { method: "POST", path: "/api/questions/:id/summarize", tier: "control" },
  ] as const;

  it("each has its ROUTE_TIERS tier and a DENYLIST entry with a reason", () => {
    for (const r of QUESTION_ROUTES) {
      const row = ROUTE_TIERS.find((e) => e.method === r.method && e.path === r.path);
      expect(row?.tier, `${r.method} ${r.path}`).toBe(r.tier);
      expect(isDenylisted(r.path), r.path).toBe(true);
    }
    const entry = DENYLIST.find((e) => e.pattern === "/api/questions/");
    expect(entry?.reason).toContain("human-in-the-loop");
  });

  it("each is actually registered on the real server", () => {
    const registered = new Set(apiRoutes().map((r) => `${r.method} ${r.path}`));
    for (const r of QUESTION_ROUTES) expect(registered.has(`${r.method} ${r.path}`), `${r.method} ${r.path}`).toBe(true);
  });
});

describe("improve-gmail-plugin-setup-ux E29 — gmail setup + filters routes are triaged", () => {
  it.each([
    ["PUT", "/api/plugins/gmail/setup"],
    ["POST", "/api/plugins/gmail/accounts/:sub/filters"],
    // add-gmail-auto-setup: the automatic setup run routes.
    ["POST", "/api/plugins/gmail/setup/run"],
    ["GET", "/api/plugins/gmail/setup/run/:id"],
    ["POST", "/api/plugins/gmail/setup/run/:id/continue"],
    ["POST", "/api/plugins/gmail/setup/run/:id/takeover"],
    ["DELETE", "/api/plugins/gmail/setup/run/:id"],
  ])("%s %s is an operate route covered by the gmail denylist prefix", (method, path) => {
    expect(ROUTE_TIERS.find((e) => e.method === method && e.path === path)?.tier).toBe("operate");
    expect(isDenylisted(path)).toBe(true);
  });
});
