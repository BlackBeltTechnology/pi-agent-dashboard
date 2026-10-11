// @vitest-environment node
//
// `node` is REQUIRED: this suite reaches `packages/kb`'s sqlite store, which vite's
// client (jsdom) environment refuses to bundle (`node:sqlite`). Same as kb-routes.test.ts.
/**
 * kb routes · async tri-state cwd admission and the write-route access dialog.
 * Covers test-plan E32 (kb GET half), E35, E36, E38.
 * See change: harden-plugin-cwd-admission.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CwdHoldDecision } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { GitProbeRunner } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KbJobRegistry } from "../job-registry.js";
import { mountKbRoutes } from "../kb-routes.js";

// Spy on config reads: an undecidable admission must precede every IO.
const kbCalls = vi.hoisted(() => ({ loadConfig: 0 }));
vi.mock("@blackbelt-technology/pi-dashboard-kb", async (orig) => {
  const real = await orig<typeof import("@blackbelt-technology/pi-dashboard-kb")>();
  return {
    ...real,
    loadConfig: (...a: Parameters<typeof real.loadConfig>) => {
      kbCalls.loadConfig += 1;
      return real.loadConfig(...a);
    },
  };
});

const timeoutRunner: GitProbeRunner = async () => ({
  ok: false,
  error: { kind: "timeout", timeoutMs: 1000, binary: "git" },
});

const roots: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function folder(withConfig = true): string {
  const root = mkdtempSync(join(tmpdir(), "kb-adm-"));
  roots.push(root);
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "a.md"), "# Alpha\n\nSome alpha content about widgets.\n");
  if (withConfig) {
    mkdirSync(join(root, ".pi", "dashboard"), { recursive: true });
    writeFileSync(
      join(root, ".pi", "dashboard", "knowledge_base.json"),
      JSON.stringify({ sources: [{ kind: "filesystem", ref: "docs" }] }),
    );
  }
  return root;
}

function build(opts: { runner?: GitProbeRunner; hold?: CwdHoldDecision | ((cwd: string) => CwdHoldDecision) | "absent" } = {}) {
  const app = Fastify();
  apps.push(app);
  const registry = new KbJobRegistry();
  const hold = vi.fn(async (_req: unknown, _reply: unknown, input: { cwd: string }): Promise<CwdHoldDecision> => {
    if (opts.hold === "absent" || !opts.hold) return { kind: "refuse" };
    return typeof opts.hold === "function" ? opts.hold(input.cwd) : opts.hold;
  });
  mountKbRoutes(app, {
    knownCwds: () => [],
    registry,
    ...(opts.hold === "absent" ? {} : { holdCwdDenial: hold as never }),
    admitOptions: opts.runner ? { runner: opts.runner } : undefined,
  });
  return { app, registry, hold };
}

const ROUTES: Array<{ name: string; method: "GET" | "POST" | "PUT"; path: string; body?: unknown; writes: boolean }> = [
  { name: "stats", method: "GET", path: "/api/kb/stats", writes: false },
  { name: "reindex", method: "POST", path: "/api/kb/reindex", writes: true },
  { name: "config GET", method: "GET", path: "/api/kb/config", writes: false },
  { name: "search", method: "GET", path: "/api/kb/search?q=widgets", writes: false },
  { name: "sources", method: "GET", path: "/api/kb/sources", writes: false },
  { name: "source-trust POST", method: "POST", path: "/api/kb/source-trust", body: { ref: "docs" }, writes: true },
  { name: "config PUT", method: "PUT", path: "/api/kb/config", body: {}, writes: true },
];

const url = (path: string, cwd?: string) =>
  cwd === undefined ? path : `${path}${path.includes("?") ? "&" : "?"}cwd=${encodeURIComponent(cwd)}`;
const fire = (app: FastifyInstance, r: (typeof ROUTES)[number], cwd?: string) =>
  app.inject({ method: r.method, url: url(r.path, cwd), ...(r.body !== undefined ? { payload: r.body as never } : {}) });

describe("E35: the 7 cwd-scoped kb routes", () => {
  for (const r of ROUTES) {
    it(`${r.name}: indeterminate → 503 + code, refuse → existing 403, missing cwd → 400`, async () => {
      const dir = folder();
      const slow = build({ runner: timeoutRunner });
      const res = await fire(slow.app, r, dir);
      expect(res.statusCode).toBe(503);
      expect(res.headers["retry-after"]).toBe("1");
      expect(res.json()).toEqual({ error: "cwd-admission-unavailable", message: expect.any(String), retryAfterMs: 1000 });
      expect(slow.hold).not.toHaveBeenCalled(); // an undecidable admission never prompts

      const refusing = build(); // real git: a plain non-repo folder is a definitive refusal
      const refused = await fire(refusing.app, r, dir);
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ error: "cwd not allowed" });

      const missing = await fire(refusing.app, r, undefined);
      expect(missing.statusCode).toBe(400);
      expect(missing.json()).toEqual({ error: "Missing cwd" });
    });
  }
});

describe("E36: admission precedes every config read or write", () => {
  it("PUT /api/kb/config, indeterminate → 503, loadConfig never called, nothing written", async () => {
    const dir = folder(false);
    const { app } = build({ runner: timeoutRunner });
    kbCalls.loadConfig = 0;
    const res = await app.inject({ method: "PUT", url: url("/api/kb/config", dir), payload: { include: ["docs"] } });
    expect(res.statusCode).toBe(503);
    expect(kbCalls.loadConfig).toBe(0);
    expect(existsSync(join(dir, ".pi", "dashboard", "knowledge_base.json"))).toBe(false);
  });
});

describe("E32 (kb GET half): reads never prompt", () => {
  for (const r of ROUTES.filter((x) => !x.writes)) {
    it(`GET ${r.name} on an unknown cwd is 403 and never calls the seam`, async () => {
      const dir = folder();
      const { app, hold } = build({ hold: (cwd) => ({ kind: "admit", canonCwd: dir, cwd: resolve(cwd) }) });
      const res = await fire(app, r, dir);
      expect(res.statusCode).toBe(403);
      expect(hold).not.toHaveBeenCalled();
    });
  }
});

describe("E38: write routes raise the access dialog", () => {
  it("POST /reindex: an allow the host confirms → 202 and the job is registered", async () => {
    const dir = folder();
    const { app, registry, hold } = build({ hold: (cwd) => ({ kind: "admit", canonCwd: realpathOf(dir), cwd: resolve(cwd) }) });
    const res = await app.inject({ method: "POST", url: url("/api/kb/reindex", dir) });
    expect(res.statusCode).toBe(202);
    expect(hold).toHaveBeenCalledWith(expect.anything(), expect.anything(), { cwd: dir, origin: "kb:reindex" });
    expect(registry.isRunning(dir) || registry.get(dir) !== undefined).toBe(true);
  });

  it("POST /reindex: deny → 403 and no job", async () => {
    const dir = folder();
    const { app, registry } = build({ hold: { kind: "refuse" } });
    const res = await app.inject({ method: "POST", url: url("/api/kb/reindex", dir) });
    expect(res.statusCode).toBe(403);
    expect(registry.get(dir)).toBeUndefined();
  });

  it("PUT /config and POST /source-trust use their own origins", async () => {
    const dir = folder();
    const { app, hold } = build({ hold: { kind: "refuse" } });
    await app.inject({ method: "PUT", url: url("/api/kb/config", dir), payload: {} });
    await app.inject({ method: "POST", url: url("/api/kb/source-trust", dir), payload: { ref: "docs" } });
    expect(hold.mock.calls.map((c) => (c as unknown[])[2])).toEqual([
      { cwd: dir, origin: "kb:config" },
      { cwd: dir, origin: "kb:trust" },
    ]);
  });

  it("an allow-always whose re-run is undecidable answers 503, not 403", async () => {
    const dir = folder();
    const { app } = build({ hold: { kind: "indeterminate" } });
    const res = await app.inject({ method: "POST", url: url("/api/kb/reindex", dir) });
    expect(res.statusCode).toBe(503);
  });

  it("a decision that answers another cwd never admits (no token for a replayed decision)", async () => {
    const dir = folder();
    // The decision answers a DIFFERENT cwd than the request carries.
    const { app, registry } = build({ hold: () => ({ kind: "admit", canonCwd: dir, cwd: "/elsewhere" }) });
    const res = await app.inject({ method: "POST", url: url("/api/kb/reindex", dir) });
    expect(res.statusCode).toBe(403);
    expect(registry.get(dir)).toBeUndefined();
  });

  it("host without the seam: unknown cwd keeps the existing 403", async () => {
    const dir = folder();
    const { app } = build({ hold: "absent" });
    expect((await app.inject({ method: "POST", url: url("/api/kb/reindex", dir) })).statusCode).toBe(403);
  });
});

function realpathOf(p: string): string {
  return realpathSync(p);
}
