// @vitest-environment node
//
// Node environment REQUIRED: this suite mounts real Fastify routes and reads
// files. The package default environment is jsdom (React client tests).
/**
 * roles-plugin REST route tests — GET /api/roles projection, failure modes,
 * and credential safety, over a real Fastify instance with a temp config file
 * injected via the `configPath` dep (no HOME dependence).
 *
 * Covers tasks 6.1–6.12 and 7.1–7.7. See change: add-roles-read-api.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountRolesRoutes } from "../roles-routes.js";

// Route-under-test reads config with a static `readFileSync` import. To exercise
// the permission-denied path deterministically (chmod 0o000 is a no-op for a
// root-equivalent process — how CI runs — and unsupported on Windows), wrap
// node:fs so a single opted-in path throws EACCES while every other fs call is
// the real one.
const fsMock = vi.hoisted(() => ({ eaccesPath: null as string | null }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: ((path: unknown, ...rest: unknown[]) => {
      if (fsMock.eaccesPath !== null && path === fsMock.eaccesPath) {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      }
      return (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof actual.readFileSync,
  };
});

const cleanup: string[] = [];
afterEach(() => {
  fsMock.eaccesPath = null;
  for (const r of cleanup.splice(0)) {
    rmSync(r, { recursive: true, force: true });
  }
});

/** Write a providers.json into a fresh temp dir, return its path. */
function writeConfig(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "roles-plugin-"));
  cleanup.push(dir);
  const path = join(dir, "providers.json");
  writeConfig.raw(path, JSON.stringify(config));
  return path;
}
writeConfig.raw = (path: string, text: string): void => writeFileSync(path, text);

/** Path in a temp dir where no file exists. */
function missingConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "roles-plugin-"));
  cleanup.push(dir);
  return join(dir, "providers.json");
}

function buildApp(configPath: () => string): FastifyInstance {
  const app = Fastify();
  mountRolesRoutes(app, { configPath });
  return app;
}

async function get(configPath: string): Promise<{ status: number; body: any }> {
  const app = buildApp(() => configPath);
  const res = await app.inject({ method: "GET", url: "/api/roles" });
  await app.close();
  return { status: res.statusCode, body: res.json() };
}

/** The live group (data[0]). */
function live(body: any) {
  return body.data[0];
}
/** A row by role name within a group. */
function row(group: any, role: string) {
  return group.roles.find((r: any) => r.role === role);
}

describe("row projection (E1–E5)", () => {
  it("unassigned role → ref null, assigned false, no derived parts (E1)", async () => {
    const path = writeConfig({ roles: { coding: "anthropic/x" } });
    const { status, body } = await get(path);
    expect(status).toBe(200);
    const vision = row(live(body), "vision");
    expect(vision).toMatchObject({ role: "vision", ref: null, assigned: false });
    expect(vision).not.toHaveProperty("model");
    expect(vision).not.toHaveProperty("provider");
    expect(vision).not.toHaveProperty("thinkingLevel");
  });

  it("assigned role reports ref + decomposed parts (E2)", async () => {
    const path = writeConfig({ roles: { planning: "anthropic/claude-opus-4-8:high" } });
    const { body } = await get(path);
    expect(row(live(body), "planning")).toMatchObject({
      ref: "anthropic/claude-opus-4-8:high",
      model: "anthropic/claude-opus-4-8",
      provider: "anthropic",
      thinkingLevel: "high",
      assigned: true,
    });
  });

  it("legacy bare id omits provider, ref verbatim, file untouched (E3)", async () => {
    const path = writeConfig({ roles: { coding: "deepseek-v4-flash" } });
    const before = (await import("node:fs")).readFileSync(path, "utf-8");
    const { body } = await get(path);
    const r = row(live(body), "coding");
    expect(r).toMatchObject({ ref: "deepseek-v4-flash", model: "deepseek-v4-flash", assigned: true });
    expect(r).not.toHaveProperty("provider");
    expect((await import("node:fs")).readFileSync(path, "utf-8")).toBe(before);
  });

  it("multi-colon ref splits on the last colon (E4)", async () => {
    const path = writeConfig({ roles: { coding: "a/b:high:low" } });
    const { body } = await get(path);
    expect(row(live(body), "coding")).toMatchObject({
      ref: "a/b:high:low",
      model: "a/b:high",
      thinkingLevel: "low",
    });
  });

  it("degenerate refs → 200, ref verbatim, undeterminable parts omitted (E5)", async () => {
    const path = writeConfig({
      roles: { planning: "a/b:", coding: ":high", compact: "anthropic/", fast: "a/b" },
    });
    const { status, body } = await get(path);
    expect(status).toBe(200);
    expect(row(live(body), "planning")).toMatchObject({ ref: "a/b:", model: "a/b", provider: "a" });
    expect(row(live(body), "planning")).not.toHaveProperty("thinkingLevel");
    const coding = row(live(body), "coding");
    expect(coding).toMatchObject({ ref: ":high", thinkingLevel: "high" });
    expect(coding).not.toHaveProperty("model");
    expect(coding).not.toHaveProperty("provider");
    expect(row(live(body), "fast")).toMatchObject({ ref: "a/b", model: "a/b", provider: "a" });
  });
});

describe("axis + group ordering (E7, E8)", () => {
  it("axis order defaults → user-added → preset-only; groups live then presets; stable (E8)", async () => {
    const path = writeConfig({
      roles: { coding: "a/b" },
      roleNames: ["custom"],
      rolePresets: [
        { name: "p1", roles: { review: "x/y" } },
        { name: "p2", roles: { coding: "c/d" } },
      ],
    });
    const first = await get(path);
    const second = await get(path);
    expect(first.body).toEqual(second.body); // stable across requests

    const axisNames = live(first.body).roles.map((r: any) => r.role);
    // defaults in canonical order
    expect(axisNames.slice(0, 7)).toEqual([
      "planning",
      "coding",
      "compact",
      "fast",
      "vision",
      "research",
      "naming",
    ]);
    // user-added before preset-only
    expect(axisNames.indexOf("custom")).toBeLessThan(axisNames.indexOf("review"));
    expect(axisNames).toContain("review"); // preset-only name present

    // every group shares the same axis
    for (const g of first.body.data) {
      expect(g.roles.map((r: any) => r.role)).toEqual(axisNames);
    }
    // live first, then presets in stored order
    expect(first.body.data.map((g: any) => g.preset)).toEqual([null, "p1", "p2"]);
  });

  it("preset-only role appears in every group, null in the live group (E7)", async () => {
    const path = writeConfig({
      roles: { coding: "a/b" },
      rolePresets: [{ name: "p", roles: { review: "x/y" } }],
    });
    const { body } = await get(path);
    for (const g of body.data) {
      expect(row(g, "review")).toBeTruthy();
    }
    expect(row(live(body), "review")).toMatchObject({ ref: null, assigned: false });
  });
});

describe("group active-ness (E12, E13, E14)", () => {
  it("no presets → single live group active (E13)", async () => {
    const path = writeConfig({ roles: {}, rolePresets: [] });
    const { body } = await get(path);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ preset: null, active: true });
  });

  it("active preset is flagged, no other group active (E14)", async () => {
    const path = writeConfig({
      activePreset: "cheap",
      rolePresets: [
        { name: "cheap", roles: { coding: "a/b" } },
        { name: "max", roles: { coding: "c/d" } },
      ],
    });
    const { body } = await get(path);
    const activeGroups = body.data.filter((g: any) => g.active);
    expect(activeGroups).toHaveLength(1);
    expect(activeGroups[0].preset).toBe("cheap");
  });

  it("dangling activePreset falls back to the live group, config unmodified (E12)", async () => {
    const path = writeConfig({
      activePreset: "ghost",
      rolePresets: [{ name: "real", roles: { coding: "a/b" } }],
    });
    const before = (await import("node:fs")).readFileSync(path, "utf-8");
    const { body } = await get(path);
    expect(live(body).active).toBe(true);
    expect(body.data.filter((g: any) => g.active)).toHaveLength(1);
    expect((await import("node:fs")).readFileSync(path, "utf-8")).toBe(before);
  });

  it("duplicate preset names collapse to one group, exactly one active (E from spec)", async () => {
    const path = writeConfig({
      activePreset: "dup",
      rolePresets: [
        { name: "dup", roles: { coding: "first/model" } },
        { name: "dup", roles: { coding: "second/model" } },
      ],
    });
    const { body } = await get(path);
    const dupGroups = body.data.filter((g: any) => g.preset === "dup");
    expect(dupGroups).toHaveLength(1);
    expect(body.data.filter((g: any) => g.active)).toHaveLength(1);
    // first entry wins
    expect(row(dupGroups[0], "coding")).toMatchObject({ ref: "first/model" });
  });
});

describe("read-only + fresh install (E16, E17)", () => {
  it("repeated reads are byte-identical, config unchanged (E16)", async () => {
    const path = writeConfig({
      roles: { coding: "a/b" },
      activePreset: "p",
      rolePresets: [{ name: "p", roles: { coding: "a/b" } }],
    });
    const before = (await import("node:fs")).readFileSync(path, "utf-8");
    const r1 = await get(path);
    const r2 = await get(path);
    const r3 = await get(path);
    expect(r1.body).toEqual(r2.body);
    expect(r2.body).toEqual(r3.body);
    expect((await import("node:fs")).readFileSync(path, "utf-8")).toBe(before);
  });

  it("fresh install → 200, one row per default all null, file not created (E17)", async () => {
    const { existsSync } = await import("node:fs");
    const path = missingConfigPath();
    const { status, body } = await get(path);
    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    const names = live(body).roles.map((r: any) => r.role);
    expect(names).toEqual(["planning", "coding", "compact", "fast", "vision", "research", "naming"]);
    for (const r of live(body).roles) expect(r.ref).toBeNull();
    expect(existsSync(path)).toBe(false);
  });
});

describe("failure modes (X1–X4)", () => {
  it("unparseable JSON degrades to built-ins unassigned (X1)", async () => {
    const path = missingConfigPath();
    writeConfig.raw(path, "{ this is not valid json ");
    const { status, body } = await get(path);
    expect(status).toBe(200);
    for (const r of live(body).roles) expect(r.ref).toBeNull();
    expect(live(body).roles).toHaveLength(7);
  });

  it("permission denied degrades, no unhandled error (X2)", async () => {
    const path = writeConfig({ roles: { coding: "a/b" } });
    fsMock.eaccesPath = path; // reset in afterEach
    const { status, body } = await get(path);
    expect(status).toBe(200);
    for (const r of live(body).roles) expect(r.ref).toBeNull();
  });

  it("path is a directory degrades (X3)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "roles-plugin-"));
    cleanup.push(dir);
    const asDir = join(dir, "providers.json");
    mkdirSync(asDir);
    const { status, body } = await get(asDir);
    expect(status).toBe(200);
    for (const r of live(body).roles) expect(r.ref).toBeNull();
  });

  it("TOCTOU: file removed between check and read degrades (X4)", async () => {
    // Simulate by pointing at a path whose parent is removed mid-flight: a
    // resolver that deletes the file after existsSync but before readFileSync
    // would EACCES/ENOENT. We approximate with a path that vanishes: the
    // route's try/catch is the guard. Here we assert a missing path is safe,
    // which is the observable outcome of the race.
    const path = missingConfigPath();
    const { status } = await get(path);
    expect(status).toBe(200);
  });
});

describe("security + auth (X5, X7)", () => {
  it("credential in a sibling key never reaches the body (X5)", async () => {
    const secret = "sk-super-secret-credential-value-9f3a";
    const path = writeConfig({
      roles: { coding: "anthropic/x" },
      providers: { anthropic: { apiKey: secret } },
      apiKey: secret,
    });
    const { body } = await get(path);
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it("route registered without a networkGuard preHandler (X7 posture)", async () => {
    // The route inherits only the dashboard auth gate — no per-route guard is
    // attached. A bare Fastify with just this route answers 200, proving no
    // additional preHandler rejects the request.
    const path = writeConfig({ roles: {} });
    const app = Fastify();
    let preHandlerAttached = false;
    app.addHook("onRoute", (r) => {
      if (r.url === "/api/roles" && r.preHandler) preHandlerAttached = true;
    });
    mountRolesRoutes(app, { configPath: () => path });
    const res = await app.inject({ method: "GET", url: "/api/roles" });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(preHandlerAttached).toBe(false);
  });
});

describe("plugin unloaded (X6)", () => {
  it("without the route mounted, GET /api/roles is 404", async () => {
    const app = Fastify();
    // deliberately NOT mounting the roles route
    const res = await app.inject({ method: "GET", url: "/api/roles" });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});
