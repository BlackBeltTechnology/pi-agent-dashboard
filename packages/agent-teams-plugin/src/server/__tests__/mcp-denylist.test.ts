/**
 * MCP surface (test-plan S72): the `/api/plugins/agent-teams/` prefix is
 * denylisted, so neither mutating route can become a tool — control is the
 * lead's in-session tool surface and the user's UI, never an LLM REST action.
 * Reads the mcp-server-plugin sources (the manifest is generated from them).
 * @structural-pin reads the MCP denylist and generated manifest sources: the prefix entry and the absence of any agent-teams row are the contract under test
 * See change: add-agent-teams-ui.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTE_TIERS } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import { describe, expect, it } from "vitest";
import { API_PREFIX } from "../routes.js";

const POSTS = ["/api/plugins/agent-teams/teams/:id/members/:name/stop", "/api/plugins/agent-teams/teams/:id/shutdown"];
const TEMPLATES_HOOKS_ROUTES = [
  "/api/plugins/agent-teams/templates",
  "/api/plugins/agent-teams/teams/start",
  "/api/plugins/agent-teams/teams/:id/plans",
  "/api/plugins/agent-teams/teams/:id/members/:name/plan-decision",
  "/api/plugins/agent-teams/hook-trust",
  "/api/plugins/agent-teams/openspec-relaunch",
];
const MCP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../mcp-server-plugin/src/server");
const read = (rel: string): string => fs.readFileSync(path.join(MCP, rel), "utf8");

/** The host's rule (`isDenylisted`): a trailing-slash pattern is a prefix, anything else an exact path. */
const patterns = (): string[] => [...read("tools.denylist.ts").matchAll(/pattern:\s*"([^"]+)"/g)].map((m) => m[1] as string);
const denied = (name: string): boolean => patterns().some((p) => (p.endsWith("/") ? name.startsWith(p) : name === p));

describe("MCP denylist (S72)", () => {
  it("the whole prefix is denylisted, so both POST route patterns are", () => {
    expect(patterns()).toContain(`${API_PREFIX}/`);
    for (const p of POSTS) expect(denied(p), p).toBe(true);
  });

  it("every templates-hooks route (start, templates, plans, plan-decision, hook-trust) is covered by the same prefix entry", () => {
    for (const p of TEMPLATES_HOOKS_ROUTES) {
      expect(denied(p), p).toBe(true);
      for (const f of ["tools.manifest.ts", path.join("generated", "tools.ts")]) expect(read(f), `${f} ${p}`).not.toContain(p);
    }
  });

  it("neither route is bound by a manifest row or a generated tool", () => {
    for (const f of ["tools.manifest.ts", path.join("generated", "tools.ts")]) {
      const text = read(f);
      expect(text, f).not.toContain(API_PREFIX);
      for (const p of POSTS) expect(text, `${f} ${p}`).not.toContain(p);
    }
  });

  it("the routes are control-tier rows (the tiered MCP filter never sees a denylisted path)", () => {
    for (const p of POSTS) expect(ROUTE_TIERS.find((r) => r.method === "POST" && r.path === p)?.tier).toBe("control");
  });
});
