/**
 * Tests for resource-activation REST routes (toggle + reload).
 * The pi-delegating write is unit-tested in resource-activation-toggle.test.ts;
 * here we mock it and focus on affectedSessions, reload scoping, and auth.
 *
 * See change: folder-resource-activation-toggle.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the pi-delegating write so route tests stay fast + deterministic.
const applyResourceToggleMock = vi.fn();
vi.mock("../pi/resource-activation-toggle.js", async () => {
  const actual = await vi.importActual<any>("../pi/resource-activation-toggle.js");
  return {
    ...actual,
    applyResourceToggle: (...args: any[]) => applyResourceToggleMock(...args),
  };
});

import {
  __resetTrustChallenges,
  registerResourceActivationRoutes,
} from "../routes/resource-activation-routes.js";

function makeSessions(map: Record<string, { cwd: string; status?: string }>) {
  return {
    get: (sid: string) => (map[sid] ? { cwd: map[sid].cwd, status: map[sid].status ?? "idle" } : undefined),
  } as any;
}

function makeGateway(sessions: Record<string, { cwd: string; status?: string }>) {
  const ids = Object.keys(sessions);
  const sent: Array<{ sid: string; text: string }> = [];
  const gw = {
    getConnectedSessionIds: () => ids,
    findSessionsByCwd: (cwd: string) =>
      ids.filter((sid) => {
        const c = sessions[sid].cwd;
        return c === cwd || c.startsWith(`${cwd}/`) || cwd.startsWith(`${c}/`);
      }),
    sendToSession: (sid: string, msg: any) => {
      sent.push({ sid, text: msg.text });
      return true;
    },
  } as any;
  return { gw, sent };
}

const passGuard = async () => {};

describe("resource-activation-routes", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    applyResourceToggleMock.mockResolvedValue({ ok: true });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("toggle returns affectedSessions scoped to the folder (local)", async () => {
    const { gw } = makeGateway({
      a: { cwd: "/proj/x" },
      b: { cwd: "/proj/x/sub" },
      c: { cwd: "/other" },
    });
    app = Fastify();
    registerResourceActivationRoutes(app, {
      networkGuard: passGuard,
      piGateway: gw,
      sessionManager: makeSessions({ a: { cwd: "/proj/x" }, b: { cwd: "/proj/x/sub" }, c: { cwd: "/other" } }),
    });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/resources/toggle",
      payload: { scope: "local", cwd: "/proj/x", type: "extension", filePath: "/proj/x/.pi/e.ts", enabled: false },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.affectedSessions.sort()).toEqual(["a", "b"]);
  });

  it("toggle propagates the write error status (404)", async () => {
    applyResourceToggleMock.mockResolvedValue({ ok: false, status: 404, error: "not found" });
    const { gw } = makeGateway({});
    app = Fastify();
    registerResourceActivationRoutes(app, { networkGuard: passGuard, piGateway: gw, sessionManager: makeSessions({}) });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/resources/toggle",
      payload: { scope: "global", type: "skill", filePath: "/x", enabled: false },
    });
    expect(res.statusCode).toBe(404);
  });

  it("toggle is rejected when the network guard denies (unauthenticated)", async () => {
    const denyGuard = async (_req: any, reply: any) => {
      reply.code(401).send({ success: false, error: "unauthorized" });
    };
    const { gw } = makeGateway({});
    app = Fastify();
    registerResourceActivationRoutes(app, { networkGuard: denyGuard, piGateway: gw, sessionManager: makeSessions({}) });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/resources/toggle",
      payload: { scope: "global", type: "skill", filePath: "/x", enabled: false },
    });
    expect(res.statusCode).toBe(401);
    expect(applyResourceToggleMock).not.toHaveBeenCalled();
  });

  it("reload local targets only the folder's sessions", async () => {
    const sessions = { a: { cwd: "/proj/x" }, b: { cwd: "/proj/x/sub" }, c: { cwd: "/other" } };
    const { gw, sent } = makeGateway(sessions);
    app = Fastify();
    registerResourceActivationRoutes(app, { networkGuard: passGuard, piGateway: gw, sessionManager: makeSessions(sessions) });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/resources/reload",
      payload: { scope: "local", cwd: "/proj/x" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.reloaded).toBe(2);
    expect(sent.map((s) => s.sid).sort()).toEqual(["a", "b"]);
    expect(sent.every((s) => s.text === "/reload")).toBe(true);
  });

  it("reload global targets all connected sessions", async () => {
    const sessions = { a: { cwd: "/proj/x" }, b: { cwd: "/other" } };
    const { gw, sent } = makeGateway(sessions);
    app = Fastify();
    registerResourceActivationRoutes(app, { networkGuard: passGuard, piGateway: gw, sessionManager: makeSessions(sessions) });
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/api/resources/reload", payload: { scope: "global" } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.reloaded).toBe(2);
    expect(sent.map((s) => s.sid).sort()).toEqual(["a", "b"]);
  });
});

/**
 * End-to-end route tests that drive the REAL pi-delegating write, because the
 * directional guard and the trust gate are properties of that write and cannot
 * be observed through a mock. See change: project-scope-disable-global-resources.
 */
describe("resource-activation-routes \u2014 guard and trust gate (real write)", () => {
  let app: FastifyInstance;
  let cwd: string;
  const HOME = os.homedir();
  const agentDir = path.join(HOME, ".pi", "agent");
  const trustFile = path.join(agentDir, "trust.json");

  async function piCore() {
    const mod = await vi.importActual<typeof import("../pi/pi-resource-activation.js")>(
      "../pi/pi-resource-activation.js",
    );
    return mod.getPiCore();
  }

  function writeDirSkill(base: string, name: string): string {
    const dir = path.join(base, "skills", name);
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, "SKILL.md");
    fs.writeFileSync(p, `---\nname: ${name}\ndescription: ${name}\n---\nbody`);
    return p;
  }

  function localSettings(dir = cwd) {
    return path.join(dir, ".pi", "settings.json");
  }

  function setDefaultProjectTrust(value: "always" | "never" | "ask") {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: value }));
  }

  async function boot() {
    const { gw } = makeGateway({});
    app = Fastify();
    registerResourceActivationRoutes(app, {
      networkGuard: passGuard,
      piGateway: gw,
      sessionManager: makeSessions({}),
    });
    await app.ready();
  }

  function toggleBody(over: Record<string, unknown>) {
    return { scope: "local", cwd, type: "skill", enabled: false, ...over };
  }

  beforeEach(async () => {
    __resetTrustChallenges();
    const actual = await vi.importActual<typeof import("../pi/resource-activation-toggle.js")>(
      "../pi/resource-activation-toggle.js",
    );
    applyResourceToggleMock.mockImplementation(actual.applyResourceToggle);
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-routes-cwd-"));
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.mkdirSync(agentDir, { recursive: true });
    fs.rmSync(path.join(HOME, ".pi", "dashboard", "resource-entry-ownership.json"), { force: true });
    await boot();
  });

  afterEach(async () => {
    if (app) await app.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  async function recordTrust(dir: string, decision: boolean) {
    const { ProjectTrustStore } = await piCore();
    new ProjectTrustStore(agentDir).set(dir, decision);
  }

  it("rejects a global-scope toggle of a project resource with 400, not 404 [E32]", async () => {
    const skill = writeDirSkill(path.join(cwd, ".pi"), "local-demo");
    const res = await app.inject({
      method: "POST",
      url: "/api/resources/toggle",
      payload: { scope: "global", cwd, type: "skill", filePath: skill, enabled: false },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/scope mismatch/i);
    expect(fs.existsSync(localSettings())).toBe(false);
    expect(fs.existsSync(path.join(agentDir, "settings.json"))).toBe(false);
  });

  it("applies a toggle directly when trust is recorded, with no prompt [E35]", async () => {
    const skill = writeDirSkill(agentDir, "gskill");
    await recordTrust(cwd, true);
    const res = await app.inject({
      method: "POST",
      url: "/api/resources/toggle",
      payload: toggleBody({ filePath: skill }),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });

  it("refuses and writes nothing when a refusal is recorded [E36]", async () => {
    const skill = writeDirSkill(agentDir, "gskill");
    await recordTrust(cwd, false);
    const res = await app.inject({
      method: "POST",
      url: "/api/resources/toggle",
      payload: toggleBody({ filePath: skill }),
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.data?.trustRequired).toBeUndefined();
    expect(fs.existsSync(localSettings())).toBe(false);
  });

  it("offers the prompt when the refusal was inherited from an ancestor, not this folder", async () => {
    // pi resolves the nearest ancestor decision, and its own prompt lets a user
    // trust a nearer folder to override one. A hard refusal here would block an
    // enable pi itself would allow.
    const skill = writeDirSkill(agentDir, "gskill");
    const nested = path.join(cwd, "nested");
    fs.mkdirSync(nested, { recursive: true });
    await recordTrust(cwd, false);

    const res = await app.inject({
      method: "POST",
      url: "/api/resources/toggle",
      payload: { scope: "local", cwd: nested, type: "skill", filePath: skill, enabled: false },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).data.trustRequired).toBe(true);
  });

  it("lets defaultProjectTrust decide when nothing is recorded [E37]", async () => {
    const skill = writeDirSkill(agentDir, "gskill");
    const { ProjectTrustStore } = await piCore();

    // always → proceeds WITHOUT recording a trust decision.
    setDefaultProjectTrust("always");
    let res = await app.inject({
      method: "POST",
      url: "/api/resources/toggle",
      payload: toggleBody({ filePath: skill }),
    });
    expect(res.statusCode).toBe(200);
    expect(new ProjectTrustStore(agentDir).get(cwd)).toBeNull();

    // never → refused, no prompt.
    const cwd2 = fs.mkdtempSync(path.join(os.tmpdir(), "pi-routes-never-"));
    setDefaultProjectTrust("never");
    res = await app.inject({
      method: "POST",
      url: "/api/resources/toggle",
      payload: { scope: "local", cwd: cwd2, type: "skill", filePath: skill, enabled: false },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).data?.trustRequired).toBeUndefined();
    expect(fs.existsSync(path.join(cwd2, ".pi", "settings.json"))).toBe(false);

    // ask → trust_required with the offered options.
    const cwd3 = fs.mkdtempSync(path.join(os.tmpdir(), "pi-routes-ask-"));
    setDefaultProjectTrust("ask");
    res = await app.inject({
      method: "POST",
      url: "/api/resources/toggle",
      payload: { scope: "local", cwd: cwd3, type: "skill", filePath: skill, enabled: false },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.data.trustRequired).toBe(true);
    expect(body.data.trustOptions.map((o: { id: string }) => o.id)).toEqual([
      "trust",
      "trust-parent",
      "decline",
    ]);
    // No session-scoped option: the artefact written outlives any session.
    expect(JSON.stringify(body.data.trustOptions)).not.toMatch(/session/i);
    expect(fs.existsSync(path.join(cwd3, ".pi", "settings.json"))).toBe(false);

    fs.rmSync(cwd2, { recursive: true, force: true });
    fs.rmSync(cwd3, { recursive: true, force: true });
  });

  it("prompts for an implicitly-trusted folder and explains why [E38]", async () => {
    const skill = writeDirSkill(agentDir, "gskill");
    // `cwd` has no .pi directory, so pi would load it as trusted today.
    const res = await app.inject({
      method: "POST",
      url: "/api/resources/toggle",
      payload: toggleBody({ filePath: skill }),
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.data.trustRequired).toBe(true);
    expect(body.data.implicitlyTrusted).toBe(true);
    expect(body.error).toMatch(/implicitly/i);
    expect(fs.existsSync(localSettings())).toBe(false);
  });

  it("persists only a known trust option, re-deriving its updates server-side", async () => {
    const { ProjectTrustStore } = await piCore();
    const skill = writeDirSkill(agentDir, "gskill");

    // Without an outstanding challenge the endpoint refuses outright, so a
    // caller cannot plant a durable trust record for a path of its choosing.
    const ungrounded = await app.inject({
      method: "POST",
      url: "/api/resources/trust",
      payload: { cwd, optionId: "trust" },
    });
    expect(ungrounded.statusCode).toBe(409);
    expect(new ProjectTrustStore(agentDir).get(cwd)).toBeNull();

    // A real toggle raises the challenge.
    const challenge = await app.inject({
      method: "POST",
      url: "/api/resources/toggle",
      payload: toggleBody({ filePath: skill }),
    });
    expect(JSON.parse(challenge.body).data.trustRequired).toBe(true);

    const bad = await app.inject({
      method: "POST",
      url: "/api/resources/trust",
      payload: { cwd, optionId: "grant-everything" },
    });
    expect(bad.statusCode).toBe(400);

    const decline = await app.inject({
      method: "POST",
      url: "/api/resources/trust",
      payload: { cwd, optionId: "decline" },
    });
    expect(decline.statusCode).toBe(200);
    // Declining records nothing.
    expect(new ProjectTrustStore(agentDir).get(cwd)).toBeNull();

    // Re-raise the challenge (declining consumed it).
    await app.inject({ method: "POST", url: "/api/resources/toggle", payload: toggleBody({ filePath: skill }) });
    const ok = await app.inject({
      method: "POST",
      url: "/api/resources/trust",
      payload: { cwd, optionId: "trust" },
    });
    expect(ok.statusCode).toBe(200);
    expect(new ProjectTrustStore(agentDir).get(cwd)).toBe(true);
  });

  it("surfaces a trust-store write failure and writes no settings [X2]", async () => {
    const skill = writeDirSkill(agentDir, "gskill");
    // The toggle raises the trust challenge the approval answers.
    await app.inject({ method: "POST", url: "/api/resources/toggle", payload: toggleBody({ filePath: skill }) });
    // An unreadable trust store makes pi's own `setMany` throw.
    fs.writeFileSync(trustFile, "{ not json");
    const res = await app.inject({
      method: "POST",
      url: "/api/resources/trust",
      payload: { cwd, optionId: "trust" },
    });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/trust/i);

    // The toggle it was meant to unblock still does not write.
    const toggled = await app.inject({
      method: "POST",
      url: "/api/resources/toggle",
      payload: toggleBody({ filePath: skill }),
    });
    expect(toggled.statusCode).not.toBe(200);
    expect(fs.existsSync(localSettings())).toBe(false);
  });

  it("lets two rapid toggles in the same folder both survive [E40]", async () => {
    const one = writeDirSkill(agentDir, "one");
    const two = writeDirSkill(agentDir, "two");
    await recordTrust(cwd, true);

    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: "/api/resources/toggle", payload: toggleBody({ filePath: one }) }),
      app.inject({ method: "POST", url: "/api/resources/toggle", payload: toggleBody({ filePath: two }) }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);

    const settings = JSON.parse(fs.readFileSync(localSettings(), "utf-8"));
    expect(settings.skills).toContain("~/.pi/agent/skills/one/SKILL.md");
    expect(settings.skills).toContain("~/.pi/agent/skills/two/SKILL.md");

    const { DefaultPackageManager, SettingsManager } = await piCore();
    const sm = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
    const resolved = await new DefaultPackageManager({ cwd, agentDir, settingsManager: sm }).resolve(
      async () => "skip",
    );
    const state = new Map(resolved.skills.map((r) => [r.path, r.enabled]));
    expect(state.get(one)).toBe(false);
    expect(state.get(two)).toBe(false);
  });
});
