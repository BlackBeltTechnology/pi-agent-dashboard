/**
 * HTTP road classification (D10/D24, tasks 18.14/18.28): road rules and
 * invariants. Totality over the REAL registered route set (core + plugin
 * routes attributed at load) lives in `http-road-classification-live.test.ts`.
 */
import { ROUTE_TIERS } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import { describe, expect, it } from "vitest";
import { classifyHttpRoad } from "../http-road-classification.js";

describe("classifyHttpRoad — invariants over ROUTE_TIERS", () => {
  it("every route carrying a session id param is owner-gated (session road)", () => {
    const leaks = ROUTE_TIERS.filter((r) => /\/api\/(session|sessions|events|session-change)\/:(id|sessionId)\b/.test(r.path))
      .filter((r) => classifyHttpRoad(r.method, r.path)?.road !== "session")
      .map((r) => `${r.method} ${r.path}`);
    expect(leaks).toEqual([]);
  });

  it("non-session actions are <family>.read for GET and <family>.write otherwise", () => {
    for (const r of ROUTE_TIERS) {
      const c = classifyHttpRoad(r.method, r.path);
      if (c?.road !== "non-session") continue;
      const verb = r.method === "GET" || r.method === "HEAD" ? "read" : "write";
      expect(c.action.endsWith(`.${verb}`) || c.action.endsWith(`:${verb}`), `${r.method} ${r.path} → ${c.action}`).toBe(true);
    }
  });
});

describe("classifyHttpRoad — roads", () => {
  it("session-control mutation routes are session roads keyed by :id", () => {
    expect(classifyHttpRoad("POST", "/api/session/:id/prompt")).toEqual({ road: "session", param: "id" });
    expect(classifyHttpRoad("POST", "/api/session/:id/lifecycle")).toEqual({ road: "session", param: "id" });
    expect(classifyHttpRoad("GET", "/api/sessions/:sessionId/attachments/:attachmentId")).toEqual({
      road: "session",
      param: "sessionId",
    });
    expect(classifyHttpRoad("GET", "/api/events/:sessionId/:seq")).toEqual({ road: "session", param: "sessionId" });
  });

  it("archived-session routes are owner-gated in their handler (live OR archive owner)", () => {
    expect(classifyHttpRoad("GET", "/api/sessions/archived/:id")?.road).toBe("session-handler");
    expect(classifyHttpRoad("DELETE", "/api/sessions/archived/:id")?.road).toBe("session-handler");
  });

  it("list / query-param session roads are gated inside their handler", () => {
    expect(classifyHttpRoad("GET", "/api/sessions")?.road).toBe("session-handler");
    expect(classifyHttpRoad("GET", "/api/session-diff")?.road).toBe("session-handler");
    expect(classifyHttpRoad("GET", "/api/session-file")?.road).toBe("session-handler");
  });

  it("pre-auth + identity infrastructure is never gated", () => {
    for (const [m, p] of [
      ["GET", "/api/health"],
      ["GET", "/api/identity/login-config"],
      ["GET", "/api/identity/me"],
      ["POST", "/api/ws-ticket"],
    ] as const) {
      expect(classifyHttpRoad(m, p)?.road, p).toBe("identity");
    }
  });

  it("maps core families (D24)", () => {
    const a = (m: string, p: string) => {
      const c = classifyHttpRoad(m, p);
      return c?.road === "non-session" ? `${c.action} ${c.resource.kind}` : c?.road;
    };
    expect(a("GET", "/api/git/branches")).toBe("branch.read branch");
    expect(a("POST", "/api/git/commit")).toBe("branch.write branch");
    expect(a("GET", "/api/openspec/tasks")).toBe("openspec.read openspec");
    expect(a("GET", "/api/file/raw")).toBe("files.read files");
    expect(a("POST", "/api/file/write")).toBe("files.write files");
    expect(a("POST", "/api/config")).toBe("config.write config");
    expect(a("GET", "/api/providers")).toBe("providers.read providers");
    expect(a("POST", "/api/packages/install")).toBe("packages.write packages");
    expect(a("POST", "/api/access/grants")).toBe("access.write access");
    expect(a("POST", "/api/tunnel-connect")).toBe("gateway.write gateway");
    expect(a("GET", "/api/pair/pending")).toBe("gateway.read gateway");
    expect(a("POST", "/api/restart")).toBe("system.write system");
    expect(a("GET", "/api/pinned-dirs")).toBe("workspace.read workspace");
    expect(a("POST", "/api/session/spawn")).toBe("workspace.write workspace");
  });

  it("core plugin management is plugins.*; plugin-owned routes are namespaced plugin:<id>:<verb>", () => {
    const toggle = classifyHttpRoad("POST", "/api/plugins/:id/toggle");
    expect(toggle).toMatchObject({ road: "non-session", action: "plugins.write", resource: { kind: "plugin" } });
    const own = classifyHttpRoad("POST", "/api/plugins/automation/run");
    expect(own).toMatchObject({
      road: "non-session",
      action: "plugin:automation:write",
      resource: { kind: "plugin", pluginId: "automation" },
    });
  });

  it("a plugin-registered route outside /api/plugins/ is namespaced by its registering plugin", () => {
    const ownerOf = (r: string) => (r.startsWith("/api/kb/") ? "kb" : undefined);
    expect(classifyHttpRoad("GET", "/api/kb/stats", ownerOf)).toMatchObject({
      action: "plugin:kb:read",
      resource: { kind: "plugin", pluginId: "kb", route: "/api/kb/stats" },
    });
    // Unattributed + not a core family ⇒ unclassified.
    expect(classifyHttpRoad("GET", "/api/kb/stats")).toBeUndefined();
    // Session roads stay owner-gated even if a plugin registered them.
    expect(classifyHttpRoad("POST", "/api/session/:id/x", () => "evil")).toEqual({ road: "session", param: "id" });
  });

  it("a drop-in plugin route under /api/plugins/<id>/ is classified without a table entry", () => {
    expect(classifyHttpRoad("GET", "/api/plugins/acme-crm/deals")).toMatchObject({
      action: "plugin:acme-crm:read",
      resource: { kind: "plugin", pluginId: "acme-crm" },
    });
  });

  it("an unknown non-plugin /api route is unclassified (fail-closed under a policy)", () => {
    expect(classifyHttpRoad("GET", "/api/brand-new-thing")).toBeUndefined();
  });

  it("resources carry the route pattern, never a concrete URL", () => {
    expect(classifyHttpRoad("GET", "/api/git/status")).toMatchObject({ resource: { route: "/api/git/status" } });
  });
});

describe("proxied roads (18.37c)", () => {
  it("/live/* classifies live.<verb>, /editor/* classifies editor.write", () => {
    expect(classifyHttpRoad("GET", "/live/:id/*")).toEqual({ road: "non-session", action: "live.read", resource: { kind: "live", route: "/live/:id/*" } });
    expect(classifyHttpRoad("POST", "/live/:id/*")).toMatchObject({ action: "live.write" });
    expect(classifyHttpRoad("GET", "/editor/:id/*")).toEqual({ road: "non-session", action: "editor.write", resource: { kind: "editor", route: "/editor/:id/*" } });
  });
  it("other non-/api roads stay unclassified", () => {
    expect(classifyHttpRoad("GET", "/assets/x.js")).toBeUndefined();
  });
});
