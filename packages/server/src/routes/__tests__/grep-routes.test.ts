import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { registerGrepRoutes } from "../grep-routes.js";
import { detectRipgrep, resetRipgrepCache } from "../../ripgrep-detection.js";
import type { SessionManager } from "../../session/memory-session-manager.js";

const cleanup: string[] = [];
afterAll(() => {
  for (const r of cleanup) rmSync(r, { recursive: true, force: true });
});

function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "grep-route-"));
  cleanup.push(root);
  for (const [f, content] of Object.entries(files)) {
    const full = join(root, f);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function buildApp(sessionCwds: string[]): FastifyInstance {
  const app = Fastify();
  const sessionManager = {
    listAll: () => sessionCwds.map((cwd) => ({ cwd })),
  } as unknown as SessionManager;
  const networkGuard = async () => {};
  registerGrepRoutes(app, { sessionManager, networkGuard });
  return app;
}

describe("GET /api/grep", () => {
  beforeEach(() => {
    // Force the JS-fallback path deterministically (do not depend on host rg).
    resetRipgrepCache();
    detectRipgrep(() => null);
  });

  it("400 when cwd or q missing", async () => {
    const app = buildApp(["/proj"]);
    const res = await app.inject({ method: "GET", url: "/api/grep?cwd=/proj" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("400 when q shorter than the minimum length", async () => {
    const app = buildApp(["/proj"]);
    const res = await app.inject({ method: "GET", url: "/api/grep?cwd=/proj&q=ab" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("403 when cwd is not a known session", async () => {
    const app = buildApp(["/known"]);
    const res = await app.inject({ method: "GET", url: "/api/grep?cwd=/unknown&q=needle" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("unknown session path");
    await app.close();
  });

  it("200 with matches via the JS fallback for a known cwd", async () => {
    const root = makeTree({ "src/a.ts": "const NEEDLE = 1\n" });
    const app = buildApp([root]);
    const res = await app.inject({ method: "GET", url: `/api/grep?cwd=${encodeURIComponent(root)}&q=NEEDLE` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.matches).toEqual([{ path: "src/a.ts", line: 1, col: 7, snippet: "const NEEDLE = 1" }]);
    await app.close();
  });

  it("only returns matches contained within cwd", async () => {
    const root = makeTree({ "in.ts": "needle\n" });
    const app = buildApp([root]);
    const res = await app.inject({ method: "GET", url: `/api/grep?cwd=${encodeURIComponent(root)}&q=needle` });
    const paths = res.json().data.matches.map((m: { path: string }) => m.path);
    for (const p of paths) expect(p.startsWith("..")).toBe(false);
    await app.close();
  });
});
