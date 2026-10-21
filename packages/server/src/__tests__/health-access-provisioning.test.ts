/**
 * Provisioning observability (change: add-access-provisioning, tasks 2.5, 2.37;
 * test-plan #X10): one `[access-provision]` line per transition carrying the id and
 * the JSON-quoted project, and `accessGrants.provisioning` counters on `/api/health`.
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetAccessGrants } from "../access/access-grants.js";
import { type AccessGrantHealth, snapshotAccessGrantHealth } from "../access/access-health.js";
import { AccessPlaneRegistry } from "../access/access-plane.js";
import { GrantCoordinator } from "../access/grant-coordinator.js";
import { createFilesystemPlane } from "../access/planes.js";
import { createDefaultProvisioningGrantStore, PROVISION_TTL_MS, ProvisioningRegistry } from "../access/provisioning.js";
import { __resetRefusalLedger } from "../access/refusal-ledger.js";
import { registerSystemRoutes } from "../routes/system-routes.js";

let tmp: string;
let w: string;
let clock: number;
let logs: string[];
const apps: FastifyInstance[] = [];

const dir = (...segs: string[]) => {
  const p = path.join(...segs);
  fs.mkdirSync(p, { recursive: true });
  return p;
};

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-prov-health-")));
  w = dir(tmp, "w");
  clock = 1_000_000;
  logs = [];
  process.env.PI_ACCESS_GRANTS_STORE = path.join(tmp, "access-grants.json");
  process.env.PI_ACCESS_REFUSALS_STORE = path.join(tmp, "access-refusals.json");
  __resetAccessGrants();
  __resetRefusalLedger();
  for (const n of ["p1", "p2"]) dir(w, n, ".git");
  for (const n of ["a", "b", "c"]) dir(w, n);
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  delete process.env.PI_ACCESS_GRANTS_STORE;
  delete process.env.PI_ACCESS_REFUSALS_STORE;
  __resetAccessGrants();
  __resetRefusalLedger();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function registry() {
  return new ProvisioningRegistry({
    now: () => clock,
    grants: createDefaultProvisioningGrantStore(),
    mirror: () => null,
    ladder: { killSwitch: () => false, promptEnabled: () => true, hostGateMode: () => "enforce", operatorCount: () => 1 },
    env: { homedir: dir(tmp, "home"), platform: "darwin" },
    log: (l) => logs.push(l),
  });
}

const coordinator = () => {
  const planes = new AccessPlaneRegistry();
  planes.register(createFilesystemPlane());
  return new GrantCoordinator({
    planes,
    broadcast: () => {},
    hostGateMode: () => "enforce",
    promptEnabled: () => true,
    killSwitch: () => false,
    operatorChannels: () => 1,
    onTransition: () => {},
  });
};
const yoloIdle = { status: () => null, counters: () => ({ autoAllowed: 0, refusedByPriorRefusal: 0 }) };
const baseDeps = () => ({
  coordinator: coordinator(),
  yolo: yoloIdle,
  refusalCount: () => 0,
  promptEnabled: () => true,
  killSwitch: () => false,
  hostGateMode: () => "enforce" as const,
  operatorChannels: () => 1,
});

async function health(readAccessGrants: () => AccessGrantHealth): Promise<Record<string, any>> {
  const app = Fastify({ logger: false });
  apps.push(app);
  registerSystemRoutes(app, {
    sessionManager: { listActive: () => [], listAll: () => [] },
    preferencesStore: { flush: () => {} },
    metaPersistence: { flushAll: () => {} },
    config: { port: 8000, piPort: 9999, dev: false },
    networkGuard: async () => {},
    version: "test",
    clientDir: null,
    readAccessGrants,
  } as never);
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/api/health" });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe("2.37 / #X10 transition logs and health counters", () => {
  it("logs one line per transition (id + JSON-quoted project) and counts them on /api/health", async () => {
    const reg = registry();
    const p1 = path.join(w, "p1");
    const p2 = path.join(w, "p2");

    // create → settle (1 approve, 1 reject)
    const c1 = reg.create({ projectRoot: p1, lines: [{ path: path.join(w, "a") }, { path: path.join(w, "b") }] });
    if (!c1.ok) throw new Error(c1.error);
    const [la, lb] = c1.request.lines;
    const settled = await reg.settle(c1.request.requestId, {
      lines: [{ lineId: la.lineId, verdict: "approve" }, { lineId: lb.lineId, verdict: "reject" }],
    });
    expect(settled.ok).toBe(true);

    // create → expire
    clock += 1_000;
    const c2 = reg.create({ projectRoot: p2, lines: [{ path: path.join(w, "c") }] });
    if (!c2.ok) throw new Error(c2.error);
    clock += PROVISION_TTL_MS;
    expect(reg.expire()).toHaveLength(1);

    // a refused POST
    expect(reg.create({ projectRoot: "relative", lines: [{ path: "x" }] })).toMatchObject({ ok: false });

    const transitions = logs.filter((l) => /^\[access-provision\] (created|settled|dismissed|expired|refused) /.test(l));
    expect(transitions.map((l) => l.split(" ")[1])).toEqual(["created", "settled", "created", "expired", "refused"]);
    expect(transitions[0]).toContain(`id=${c1.request.requestId} project=${JSON.stringify(p1)}`);
    expect(transitions[1]).toContain(`id=${c1.request.requestId} project=${JSON.stringify(p1)}`);
    expect(transitions[3]).toContain(`id=${c2.request.requestId} project=${JSON.stringify(p2)}`);
    expect(transitions[4]).toContain('project="relative"');

    const snap = snapshotAccessGrantHealth({ ...baseDeps(), provisioning: () => reg.stats() });
    const body = await health(() => snap);
    expect(body.accessGrants.provisioning).toEqual({
      pending: 0,
      created: 2,
      approved: 1,
      rejected: 1,
      dismissed: 0,
      expired: 1,
      refused: 1,
      droppedResponses: 0,
    });
    // The pre-existing fields are untouched.
    expect(body.accessGrants.prompting).toEqual({ enabled: true, killSwitch: false, hostGateMode: "enforce", operatorChannels: 1 });
  });

  it("the field is additive: a snapshot without a provisioning reader omits it, and /api/health still serves it", async () => {
    const snap = snapshotAccessGrantHealth(baseDeps());
    expect("provisioning" in snap).toBe(false);
    const body = await health(() => snap);
    expect(body.accessGrants).toEqual(JSON.parse(JSON.stringify(snap)));
    expect(body.accessGrants.provisioning).toBeUndefined();
  });
});
