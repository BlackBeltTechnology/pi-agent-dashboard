/**
 * Provisioning routes (change: add-access-provisioning, tasks 2.3, 2.7, 2.8,
 * 2.13, 2.18, 2.26, 2.29; test-plan #E1, #E2, #E7, #E12, #E27, #X1).
 *
 * Real filesystem fixture, the real grant store (`PI_ACCESS_GRANTS_STORE`) and the
 * real registry; the ladder readers and the clock are test-controlled. Capability
 * comes from the real `issuePromptChannel` + `X-Pi-Grant-Channel` header.
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetAccessGrants, accessGrantsStorePath, listGrants } from "../access/access-grants.js";
import {
  __resetPromptChannels,
  GRANT_CHANNEL_HEADER,
  type HostGateMode,
  issuePromptChannel,
} from "../access/prompt-channel.js";
import { createDefaultProvisioningGrantStore, ProvisioningRegistry } from "../access/provisioning.js";
import { __resetRefusalLedger } from "../access/refusal-ledger.js";
import { registerAccessRoutes } from "../routes/access-routes.js";

let tmp: string;
let home: string;
let w: string;
let clock: number;
let state: { kill: boolean; prompt: boolean; mode: HostGateMode; operators: number };
let announced: unknown[];
const apps: FastifyInstance[] = [];

const dir = (...segs: string[]) => {
  const p = path.join(...segs);
  fs.mkdirSync(p, { recursive: true });
  return p;
};

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-prov-routes-")));
  w = dir(tmp, "w");
  home = dir(tmp, "home");
  clock = 1_000_000;
  state = { kill: false, prompt: true, mode: "enforce", operators: 1 };
  announced = [];
  process.env.PI_ACCESS_GRANTS_STORE = path.join(tmp, "access-grants.json");
  process.env.PI_ACCESS_REFUSALS_STORE = path.join(tmp, "access-refusals.json");
  __resetAccessGrants();
  __resetRefusalLedger();
  __resetPromptChannels();
  dir(w, "app", ".git");
  dir(w, "onlypi", ".pi");
  dir(w, "nogit");
  dir(home, ".git");
  fs.writeFileSync(path.join(w, "file.txt"), "x");
  for (const n of ["lib", "real", "other"]) dir(w, n);
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  delete process.env.PI_ACCESS_GRANTS_STORE;
  delete process.env.PI_ACCESS_REFUSALS_STORE;
  __resetAccessGrants();
  __resetRefusalLedger();
  __resetPromptChannels();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function makeApp() {
  const registry = new ProvisioningRegistry({
    now: () => clock,
    grants: createDefaultProvisioningGrantStore(),
    mirror: () => null,
    ladder: {
      killSwitch: () => state.kill,
      promptEnabled: () => state.prompt,
      hostGateMode: () => state.mode,
      operatorCount: () => state.operators,
    },
    env: { homedir: home, platform: "darwin" },
    log: () => {},
  });
  const app = Fastify({ logger: false });
  apps.push(app);
  registerAccessRoutes(app, {
    networkGuard: async () => {},
    preferencesStore: {} as never,
    writeConfigPartial: () => ({ success: true }),
    provisioning: { registry, announce: (v) => announced.push(v) },
  });
  await app.ready();
  return { app, registry };
}

const post = (app: FastifyInstance, payload: unknown) =>
  app.inject({ method: "POST", url: "/api/access/provision", payload: payload as object });

/** One fresh app + request per case: the per-root / global rate limits are not under test here. */
async function postFresh(payload: unknown) {
  const { app, registry } = await makeApp();
  const res = await post(app, payload);
  return { res, body: res.json(), registry, app };
}

describe("2.7 / #E1 a request proposes and never writes", () => {
  it("answers 200 with the request id and each line's classification; the grant store stays absent", async () => {
    const { res, body, registry } = await postFresh({
      projectRoot: path.join(w, "app"),
      lines: [{ path: "../lib", why: "tests" }, { path: path.join(w, "real") }],
    });
    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.data.requestId).toBe("string");
    expect(body.data.status).toBe("pending");
    expect(body.data.lines.map((l: { classification: string }) => l.classification)).toEqual(["grantable", "grantable"]);
    expect(fs.existsSync(accessGrantsStorePath())).toBe(false);
    expect(listGrants()).toEqual([]);
    expect(registry.list()).toHaveLength(1);
    expect(announced).toHaveLength(1);
  });
});

describe("2.8 / #E2 line-count and empty-request boundaries", () => {
  const root = () => path.join(w, "app");
  const lines = (n: number) => {
    const out: { path: string }[] = [];
    for (let i = 0; i < n; i++) out.push({ path: dir(w, "many", `d${i}`) });
    return out;
  };

  it("0 lines + 0 goals → 400 empty", async () => {
    const { res, body, registry } = await postFresh({ projectRoot: root(), lines: [] });
    expect(res.statusCode).toBe(400);
    expect(body).toMatchObject({ success: false, error: "empty" });
    expect(registry.list()).toEqual([]);
  });

  it("0 lines + goal lan → 200", async () => {
    const { res, body } = await postFresh({ projectRoot: root(), lines: [], remote: ["lan"] });
    expect(res.statusCode).toBe(200);
    expect(body.data.remote).toEqual([{ target: "lan" }]);
  });

  it.each([1, 31, 32])("%i lines → 200", async (n) => {
    const { res } = await postFresh({ projectRoot: root(), lines: lines(n) });
    expect(res.statusCode).toBe(200);
  });

  it("33 lines (32 distinct + 1 duplicate) → 400 too-many-lines and nothing pending", async () => {
    const l = lines(32);
    const { res, body, registry } = await postFresh({ projectRoot: root(), lines: [...l, l[0]] });
    expect(res.statusCode).toBe(400);
    expect(body).toMatchObject({ success: false, error: "too-many-lines" });
    expect(registry.list()).toEqual([]);
  });
});

describe("2.13 / #E7 project-root validation decision table", () => {
  const lines = () => [{ path: path.join(w, "lib") }];

  it.each([
    ["relative", () => "app", "not-absolute"],
    ["no marker", () => path.join(w, "nogit"), "no-marker"],
    ["the home directory", () => home, "forbidden"],
    ["a file", () => path.join(w, "file.txt"), "not-directory"],
  ])("%s → 400 invalid-root with its reason and no pending request", async (_n, root, reason) => {
    const { res, body, registry } = await postFresh({ projectRoot: root(), lines: lines() });
    expect(res.statusCode).toBe(400);
    expect(body).toMatchObject({ success: false, error: "invalid-root", reason });
    expect(registry.list()).toEqual([]);
  });

  it.each([
    ["a root holding only .pi", () => path.join(w, "onlypi")],
    ["a root holding .git", () => path.join(w, "app")],
  ])("%s → 200", async (_n, root) => {
    const { res } = await postFresh({ projectRoot: root(), lines: lines() });
    expect(res.statusCode).toBe(200);
  });
});

describe("2.18 / #E12 the eligibility ladder, first failing rung wins", () => {
  const req = () => ({ projectRoot: path.join(w, "app"), lines: [{ path: path.join(w, "lib") }] });

  it("kill switch → 503; prompting off → 409; report mode → 409; no operator → 409; all clear → 200", async () => {
    // Everything wrong at once: the kill switch (first rung) wins, then each is cleared in turn.
    state = { kill: true, prompt: false, mode: "report", operators: 0 };
    const { app } = await makeApp();
    const seen: Array<[number, string | undefined]> = [];
    const step = async () => {
      const res = await post(app, req());
      seen.push([res.statusCode, res.json().error]);
    };
    await step();
    state.kill = false;
    await step();
    state.prompt = true;
    await step();
    state.mode = "enforce";
    // Still no operator. A capability-holding observe-tier socket is not counted either:
    // that count is asserted against the real gateway in browser-gateway-grant-channel.test.ts.
    await step();
    state.operators = 1;
    await step();
    expect(seen).toEqual([
      [503, "disabled"],
      [409, "prompting-disabled"],
      [409, "report-mode"],
      [409, "no-operator"],
      [200, undefined],
    ]);
  });
});

describe("2.26 / #E27 request status and per-line outcomes", () => {
  it("a settled request reports each line's outcome and the remote hand-off; an unknown id is 404", async () => {
    const { app, registry } = await makeApp();
    const created = (
      await post(app, {
        projectRoot: path.join(w, "app"),
        lines: [{ path: path.join(w, "lib") }, { path: path.join(w, "other") }],
        remote: ["lan"],
      })
    ).json().data;
    const [a, b] = created.lines as { lineId: string }[];

    const pending = await app.inject({ method: "GET", url: `/api/access/provision/${created.requestId}` });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().data.status).toBe("pending");
    expect((await app.inject({ method: "GET", url: "/api/access/provision" })).json().data.requests).toHaveLength(1);

    const settled = await app.inject({
      method: "POST",
      url: `/api/access/provision/${created.requestId}/settle`,
      headers: { [GRANT_CHANNEL_HEADER]: issuePromptChannel("sock-1") },
      payload: { lines: [{ lineId: a.lineId, verdict: "approve" }, { lineId: b.lineId, verdict: "reject" }] },
    });
    expect(settled.statusCode).toBe(200);

    const res = await app.inject({ method: "GET", url: `/api/access/provision/${created.requestId}` });
    const data = res.json().data;
    expect(data.status).toBe("settled");
    expect(data.lines.map((l: { outcome: string }) => l.outcome)).toEqual(["granted", "rejected"]);
    expect(data.remote).toEqual([{ target: "lan", outcome: "handed-off" }]);
    expect(listGrants().map((g) => g.subject)).toEqual([path.join(w, "lib")]);
    expect(registry.list()).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/api/access/provision" })).json().data.requests).toEqual([]);

    const missing = await app.inject({ method: "GET", url: "/api/access/provision/nope" });
    expect(missing.statusCode).toBe(404);
  });

  it("a second answer is 409 already-settled and writes nothing", async () => {
    const { app } = await makeApp();
    const created = (await post(app, { projectRoot: path.join(w, "app"), lines: [{ path: path.join(w, "lib") }] })).json().data;
    const headers = { [GRANT_CHANNEL_HEADER]: issuePromptChannel("sock-1") };
    const url = `/api/access/provision/${created.requestId}/settle`;
    expect((await app.inject({ method: "POST", url, headers, payload: { lines: [] } })).statusCode).toBe(200);
    const again = await app.inject({
      method: "POST",
      url,
      headers,
      payload: { lines: [{ lineId: created.lines[0].lineId, verdict: "approve" }] },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("already-settled");
    expect(listGrants()).toEqual([]);
  });
});

describe("2.29 / #X1 a capability-less HTTP settle is refused", () => {
  it("403 with no header and with a wrong header; the request stays pending and no grant is written", async () => {
    const { app, registry } = await makeApp();
    issuePromptChannel("sock-1"); // a live capability exists, but these requests do not present it
    const created = (await post(app, { projectRoot: path.join(w, "app"), lines: [{ path: path.join(w, "lib") }] })).json().data;
    const url = `/api/access/provision/${created.requestId}/settle`;
    const payload = { lines: [{ lineId: created.lines[0].lineId, verdict: "approve" }] };

    const none = await app.inject({ method: "POST", url, payload });
    const wrong = await app.inject({ method: "POST", url, headers: { [GRANT_CHANNEL_HEADER]: "not-a-capability" }, payload });
    expect(none.statusCode).toBe(403);
    expect(wrong.statusCode).toBe(403);
    expect(none.json()).toMatchObject({ success: false, error: "no-capability" });

    expect(registry.get(created.requestId)?.status).toBe("pending");
    expect(listGrants()).toEqual([]);
    expect(fs.existsSync(accessGrantsStorePath())).toBe(false);
  });

  it("settle re-checks the ladder: the answer is refused and the request stays pending", async () => {
    const { app, registry } = await makeApp();
    const created = (await post(app, { projectRoot: path.join(w, "app"), lines: [{ path: path.join(w, "lib") }] })).json().data;
    state.prompt = false;
    const res = await app.inject({
      method: "POST",
      url: `/api/access/provision/${created.requestId}/settle`,
      headers: { [GRANT_CHANNEL_HEADER]: issuePromptChannel("sock-1") },
      payload: { lines: [{ lineId: created.lines[0].lineId, verdict: "approve" }] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("prompting-disabled");
    expect(registry.get(created.requestId)?.status).toBe("pending");
    expect(listGrants()).toEqual([]);
  });
});

describe("F4 dismiss-all pending provisioning requests (access-settings-tab)", () => {
  const url = "/api/access/provision/dismiss-all";
  const proposeTwo = async (app: FastifyInstance) => {
    const a = (await post(app, { projectRoot: path.join(w, "app"), lines: [{ path: path.join(w, "lib") }] })).json().data;
    const b = (await post(app, { projectRoot: path.join(w, "onlypi"), lines: [{ path: path.join(w, "other") }] })).json().data;
    return [a, b] as { requestId: string }[];
  };

  it("403 no-capability without a live capability: nothing is dismissed", async () => {
    const { app, registry } = await makeApp();
    issuePromptChannel("sock-1"); // live capability exists, but this request does not present it
    const [a, b] = await proposeTwo(app);

    const none = await app.inject({ method: "POST", url });
    const wrong = await app.inject({ method: "POST", url, headers: { [GRANT_CHANNEL_HEADER]: "not-a-capability" } });
    expect(none.statusCode).toBe(403);
    expect(wrong.statusCode).toBe(403);
    expect(none.json()).toMatchObject({ success: false, error: "no-capability" });
    expect(registry.get(a.requestId)?.status).toBe("pending");
    expect(registry.get(b.requestId)?.status).toBe("pending");
    expect(registry.list()).toHaveLength(2);
  });

  it("with a capability: every pending request ends dismissed, no grant, each root cools down (429 within 5 min)", async () => {
    const { app, registry } = await makeApp();
    const [a, b] = await proposeTwo(app);

    const res = await app.inject({ method: "POST", url, headers: { [GRANT_CHANNEL_HEADER]: issuePromptChannel("sock-1") } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { dismissed: 2 } });
    expect(registry.get(a.requestId)?.status).toBe("dismissed");
    expect(registry.get(b.requestId)?.status).toBe("dismissed");
    expect(registry.list()).toEqual([]);
    expect(listGrants()).toEqual([]);
    expect(fs.existsSync(accessGrantsStorePath())).toBe(false);

    clock += 4 * 60_000;
    for (const root of ["app", "onlypi"]) {
      const again = await post(app, { projectRoot: path.join(w, root), lines: [{ path: path.join(w, "real") }] });
      expect(again.statusCode).toBe(429);
      expect(again.json().error).toBe("cooldown");
    }
  });

  it("with a capability and nothing pending: dismissed 0", async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: "POST", url, headers: { [GRANT_CHANNEL_HEADER]: issuePromptChannel("sock-1") } });
    expect(res.json()).toEqual({ success: true, data: { dismissed: 0 } });
  });
});
