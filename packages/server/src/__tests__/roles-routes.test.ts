import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerRolesRoutes } from "../routes/roles-routes.js";

const passGuard = async () => {};

let home: string;
const origHome = process.env.HOME;

function providersPath(): string {
  return join(home, ".pi", "agent", "providers.json");
}

function writeProviders(obj: unknown): void {
  const p = providersPath();
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2));
}

async function makeApp(guard: (req?: unknown, reply?: unknown) => Promise<void> = passGuard) {
  const app = Fastify();
  registerRolesRoutes(app, { networkGuard: guard as any });
  await app.ready();
  return app;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "roles-routes-"));
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

describe("GET /api/roles", () => {
  it("returns assigned roles overlaid with empty defaults + builtinRoleNames", async () => {
    writeProviders({
      roles: { fast: "anthropic/opus", extraction: "x/y" },
      rolePresets: [{ name: "default", roles: { fast: "anthropic/opus" } }],
      activePreset: "default",
      providers: { keepme: { baseUrl: "http://x", apiKey: "secret" } },
    });
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/roles" });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);

    // assigned wins
    expect(data.roles.fast).toBe("anthropic/opus");
    expect(data.roles.extraction).toBe("x/y");
    // unconfigured stock defaults present as empty
    expect(data.roles.planning).toBe("");
    expect(data.roles.coding).toBe("");
    // presets + activePreset passed through
    expect(data.rolePresets).toEqual([{ name: "default", roles: { fast: "anthropic/opus" } }]);
    expect(data.activePreset).toBe("default");
    // builtinRoleNames = canonical defaults
    expect(data.builtinRoleNames).toEqual(["planning", "coding", "compact", "fast", "vision", "research", "naming"]);
    await app.close();
  });

  it("missing file yields empty structures and does NOT create the file", async () => {
    // no providers.json written
    expect(existsSync(providersPath())).toBe(false);
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/roles" });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    // defaults overlaid, everything else empty
    expect(data.roles).toEqual({ planning: "", coding: "", compact: "", fast: "", vision: "", research: "", naming: "" });
    expect(data.rolePresets).toEqual([]);
    expect(data.activePreset).toBeNull();
    // the read never created the file
    expect(existsSync(providersPath())).toBe(false);
    await app.close();
  });

  it("malformed JSON yields empty structures without throwing", async () => {
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(providersPath(), "{ this is not json ");
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/roles" });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data.rolePresets).toEqual([]);
    expect(data.activePreset).toBeNull();
    await app.close();
  });

  it("a read never mutates the file (byte-for-byte unchanged)", async () => {
    writeProviders({ roles: { fast: "a/b" }, rolePresets: [], activePreset: null, providers: { z: 1 } });
    const before = readFileSync(providersPath(), "utf-8");
    const app = await makeApp();
    await app.inject({ method: "GET", url: "/api/roles" });
    const after = readFileSync(providersPath(), "utf-8");
    expect(after).toBe(before);
    await app.close();
  });

  it("registers no PUT /api/roles (mutation) route", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "PUT", url: "/api/roles", payload: { role: "fast", modelId: "a/b" } });
    expect([404, 405]).toContain(res.statusCode);
    await app.close();
  });

  it("is network-guarded (guard rejection blocks the read)", async () => {
    const rejectGuard = async (_req: any, reply: any) => {
      reply.code(403).send({ error: "blocked" });
    };
    const app = await makeApp(rejectGuard);
    const res = await app.inject({ method: "GET", url: "/api/roles" });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
