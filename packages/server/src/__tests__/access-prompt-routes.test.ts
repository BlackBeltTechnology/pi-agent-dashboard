/**
 * Access-prompt review API (change: add-access-grant-dialog, tasks 8.1, 8.2,
 * 8b.7b, 8b.8, 2b.9; test-plan #E36, #E37).
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetAccessGrants, listGrants } from "../access/access-grants.js";
import { AccessPlaneRegistry } from "../access/access-plane.js";
import { GrantCoordinator } from "../access/grant-coordinator.js";
import { createFilesystemPlane } from "../access/planes.js";
import {
  __resetRefusalLedger,
  clearRefusal,
  isRefused,
  listRefusals,
  recordRefusal,
} from "../access/refusal-ledger.js";
import { YoloController } from "../access/yolo-session.js";
import { registerAccessPromptRoutes } from "../routes/access-prompt-routes.js";

let tmp: string;
let work: string;
let mode: "enforce" | "report";
let enabled: boolean;
let killed: boolean;
const apps: FastifyInstance[] = [];

beforeEach(() => {
  // Under the real home so no forbidden system prefix (macOS /private tmp)
  // makes the test subjects ungrantable.
  tmp = fs.mkdtempSync(path.join(os.homedir(), "access-prompt-routes-"));
  fs.mkdirSync(path.join(tmp, "work", "proj", "src"), { recursive: true });
  work = fs.realpathSync(path.join(tmp, "work", "proj", "src"));
  process.env.PI_ACCESS_GRANTS_STORE = path.join(tmp, "access-grants.json");
  process.env.PI_ACCESS_REFUSALS_STORE = path.join(tmp, "access-refusals.json");
  __resetAccessGrants();
  __resetRefusalLedger();
  mode = "enforce";
  enabled = true;
  killed = false;
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  delete process.env.PI_ACCESS_GRANTS_STORE;
  delete process.env.PI_ACCESS_REFUSALS_STORE;
  __resetAccessGrants();
  __resetRefusalLedger();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function makeApp() {
  const planes = new AccessPlaneRegistry();
  planes.register(createFilesystemPlane());
  const yolo = new YoloController({ hostGateMode: () => mode, isRefused });
  const coordinator = new GrantCoordinator({
    planes,
    yolo,
    recordRefusal: (plane, subject) => void recordRefusal(plane, subject),
    broadcast: () => {},
    hostGateMode: () => mode,
    promptEnabled: () => enabled,
    killSwitch: () => killed,
    operatorChannels: () => 1,
    onTransition: () => {},
  });
  const app = Fastify({ logger: false });
  apps.push(app);
  registerAccessPromptRoutes(app, {
    networkGuard: async () => {},
    coordinator,
    planes,
    yolo,
    prompting: () => ({ enabled, killSwitch: killed, hostGateMode: mode }),
    listRefusals,
    clearRefusal,
  });
  await app.ready();
  return { app, coordinator, yolo };
}

const deny = (c: GrantCoordinator, subject: string, capability = true) =>
  c.onDenial(
    { plane: "filesystem", rawSubject: subject, origin: "session-1", channel: "sock-A", requestHoldsCapability: capability },
    false,
  );

const view = async (app: FastifyInstance) => {
  const res = await app.inject({ method: "GET", url: "/api/access/prompts" });
  expect(res.statusCode).toBe(200);
  return res.json().data;
};

describe("8.1 pending requests are listed and answerable on the Access page", () => {
  it("answers a pending request from the page with prompting disabled; the grant is prompt-originated (8.2)", async () => {
    enabled = false;
    const { app, coordinator } = await makeApp();
    deny(coordinator, work);
    const v = await view(app);
    expect(v.prompting.blockers).toEqual(["disabled"]);
    expect(v.pending).toHaveLength(1);
    const [p] = v.pending;
    expect(p).toMatchObject({ plane: "filesystem", subject: work, prompted: false, suppressedBy: "disabled" });
    expect(p).not.toHaveProperty("channel");
    expect(p.copy.verdicts).toEqual(["allow-once", "allow-always", "deny"]);

    const res = await app.inject({
      method: "POST",
      url: `/api/access/prompts/${p.promptId}`,
      payload: { plane: "filesystem", subject: work, verdict: "allow-always" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ outcome: "allow-always", store: "access-grants.json" });
    expect(listGrants().find((g) => g.subject === work)).toMatchObject({ via: "prompt", origin: "session-1" });

    const after = await view(app);
    expect(after.pending).toHaveLength(0);
    expect(after.verdicts[0]).toMatchObject({ answeredBy: "operator", outcome: "allow-always", store: "access-grants.json" });
  });

  it("records a widened verdict with the subject it widened from", async () => {
    enabled = false;
    const { app, coordinator } = await makeApp();
    coordinator.onDenial(
      {
        plane: "filesystem",
        rawSubject: work,
        ancestors: [path.dirname(work)],
        origin: "s",
        channel: "c",
        requestHoldsCapability: true,
      },
      false,
    );
    const [p] = (await view(app)).pending;
    const res = await app.inject({
      method: "POST",
      url: `/api/access/prompts/${p.promptId}`,
      payload: { plane: "filesystem", subject: path.dirname(work), verdict: "allow-always" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ subject: path.dirname(work), widenedFrom: work });
  });

  it("maps refusals to status codes: unoffered 403, unknown 404, duplicate 409, malformed 400", async () => {
    const { app, coordinator } = await makeApp();
    deny(coordinator, work);
    const [p] = (await view(app)).pending;
    const post = (id: string, payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: `/api/access/prompts/${id}`, payload });
    expect((await post(p.promptId, { plane: "filesystem", subject: tmp, verdict: "allow-always" })).statusCode).toBe(403);
    expect((await post("nope", { plane: "filesystem", subject: work, verdict: "deny" })).statusCode).toBe(404);
    expect((await post(p.promptId, { plane: "filesystem", subject: work, verdict: "maybe" })).statusCode).toBe(400);
    expect((await post(p.promptId, { plane: "filesystem", subject: work, verdict: "deny" })).statusCode).toBe(200);
    expect((await post(p.promptId, { plane: "filesystem", subject: work, verdict: "deny" })).statusCode).toBe(409);
    expect(listGrants()).toHaveLength(0);
  });

  it("refuses a remote unauthenticated answer (401) and writes nothing", async () => {
    const { app, coordinator } = await makeApp();
    deny(coordinator, work);
    const [p] = (await view(app)).pending;
    const res = await app.inject({
      method: "POST",
      url: `/api/access/prompts/${p.promptId}`,
      remoteAddress: "203.0.113.9",
      payload: { plane: "filesystem", subject: work, verdict: "allow-always" },
    });
    expect(res.statusCode).toBe(401);
    expect(listGrants()).toHaveLength(0);
    expect((await view(app)).pending).toHaveLength(1);
  });
});

describe("8.3 prompting blockers name every reason, including both at once", () => {
  it("report mode and the kill switch are listed together", async () => {
    mode = "report";
    killed = true;
    const { app } = await makeApp();
    const v = await view(app);
    expect(v.prompting.blockers).toEqual(["report-mode", "kill-switch"]);
    expect(v.yolo.available).toBe(false);
  });

  it("nothing blocks under enforce with prompting on", async () => {
    const { app } = await makeApp();
    expect((await view(app)).prompting.blockers).toEqual([]);
  });
});

describe("8b YOLO over the API", () => {
  it("#E36 report mode: activation refused with its reason, no session", async () => {
    mode = "report";
    const { app, yolo } = await makeApp();
    const res = await app.inject({ method: "POST", url: "/api/access/yolo", payload: { durationMinutes: 15, base: work } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("report-mode");
    expect(yolo.status()).toBeNull();
  });

  it("8b.7b a second activation adds its root to the ONE session and leaves the timer unchanged", async () => {
    const { app } = await makeApp();
    fs.mkdirSync(path.join(tmp, "work", "other"));
    const other = fs.realpathSync(path.join(tmp, "work", "other"));
    const first = await app.inject({ method: "POST", url: "/api/access/yolo", payload: { durationMinutes: 15, base: work } });
    expect(first.statusCode).toBe(200);
    const expiresAt = first.json().data.session.expiresAt;
    const second = await app.inject({ method: "POST", url: "/api/access/yolo", payload: { durationMinutes: 60, base: other } });
    expect(second.statusCode).toBe(200);
    expect(second.json().data).toMatchObject({ added: true, session: { expiresAt } });
    expect(second.json().data.session.roots.map((r: { path: string }) => r.path)).toEqual([work, other]);
  });

  it("rejects durations outside the shipped set", async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: "POST", url: "/api/access/yolo", payload: { durationMinutes: 999, base: work } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid-duration");
    expect((await view(app)).yolo.durationsMinutes).toEqual([15, 30, 60]);
  });

  it("8b.8 auto-allowed subjects stay listed, distinguished, after the session ends", async () => {
    const { app, coordinator } = await makeApp();
    await app.inject({ method: "POST", url: "/api/access/yolo", payload: { durationMinutes: 15, base: work } });
    const hold = deny(coordinator, work);
    expect((await hold.result).kind).toBe("allow");
    expect((await app.inject({ method: "DELETE", url: "/api/access/yolo" })).statusCode).toBe(200);
    const v = await view(app);
    expect(v.yolo.session).toBeNull();
    expect(v.verdicts[0]).toMatchObject({ answeredBy: "yolo", outcome: "auto-allowed", subject: work });
    expect(v.pending).toHaveLength(0);
  });

  it("offers the base and its ladder as roots", async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: "GET", url: `/api/access/yolo/roots?base=${encodeURIComponent(work)}` });
    expect(res.json().data.roots[0]).toBe(work);
  });
});

describe("#E37 remembered refusals are listed and clearable", () => {
  it("an operator deny is listed, then cleared through the API", async () => {
    const { app, coordinator } = await makeApp();
    deny(coordinator, work);
    const [p] = (await view(app)).pending;
    await app.inject({
      method: "POST",
      url: `/api/access/prompts/${p.promptId}`,
      payload: { plane: "filesystem", subject: work, verdict: "deny" },
    });
    expect((await view(app)).refusals).toEqual([expect.objectContaining({ plane: "filesystem", subject: work })]);
    const q = `plane=filesystem&subject=${encodeURIComponent(work)}`;
    expect((await app.inject({ method: "DELETE", url: `/api/access/refusals?${q}` })).statusCode).toBe(200);
    expect((await view(app)).refusals).toEqual([]);
    expect((await app.inject({ method: "DELETE", url: `/api/access/refusals?${q}` })).statusCode).toBe(404);
  });
});
