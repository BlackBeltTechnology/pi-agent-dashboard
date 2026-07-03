/**
 * kb-plugin REST route tests — stats / reindex / config over a real Fastify
 * instance with a temp folder fixture. Covers tasks 1.1–1.5, 4.1–4.4.
 * See change: add-kb-folder-slot.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { KbJobRegistry } from "../job-registry.js";
import { mountKbRoutes } from "../kb-routes.js";

const cleanup: string[] = [];
afterEach(() => {
  for (const r of cleanup.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** A temp folder with a docs/ tree + a knowledge_base.json pointing at it. */
function makeFolder(opts: { withConfig?: boolean; extraConfig?: Record<string, unknown> } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "kb-plugin-"));
  cleanup.push(root);
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "a.md"), "# Alpha\n\nSome alpha content about widgets.\n");
  writeFileSync(join(root, "docs", "b.md"), "# Beta\n\nSome beta content about gadgets.\n");
  if (opts.withConfig !== false) {
    mkdirSync(join(root, ".pi", "dashboard"), { recursive: true });
    writeFileSync(
      join(root, ".pi", "dashboard", "knowledge_base.json"),
      JSON.stringify({ sources: [{ kind: "filesystem", ref: "docs" }], ...opts.extraConfig }, null, 2),
    );
  }
  return root;
}

function buildApp(knownCwds: string[]): { app: FastifyInstance; registry: KbJobRegistry } {
  const app = Fastify();
  const registry = new KbJobRegistry();
  mountKbRoutes(app, { knownCwds: () => knownCwds, registry });
  return { app, registry };
}

describe("GET /api/kb/stats", () => {
  it("reports empty (indexed:false) for an un-indexed folder", async () => {
    const cwd = makeFolder();
    const { app } = buildApp([cwd]);
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(cwd)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.chunks).toBe(0);
    expect(body.indexed).toBe(false);
    expect(body.jobStatus).toBe("idle");
    await app.close();
  });

  it("returns counts after a reindex (indexed:true)", async () => {
    const cwd = makeFolder();
    const { app } = buildApp([cwd]);
    await app.inject({ method: "POST", url: `/api/kb/reindex?cwd=${encodeURIComponent(cwd)}` });
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(cwd)}` });
    const body = res.json();
    expect(body.chunks).toBeGreaterThan(0);
    expect(body.indexed).toBe(true);
    await app.close();
  });

  it("rejects an unknown cwd with 403 and opens no store", async () => {
    const known = makeFolder();
    const other = makeFolder();
    const { app } = buildApp([known]);
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(other)}` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("400 when cwd missing", async () => {
    const { app } = buildApp(["/proj"]);
    const res = await app.inject({ method: "GET", url: `/api/kb/stats` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("counts drifted source files from dox-staleness.json (source drift only)", async () => {
    const cwd = makeFolder();
    // A tracked source file whose acked sha will not match its current content.
    writeFileSync(join(cwd, "src.ts"), "export const x = 1;\n");
    const staleDir = join(cwd, ".pi", "dashboard", "kb");
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, "dox-staleness.json"), JSON.stringify({ "src.ts": "deadbeef-not-the-real-sha" }));
    const { app } = buildApp([cwd]);
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(cwd)}` });
    expect(res.json().staleCount).toBe(1);
    await app.close();
  });

  it("does not flag an acknowledged (matching-sha) source file", async () => {
    const cwd = makeFolder();
    writeFileSync(join(cwd, "src.ts"), "export const x = 1;\n");
    const sha = createHash("sha256").update(readFileSync(join(cwd, "src.ts"))).digest("hex");
    const staleDir = join(cwd, ".pi", "dashboard", "kb");
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, "dox-staleness.json"), JSON.stringify({ "src.ts": sha }));
    const { app } = buildApp([cwd]);
    const res = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(cwd)}` });
    expect(res.json().staleCount).toBe(0);
    await app.close();
  });
});

describe("POST /api/kb/reindex", () => {
  it("indexes a session-less folder → chunks > 0", async () => {
    const cwd = makeFolder();
    const { app } = buildApp([cwd]);
    const res = await app.inject({ method: "POST", url: `/api/kb/reindex?cwd=${encodeURIComponent(cwd)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().chunks).toBeGreaterThan(0);
    await app.close();
  });

  it("is incremental — a second reindex reports changed:0", async () => {
    const cwd = makeFolder();
    const { app } = buildApp([cwd]);
    await app.inject({ method: "POST", url: `/api/kb/reindex?cwd=${encodeURIComponent(cwd)}` });
    const res = await app.inject({ method: "POST", url: `/api/kb/reindex?cwd=${encodeURIComponent(cwd)}` });
    expect(res.json().changed).toBe(0);
    await app.close();
  });

  it("rejects an unknown cwd", async () => {
    const known = makeFolder();
    const other = makeFolder();
    const { app } = buildApp([known]);
    const res = await app.inject({ method: "POST", url: `/api/kb/reindex?cwd=${encodeURIComponent(other)}` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /api/kb/config", () => {
  it("reports origin=project when a project file exists", async () => {
    const cwd = makeFolder();
    const { app } = buildApp([cwd]);
    const res = await app.inject({ method: "GET", url: `/api/kb/config?cwd=${encodeURIComponent(cwd)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.origin).toBe("project");
    expect(body.config.sources[0].ref).toBe("docs");
    await app.close();
  });

  it("reports a fallback origin when no project file exists", async () => {
    const cwd = makeFolder({ withConfig: false });
    const { app } = buildApp([cwd]);
    const res = await app.inject({ method: "GET", url: `/api/kb/config?cwd=${encodeURIComponent(cwd)}` });
    expect(["global", "defaults"]).toContain(res.json().origin);
    await app.close();
  });
});

describe("PUT /api/kb/config", () => {
  it("persists a valid write and reports origin=project", async () => {
    const cwd = makeFolder();
    const { app } = buildApp([cwd]);
    const res = await app.inject({
      method: "PUT",
      url: `/api/kb/config?cwd=${encodeURIComponent(cwd)}`,
      payload: { sources: [{ kind: "filesystem", ref: "openspec" }] },
    });
    expect(res.statusCode).toBe(200);
    const onDisk = JSON.parse(readFileSync(join(cwd, ".pi", "dashboard", "knowledge_base.json"), "utf8"));
    expect(onDisk.sources[0].ref).toBe("openspec");
    await app.close();
  });

  it("rejects an invalid source with 400 and writes nothing new", async () => {
    const cwd = makeFolder();
    const before = readFileSync(join(cwd, ".pi", "dashboard", "knowledge_base.json"), "utf8");
    const { app } = buildApp([cwd]);
    const res = await app.inject({
      method: "PUT",
      url: `/api/kb/config?cwd=${encodeURIComponent(cwd)}`,
      payload: { sources: [{ kind: "wormhole", ref: "x" }] },
    });
    expect(res.statusCode).toBe(400);
    expect(readFileSync(join(cwd, ".pi", "dashboard", "knowledge_base.json"), "utf8")).toBe(before);
    await app.close();
  });

  it("preserves untouched fields (custom ranking) across a sources edit", async () => {
    const cwd = makeFolder({ extraConfig: { ranking: { fieldWeights: { headingPath: 99, heading: 2, body: 1 }, proximityBoost: false, diversity: { enabled: false, lambda: 0.5 } } } });
    const { app } = buildApp([cwd]);
    await app.inject({
      method: "PUT",
      url: `/api/kb/config?cwd=${encodeURIComponent(cwd)}`,
      payload: { sources: [{ kind: "filesystem", ref: "docs" }] },
    });
    const onDisk = JSON.parse(readFileSync(join(cwd, ".pi", "dashboard", "knowledge_base.json"), "utf8"));
    expect(onDisk.ranking.fieldWeights.headingPath).toBe(99);
    await app.close();
  });

  it("bootstraps a missing project file (origin !== project)", async () => {
    const cwd = makeFolder({ withConfig: false });
    const path = join(cwd, ".pi", "dashboard", "knowledge_base.json");
    expect(existsSync(path)).toBe(false);
    const { app } = buildApp([cwd]);
    const res = await app.inject({
      method: "PUT",
      url: `/api/kb/config?cwd=${encodeURIComponent(cwd)}`,
      payload: { sources: [{ kind: "filesystem", ref: "docs" }] },
    });
    expect(res.statusCode).toBe(200);
    expect(existsSync(path)).toBe(true);
    expect(res.json().origin).toBe("project");
    await app.close();
  });

  it("reflects new sources in the count after a reindex kick", async () => {
    const cwd = makeFolder({ withConfig: false });
    const { app } = buildApp([cwd]);
    await app.inject({
      method: "PUT",
      url: `/api/kb/config?cwd=${encodeURIComponent(cwd)}`,
      payload: { sources: [{ kind: "filesystem", ref: "docs" }], reindex: true },
    });
    // The reindex kick is fire-and-forget; poll stats until it settles.
    let chunks = 0;
    for (let i = 0; i < 20 && chunks === 0; i++) {
      const s = await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${encodeURIComponent(cwd)}` });
      chunks = s.json().chunks;
      if (chunks === 0) await new Promise((r) => setTimeout(r, 25));
    }
    expect(chunks).toBeGreaterThan(0);
    await app.close();
  });
});
