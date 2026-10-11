/**
 * services.json lifecycle: absence, corruption, mode, add review, update,
 * remove, instanceId stability, and `add --yes` never prefetching.
 * See change: add-service-registry-core (test-plan E1–E3, E7–E10, E28).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { templateHash } from "@blackbelt-technology/pi-dashboard-shared/services/offers.js";
import type { ServiceTemplate } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetQuarantineDedupForTests } from "../../auth/locked-json-file.js";
import { cmdService } from "../cli-service.js";
import { DefinitionsStore } from "../definitions-store.js";
import { OciDriver } from "../oci-driver.js";
import { servicesPaths } from "../paths.js";
import { buildApp, DIGEST, injectFetch, makeManager, ociDef, recordingRunner, tmpRoot, writeDefinitions } from "./helpers.js";

let root: string;
const apps: FastifyInstance[] = [];
beforeEach(() => {
  root = tmpRoot("svc-defs-");
  _resetQuarantineDedupForTests();
});
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const file = () => path.join(root, "services.json");
const sha = (p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

function doclingOffer(image = DIGEST): ServiceTemplate {
  return {
    schemaVersion: 1,
    id: "docling",
    mode: "managed",
    drivers: ["oci:docker"],
    oci: { image, ports: { http: { container: 5001, protocol: "http" } }, volumes: { "docling-cache": "/cache" } },
    health: { kind: "http", endpoint: "http", path: "/health" },
    secrets: { apikey: { generate: { bytes: 32 } } },
  };
}

function offersOf(...templates: ServiceTemplate[]) {
  return () => ({
    offers: templates.map((t) => ({ package: "@x/docling", version: "1.0.0", template: t, templateHash: templateHash(t) })),
    errors: [],
  });
}

async function app(manager: ReturnType<typeof makeManager>["manager"]) {
  const a = await buildApp(manager);
  apps.push(a);
  return a;
}

describe("E1 — no services.json: nothing listed, nothing executed", () => {
  it("boot + GET /api/services → [] with zero commands", async () => {
    const runner = recordingRunner();
    const { manager } = makeManager(root, { run: runner.run });
    await manager.boot();
    const res = await (await app(manager)).inject({ method: "GET", url: "/api/services" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.services).toEqual([]);
    expect(runner.calls).toEqual([]);
    expect(fs.existsSync(file())).toBe(false);
  });
});

describe("E2 — a corrupt services.json refuses every write", () => {
  it("POST refused, bytes preserved, every service invalid-definition, list names the backup", async () => {
    writeDefinitions(root, [ociDef()]);
    const { manager } = makeManager(root);
    await manager.list(); // learn the id while the file is healthy
    fs.writeFileSync(file(), '{"schemaVersion":1, "services": [ {"id": "docl');
    const before = sha(file());
    const a = await app(manager);
    const res = await a.inject({
      method: "POST",
      url: "/api/services",
      payload: { definition: { id: "web", mode: "external", endpoints: { http: "http://127.0.0.1:9" }, health: { kind: "tcp", endpoint: "http" } } },
    });
    expect(res.statusCode).toBe(409);
    expect(sha(file())).toBe(before);
    const list = (await a.inject({ method: "GET", url: "/api/services" })).json().data;
    expect(list.definitionsCorrupt).toBe(true);
    expect(list.backupPath).toMatch(/services\.json\.corrupt-/);
    expect(fs.readFileSync(list.backupPath, "utf8")).toBe(fs.readFileSync(file(), "utf8"));
    for (const s of list.services) expect([s.state, s.reason]).toEqual(["unavailable", "invalid-definition"]);
    expect(list.services.map((s: { id: string }) => s.id)).toEqual(["docling"]);
    const p = await manager.ensure("docling");
    expect([p.state, p.reason]).toEqual(["unavailable", "invalid-definition"]);
  });
});

describe("E3 — writes are owner-only", () => {
  it("a 0644 file is 0600 after an add", async () => {
    writeDefinitions(root, []);
    fs.chmodSync(file(), 0o644);
    const { manager } = makeManager(root);
    await manager.add({ definition: { id: "web", mode: "external", endpoints: { http: "http://127.0.0.1:9" }, health: { kind: "tcp", endpoint: "http" } } });
    expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
  });
});

describe("E7 — dry-run review writes nothing", () => {
  it("returns digest, ports, volumes, secret names and templateHash; file sha unchanged", async () => {
    writeDefinitions(root, []);
    const before = sha(file());
    const { manager } = makeManager(root, { discoverOffers: offersOf(doclingOffer()) });
    const res = await (await app(manager)).inject({ method: "POST", url: "/api/services", payload: { offer: "docling", dryRun: true } });
    expect(res.statusCode).toBe(200);
    const review = res.json().data.review;
    expect(review).toMatchObject({
      id: "docling",
      image: DIGEST,
      ports: ["http"],
      volumes: ["docling-cache"],
      secrets: ["apikey"],
      templateHash: templateHash(doclingOffer()),
      secretSources: { apikey: "store:docling/apikey (generated, 32 bytes)" },
    });
    expect(sha(file())).toBe(before);
  });
});

describe("E8 — a newer template is an update, never applied silently", () => {
  it("updateAvailable + oci.image diff; entry unchanged until update:true", async () => {
    writeDefinitions(root, []);
    let current = doclingOffer();
    const { manager } = makeManager(root, { discoverOffers: () => offersOf(current)() });
    const a = await app(manager);
    await a.inject({ method: "POST", url: "/api/services", payload: { offer: "docling" } });
    const next = `ghcr.io/x/docling@sha256:${"b".repeat(64)}`;
    current = doclingOffer(next);
    // bust the 10 s offers cache
    (manager as unknown as { offersCache?: unknown }).offersCache = undefined;
    const s = (await a.inject({ method: "GET", url: "/api/services" })).json().data.services[0];
    expect(s.updateAvailable).toBe(true);
    expect(s.diff).toEqual([{ path: "oci.image", from: DIGEST, to: next }]);
    expect(new DefinitionsStore(file()).read()).toMatchObject({ ok: true });
    const stored = () => (JSON.parse(fs.readFileSync(file(), "utf8")).services[0] as { oci: { image: string } }).oci.image;
    expect(stored()).toBe(DIGEST);
    const res = await a.inject({ method: "POST", url: "/api/services", payload: { offer: "docling", update: true } });
    expect(res.statusCode).toBe(200);
    expect(stored()).toBe(next);
  });
});

describe("E9 — remove deletes secrets and the run dir; volumes only on purge", () => {
  it.each([false, true])("purgeData=%s", async (purgeData) => {
    writeDefinitions(root, []);
    const runner = recordingRunner();
    const paths = servicesPaths(root);
    const oci = new OciDriver({ runtime: "docker", run: runner.run, resolveBinary: (n) => `/usr/bin/${n}`, paths });
    const { manager } = makeManager(root, { run: runner.run, drivers: { "oci:docker": oci }, discoverOffers: offersOf(doclingOffer()) });
    await manager.add({ offer: "docling" });
    fs.mkdirSync(paths.secretsDir("docling"), { recursive: true });
    fs.writeFileSync(path.join(paths.secretsDir("docling"), "apikey"), "x");
    expect(JSON.parse(fs.readFileSync(paths.secrets, "utf8")).secrets["docling/apikey"]).toBeDefined();
    await manager.remove("docling", { purgeData });
    expect(Object.keys(JSON.parse(fs.readFileSync(paths.secrets, "utf8")).secrets)).toEqual([]);
    expect(fs.existsSync(paths.runDir("docling"))).toBe(false);
    const volumeRm = runner.calls.filter((c) => c.args[0] === "volume" && c.args[1] === "rm");
    expect(volumeRm.map((c) => c.args[2])).toEqual(purgeData ? ["docling-cache"] : []);
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).services).toEqual([]);
  });
});

describe("E10 — `add --yes` never prefetches", () => {
  it("writes the native entry; no prefetch request, no fetching runner call", async () => {
    writeDefinitions(root, []);
    const native: ServiceTemplate = {
      schemaVersion: 1,
      id: "docling",
      mode: "managed",
      drivers: ["native"],
      native: { runner: "uvx", package: "docling-serve@1.36.0", args: ["--port", "${port.http}"], ports: { http: { protocol: "http" } } },
      health: { kind: "http", endpoint: "http", path: "/health" },
    };
    const runner = recordingRunner();
    const { manager } = makeManager(root, { run: runner.run, discoverOffers: offersOf(native) });
    const a = await app(manager);
    const urls: string[] = [];
    const base = injectFetch(() => a);
    const out: string[] = [];
    const code = await cmdService(["add", "docling", "--yes", "--json"], {
      port: 1,
      fetch: (async (u: string | URL | Request, i?: RequestInit) => {
        urls.push(`${i?.method ?? "GET"} ${new URL(String(u)).pathname}`);
        return base(u, i);
      }) as typeof fetch,
      out: (s) => out.push(s),
      err: () => {},
      confirm: async () => {
        throw new Error("--yes must not prompt for the write");
      },
    });
    expect(code).toBe(0);
    expect(JSON.parse(out[0]).ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).services.map((s: { id: string }) => s.id)).toEqual(["docling"]);
    expect(urls.some((u) => u.endsWith("/prefetch"))).toBe(false);
    expect(runner.calls).toEqual([]);
  });
});

describe("E28 — instanceId is stable", () => {
  it("5 consecutive writes keep it", async () => {
    const store = new DefinitionsStore(file());
    await store.mutate(() => {});
    const first = JSON.parse(fs.readFileSync(file(), "utf8")).instanceId;
    expect(first).toMatch(/[0-9a-f-]{36}/);
    for (let i = 0; i < 5; i++) {
      await store.mutate((f) => {
        f.services.push(ociDef({ id: `s${i}` }));
      });
    }
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).instanceId).toBe(first);
  });
});
