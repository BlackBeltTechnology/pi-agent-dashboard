/**
 * Manifest contract, runtime half (test-plan S102, S103). The static source scan
 * lives in `manifest-contract.test.ts`; this file drives the REAL driver and
 * request-lane code and checks what actually reaches the host, against a host
 * that enforces the manifest `emits` gate exactly like `plugin-event-seam.ts`.
 * See change: add-agent-teams-core.
 *
 * add-agent-teams-ui adds the claims contract (S11; tasks 9.1, 9.2, 9.6, 9.7): one badge, one content
 * overlay route, three custom-entry renderers and eleven tool renderers (four components), lazy modules,
 * generated-registry sync and knip entries — see the "manifest claims" blocks at the end of this file.
 * @structural-pin reads the plugin and team-plugin package.json manifests, the generated plugin registry and knip.json; the manifest `id`/`emits`/claim text is the contract under test
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as entry from "../client/index.js";
import { TEAM_VIEW_PARENT_ROUTE, TEAM_VIEW_ROUTE } from "../client/routes.js";
import { FAMILY_COMPONENTS, TOOL_FAMILIES } from "../client/tool-families.js";
import { createSessionDriver } from "../server/driver.js";
import { createExtensionPoints } from "../server/extension-points.js";
import { createTeamsRuntime } from "../server/runtime.js";
import { CUSTOM_TYPE_IDLE, CUSTOM_TYPE_MAIL, CUSTOM_TYPE_NOTICE } from "../shared/mail-format.js";
import { AGENT_TEAMS_EVENT_CHANGED, AGENT_TEAMS_PLUGIN_ID } from "../shared/plugin-id.js";
import { LANE_TYPES, TEAM_OPS } from "../shared/protocol.js";
import { createFakeHostCtx, createFakeRuntimeHost, FakeClock } from "./harness/index.js";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const readManifest = (pkg: string) =>
  (JSON.parse(fs.readFileSync(path.resolve(PKG_ROOT, "..", pkg, "package.json"), "utf8")) as {
    "pi-dashboard-plugin": { id: string; emits?: string[]; claims?: Array<{ slot: string; component: string }> };
  })["pi-dashboard-plugin"];
const manifest = readManifest("agent-teams-plugin");
const teamManifest = readManifest("team-plugin");

/** Throws naming the offending type, like the contract test a developer would see. */
function expectListed(emitted: Iterable<string>, listed: readonly string[]): void {
  for (const type of emitted) {
    if (!listed.includes(type)) throw new Error(`event type "${type}" is emitted but missing from manifest emits`);
  }
}

describe("manifest contract (S102)", () => {
  it("every event type the real driver emits is listed in manifest emits", () => {
    const base = createFakeHostCtx({ knownSessions: ["S1"] });
    const driver = createSessionDriver(base.ctx);
    driver.deliver({ teamId: "t", member: "a", sessionId: "S1" }, [{ id: 1, from: "lead", to: "a", kind: "message", text: "x", priority: "normal", wake: true, createdAt: 1 }], { wake: true });
    driver.notifyTeamClosed?.("S1", { teamId: "t" });
    const types = base.emits.map((e) => e.eventType);
    // `agent-teams:changed` is the UI bridge's frame (broadcast, see server/__tests__/ui-bridge.test.ts), not a driver emit.
    expect(new Set(types)).toEqual(new Set((manifest.emits ?? []).filter((t) => t !== AGENT_TEAMS_EVENT_CHANGED)));
    expectListed(types, manifest.emits ?? []);
  });

  it("a team close through the real ops emits only listed types", async () => {
    const fake = createFakeRuntimeHost();
    createTeamsRuntime(fake.host, { clock: new FakeClock(), ext: createExtensionPoints() });
    fake.addSession("S-lead", { cwd: "/w" });
    await fake.call("S-lead", "TeamCreate", { name: "t" });
    await fake.call("S-lead", "TeamDelete");
    expect(fake.base.emits.length).toBeGreaterThan(0);
    expectListed(fake.base.emits.map((e) => e.eventType), manifest.emits ?? []);
  });

  it("an unlisted emit is refused by the host, the helper names the type, and mail stays queued", async () => {
    const emits = new Set(manifest.emits);
    const base = createFakeHostCtx({ knownSessions: ["S1"] });
    const enforcing = { ...base.ctx, emitEventToSession: (sid: string, type: string, data?: Record<string, unknown>) => (emits.has(type) ? base.ctx.emitEventToSession(sid, type, data) : false) };
    expect(enforcing.emitEventToSession("S1", "agent-teams:bogus", {})).toBe(false);
    expect(() => expectListed(["agent-teams:mail", "agent-teams:bogus"], manifest.emits ?? [])).toThrow(/agent-teams:bogus/);

    // A driver whose host refuses the type hands nothing over: the caller keeps the mail queued.
    const refusing = createSessionDriver({ ...base.ctx, emitEventToSession: () => false });
    const mail = { id: 1, from: "lead", to: "a", kind: "message", text: "x", priority: "normal" as const, wake: true, createdAt: 1 };
    expect(refusing.deliver({ teamId: "t", member: "a", sessionId: "S1" }, [mail], { wake: true })).toBe(false);
  });

  it("the manifest id equals the shared constant and lists exactly the emitted event types", () => {
    expect(manifest.id).toBe(AGENT_TEAMS_PLUGIN_ID);
    expect([...(manifest.emits ?? [])].sort()).toEqual(["agent-teams:changed", "agent-teams:mail", "agent-teams:team_closed"]);
  });
});

describe("no collision with the team plugin (S103)", () => {
  it("uses its own id, claims, REST prefix, lane types and data dir", () => {
    expect(manifest.id).toBe("agent-teams");
    expect(teamManifest.id).toBe("team");
    expect(manifest.id).not.toBe(teamManifest.id);
    // capability names
    const ownClaims = (manifest.claims ?? []).map((c) => `${c.slot}:${c.component}`);
    const teamClaims = (teamManifest.claims ?? []).map((c) => `${c.slot}:${c.component}`);
    expect(ownClaims.filter((c) => teamClaims.includes(c))).toEqual([]);
    // lane request types are namespaced by this plugin's id
    for (const t of LANE_TYPES) expect(t.startsWith("agent-teams/")).toBe(true);
    // REST prefix / data dir derive from the plugin id
    const routeTiers = fs.readFileSync(path.resolve(PKG_ROOT, "..", "shared/src/route-tiers.ts"), "utf8");
    expect(routeTiers).toContain("/api/plugins/agent-teams/teams");
    expect(`/api/plugins/${manifest.id}/`).not.toBe(`/api/plugins/${teamManifest.id}/`);
  });

  it("a session that belongs to the team plugin is not a team lead and sees no agent-teams state", async () => {
    const fake = createFakeRuntimeHost();
    const rt = createTeamsRuntime(fake.host, { clock: new FakeClock(), ext: createExtensionPoints() });
    const shared = fake.addSession("S-shared", { cwd: "/w", pluginRefs: { team: { personaKey: "p" } } });
    expect(await fake.call(shared, "TeamCreate", { name: "t" })).toMatchObject({ ok: false, error: "lead_confined" });
    expect(await fake.call(shared, "TeamStatus")).toMatchObject({ ok: false, error: "not_in_team" });
    expect(rt.store.list()).toEqual([]);
    expect(fs.existsSync(path.join(fake.dataDir, "teams"))).toBe(false);
  });

  it("persists only under its own data dir", async () => {
    const fake = createFakeRuntimeHost();
    const rt = createTeamsRuntime(fake.host, { clock: new FakeClock(), ext: createExtensionPoints() });
    fake.addSession("S-lead", { cwd: "/w" });
    await fake.call("S-lead", "TeamCreate", { name: "t" });
    await rt.persistence.flush();
    const files = fs.readdirSync(path.join(fake.dataDir, "teams"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^t_[0-9a-f]{8}\.json$/);
  });
});

const REPO = path.resolve(PKG_ROOT, "..", "..");
// The loader's validator, loaded by path (a static cross-package import would break this package's tsc rootDir).
type Claim = { slot: string; component: string; module?: string; predicate?: string; toolName?: string; customType?: string; [key: string]: unknown };
interface ValidatedManifest {
  id: string;
  emits?: string[];
  claims: Claim[];
}
const { validateManifest } = (await import(/* @vite-ignore */ path.resolve(PKG_ROOT, "../dashboard-plugin-runtime/src/manifest-validator.ts"))) as {
  validateManifest(raw: unknown, pluginId: string): ValidatedManifest;
};
const claimsPkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")) as Record<string, unknown>;
const rawManifest = claimsPkg["pi-dashboard-plugin"];
const claimsManifest = validateManifest(rawManifest, "agent-teams");
const claims = claimsManifest.claims;
const bySlot = (slot: string): Claim[] => claims.filter((c) => c.slot === slot);

describe("manifest claims (S11)", () => {
  it("validates against the loader's validator", () => {
    expect(() => validateManifest(rawManifest, "agent-teams")).not.toThrow();
    expect(claimsManifest.id).toBe("agent-teams");
  });

  it("declares exactly 1 badge + 1 overlay route + 3 custom-entry + 11 tool-renderer claims", () => {
    expect(claims).toHaveLength(16);
    expect(bySlot("session-card-badge")).toHaveLength(1);
    expect(bySlot("shell-overlay-route")).toHaveLength(1);
    expect(bySlot("custom-entry-renderer")).toHaveLength(3);
    expect(bySlot("tool-renderer")).toHaveLength(11);
  });

  it("claims exactly the 11 team tools, each mapped to one of the 4 component families", () => {
    const tools = bySlot("tool-renderer");
    expect(tools.map((c) => c.toolName).sort()).toEqual([...TEAM_OPS].sort());
    expect(new Set(tools.map((c) => c.toolName)).size).toBe(11);
    expect(new Set(tools.map((c) => c.component))).toEqual(new Set(Object.values(FAMILY_COMPONENTS)));
    for (const c of tools) expect(c.component, String(c.toolName)).toBe(FAMILY_COMPONENTS[TOOL_FAMILIES[c.toolName as keyof typeof TOOL_FAMILIES]]);
  });

  it("the table in code is the manifest: same keys, every family used", () => {
    expect(Object.keys(TOOL_FAMILIES).sort()).toEqual(bySlot("tool-renderer").map((c) => c.toolName as string).sort());
    expect(new Set(Object.values(TOOL_FAMILIES))).toEqual(new Set(Object.keys(FAMILY_COMPONENTS)));
  });

  it("does not claim tools of other extensions (`PlanSubmit`, `TeamFoo` keep the host generic renderer)", () => {
    const claimed = bySlot("tool-renderer").map((c) => c.toolName);
    for (const foreign of ["PlanSubmit", "TeamFoo", "Agent", "TeamCreated"]) expect(claimed).not.toContain(foreign);
  });

  it("claims the three mail customTypes with one lazy card", () => {
    const cards = bySlot("custom-entry-renderer");
    expect(cards.map((c) => c.customType).sort()).toEqual([CUSTOM_TYPE_IDLE, CUSTOM_TYPE_MAIL, CUSTOM_TYPE_NOTICE].sort());
    for (const c of cards) expect(c).toMatchObject({ component: "MailEntryCard", module: "./src/client/MailEntryCard.tsx" });
  });

  it("claims the Team view as a content overlay route at depth 2 under the session", () => {
    expect(bySlot("shell-overlay-route")[0]).toMatchObject({
      component: "TeamViewClaim",
      module: "./src/client/TeamView.tsx",
      path: TEAM_VIEW_ROUTE,
      sessionParam: "sessionId",
      depth: 2,
      parentPath: TEAM_VIEW_PARENT_ROUTE,
      presentation: "content",
    });
    expect(TEAM_VIEW_ROUTE).toBe("/session/:sessionId/team");
  });

  it("claims the badge eagerly, gated by the exported predicate (no `module`, no async gate)", () => {
    const [badge] = bySlot("session-card-badge");
    expect(badge).toMatchObject({ component: "TeamBadge", predicate: "isTeamSession" });
    expect(badge?.module).toBeUndefined();
    expect(Object.keys(entry)).toEqual(expect.arrayContaining(["TeamBadge", "isTeamSession"]));
  });

  it("lists the UI's own event in `emits` (the host enforces it for plugin_event frames)", () => {
    expect(claimsManifest.emits).toContain("agent-teams:changed");
  });
});

describe("lazy modules (9.1, D9)", () => {
  const lazy = claims.filter((c) => typeof c.module === "string");
  const moduleFiles = [...new Set(lazy.map((c) => c.module as string))].sort();

  it("every lazy claim's module is package-relative, exists, and exports its component by name", () => {
    expect(lazy).toHaveLength(15);
    for (const c of lazy) {
      const mod = c.module as string;
      expect(mod.startsWith("./") && !mod.split("/").includes("..")).toBe(true);
      const file = path.join(PKG_ROOT, mod);
      expect(fs.existsSync(file), mod).toBe(true);
      const src = fs.readFileSync(file, "utf8");
      expect(new RegExp(`export (?:async )?(?:function|const|class) ${c.component}\\b`).test(src), `${mod} exports ${c.component}`).toBe(true);
    }
    expect(moduleFiles).toEqual(["./src/client/MailEntryCard.tsx", "./src/client/TeamToolRenderers.tsx", "./src/client/TeamView.tsx"]);
  });

  it("the eager entry exports no lazy component and imports none of the lazy modules", () => {
    for (const c of lazy) expect(Object.keys(entry), String(c.component)).not.toContain(c.component);
    const eagerSrc = ["client/index.tsx", "client/TeamBadge.tsx", "client/team-refs.ts", "client/routes.ts", "i18n.ts"].map((f) => fs.readFileSync(path.join(PKG_ROOT, "src", f), "utf8")).join("\n");
    for (const f of moduleFiles) expect(eagerSrc, f).not.toContain(path.basename(f, ".tsx"));
    expect(eagerSrc).not.toMatch(/export \* from/);
  });
});

describe("generated registry and knip (9.2, 9.6)", () => {
  it("the committed generated registry carries all 16 claims of this plugin and the new emit", () => {
    const registry = fs.readFileSync(path.join(REPO, "packages/client/src/generated/plugin-registry.tsx"), "utf8");
    const rows = registry.split("\n").filter((l) => l.includes('pluginId: "agent-teams"'));
    expect(rows).toHaveLength(16);
    for (const op of TEAM_OPS) expect(rows.some((r) => r.includes(`toolName: "${op}"`)), op).toBe(true);
    expect(rows.filter((r) => r.includes("lazyClaim(")).length).toBe(15);
    expect(rows.find((r) => r.includes("session-card-badge"))).toContain("predicate: isTeamSession");
    expect(registry).toContain('"agent-teams:changed"');
  });

  it("knip lists every client source file of the package (main entry, lazy modules, store, parsers)", () => {
    const knip = JSON.parse(fs.readFileSync(path.join(REPO, "knip.json"), "utf8")) as { workspaces: Record<string, { entry: string[] }> };
    const entries = knip.workspaces["packages/agent-teams-plugin"]?.entry ?? [];
    // Every client source file is an entry until a view imports it (the lazy modules are only reachable through the manifest).
    const clientFiles = fs
      .readdirSync(path.join(PKG_ROOT, "src", "client"))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => `src/client/${f}`)
      // reached through the entry/lazy modules or the manifest already
      .filter((f) => !["src/client/TeamBadge.tsx", "src/client/team-refs.ts", "src/client/routes.ts"].includes(f));
    expect(clientFiles.length).toBeGreaterThanOrEqual(10);
    for (const f of clientFiles) expect(entries, f).toContain(f);
  });
});
