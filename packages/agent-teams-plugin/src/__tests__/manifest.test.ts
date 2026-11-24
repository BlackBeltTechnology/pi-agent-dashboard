/**
 * Manifest contract, runtime half (test-plan S102, S103). The static source scan
 * lives in `manifest-contract.test.ts`; this file drives the REAL driver and
 * request-lane code and checks what actually reaches the host, against a host
 * that enforces the manifest `emits` gate exactly like `plugin-event-seam.ts`.
 * See change: add-agent-teams-core.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSessionDriver } from "../server/driver.js";
import { createExtensionPoints } from "../server/extension-points.js";
import { createTeamsRuntime } from "../server/runtime.js";
import { AGENT_TEAMS_PLUGIN_ID } from "../shared/plugin-id.js";
import { LANE_TYPES } from "../shared/protocol.js";
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
    expect(new Set(types)).toEqual(new Set(manifest.emits));
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
    expect([...(manifest.emits ?? [])].sort()).toEqual(["agent-teams:mail", "agent-teams:team_closed"]);
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
