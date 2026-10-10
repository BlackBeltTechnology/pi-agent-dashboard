/**
 * /api/plugins/automation/stop route: validates runId, returns 503 when the
 * engine hook is absent, 400 on a failed stop, and ok when the injected
 * stopRun hook succeeds. See change: automation-ui-mockup-parity.
 */

import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { mountAutomationRoutes } from "../server/routes.js";

async function appWith(hooks: Parameters<typeof mountAutomationRoutes>[1]) {
  const app = Fastify();
  mountAutomationRoutes(app, hooks);
  await app.ready();
  return app;
}

describe("POST /api/plugins/automation/stop", () => {
  it("400 when runId is missing", async () => {
    const app = await appWith({ stopRun: () => ({ ok: true }) });
    const res = await app.inject({ method: "POST", url: "/api/plugins/automation/stop", payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("503 when the engine stop hook is not wired", async () => {
    const app = await appWith({});
    const res = await app.inject({ method: "POST", url: "/api/plugins/automation/stop", payload: { runId: "r1" } });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it("aborts the run and returns ok via the injected hook", async () => {
    const stopRun = vi.fn(() => ({ ok: true as const }));
    const app = await appWith({ stopRun });
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/automation/stop",
      payload: { scope: "folder", cwd: "/r", runId: "r1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(stopRun).toHaveBeenCalledWith({ scope: "folder", cwd: "/r", runId: "r1" });
    await app.close();
  });

  it("awaits an async stop hook (pre-register run) and returns ok", async () => {
    const stopRun = vi.fn(async () => ({ ok: true as const }));
    const app = await appWith({ stopRun });
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/automation/stop",
      payload: { runId: "r-prereg" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("400 when the hook reports the run is not running", async () => {
    const app = await appWith({ stopRun: () => ({ ok: false, error: "not running" }) });
    const res = await app.inject({ method: "POST", url: "/api/plugins/automation/stop", payload: { runId: "r1" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("not running");
    await app.close();
  });
});

// ── Engine stop cascade (parent vs child) ───────────────────────────────────
// See change: add-automation-concurrent-spawn.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { createEngine } from "../server/engine.js";
import { listRuns, readChildRuns } from "../server/run-store.js";
import type { DiscoveredAutomation, RunRecord } from "../shared/automation-types.js";

describe("engine stopRun cascade", () => {
  let repo: string;
  beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), "auto-stop-")); });
  afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });
  const flushSpawn = async () => { await Promise.resolve(); await Promise.resolve(); };

  function fanout(name: string, count: number): DiscoveredAutomation {
    const dir = path.join(repo, ".pi", "automation", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "prompt.md"), "do it");
    return {
      name, scope: "folder", dir, valid: true,
      config: {
        on: { kind: "schedule", cron: "* * * * *" },
        action: { kind: "prompt", prompt: "./prompt.md", count },
        model: "@fast", mode: "local", sandbox: "workspace-write", concurrency: "skip",
      },
    };
  }
  function makeEngine(terminations: any[]) {
    return createEngine({
      spawnSession: async () => ({ success: true, spawnToken: `tok-${Math.random()}` }),
      abortSpawnedRun: async (a) => { terminations.push(a); return true; },
      listScopes: () => [{ base: repo, scope: "folder" }],
      config: () => ({ defaultVisibility: "hidden", retention: 100, defaultModel: "m", scanFolder: true, scanGlobal: false, maxRunAgeMs: 30 * 60 * 1000 }),
      readRoles: () => ({ fast: "m" }),
      warn: () => {},
    });
  }
  const parentOf = (name: string, runId: string): RunRecord =>
    listRuns(repo, name).find((r) => r.runId === runId)!;
  const kidsOf = (name: string, runId: string) => readChildRuns(repo, parentOf(name, runId));

  it("X8: stopping a parent aborts every child, finalizes each stopped, parent once", async () => {
    const terminations: any[] = [];
    const engine = makeEngine(terminations);
    const r = engine.startRunFor(fanout("cascade", 3))!;
    await flushSpawn();
    kidsOf("cascade", r.runId).forEach((k, i) => engine.onSessionRegisteredForRun(`s${i}`, k.runId));

    expect(await engine.stopRun(r.runId)).toBe(true);
    expect(terminations).toHaveLength(3);
    const parent = parentOf("cascade", r.runId);
    expect(parent.status).toBe("stopped");
    expect(typeof parent.endedAt).toBe("number");
    expect(kidsOf("cascade", r.runId).every((k) => k.status === "stopped")).toBe(true);
  });

  it("X9: stopping a single child leaves siblings + parent running", async () => {
    const terminations: any[] = [];
    const engine = makeEngine(terminations);
    const r = engine.startRunFor(fanout("single", 3))!;
    await flushSpawn();
    const kids = kidsOf("single", r.runId);
    kids.forEach((k, i) => engine.onSessionRegisteredForRun(`s${i}`, k.runId));

    expect(await engine.stopRun(kids[1]!.runId)).toBe(true);
    const after = kidsOf("single", r.runId);
    expect(after[1]!.status).toBe("stopped");
    expect(after[0]!.status).toBe("running");
    expect(after[2]!.status).toBe("running");
    expect(parentOf("single", r.runId).status).toBe("running");
  });
});

// ── GET /result?sessionId= (test-plan #F4) ──────────────────────────────────
// The run monitor resolves an ARCHIVED run session (no longer resident) from
// the run store by session id. See change: archive-service-sessions-on-end.
import { finishRun, startChildRun, startParentRun } from "../server/run-store.js";

describe("GET /api/plugins/automation/result?sessionId=", () => {
  let base: string;
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "auto-result-sid-"));
  });
  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("returns 200 with the child's result + status; an unknown session id is 404", async () => {
    const parent = startParentRun(base, "nightly", { runId: "p1" });
    startChildRun(base, parent.runId, "nightly", { runId: "r1", sessionId: "s1" });
    finishRun(base, "r1", { status: "done", result: "# findings\n- one" });
    const app = await appWith({});

    const hit = await app.inject({
      method: "GET",
      url: `/api/plugins/automation/result?cwd=${encodeURIComponent(base)}&sessionId=s1`,
    });
    expect(hit.statusCode).toBe(200);
    expect(hit.json()).toMatchObject({ status: "done", runId: "r1", name: "nightly", result: "# findings\n- one\n" });

    const miss = await app.inject({
      method: "GET",
      url: `/api/plugins/automation/result?cwd=${encodeURIComponent(base)}&sessionId=nope`,
    });
    expect(miss.statusCode).toBe(404);
    await app.close();
  });

  it("reads result.md from the resolved run dir, never from a record's own `dir` field", async () => {
    const parent = startParentRun(base, "nightly", { runId: "p2" });
    const child = startChildRun(base, parent.runId, "nightly", { runId: "r2", sessionId: "s2" });
    finishRun(base, "r2", { status: "done", result: "- real" });
    // A tampered record points `dir` outside the run store.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "auto-outside-"));
    fs.writeFileSync(path.join(outside, "result.md"), "SECRET");
    const recPath = path.join(child.dir, "run.json");
    fs.writeFileSync(recPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(recPath, "utf-8")), dir: outside }));
    const app = await appWith({});
    const res = await app.inject({
      method: "GET",
      url: `/api/plugins/automation/result?cwd=${encodeURIComponent(base)}&sessionId=s2`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toBe("- real\n");
    fs.rmSync(outside, { recursive: true, force: true });
    await app.close();
  });

  it("400 when neither runId nor sessionId is given", async () => {
    const app = await appWith({});
    const res = await app.inject({ method: "GET", url: `/api/plugins/automation/result?cwd=${encodeURIComponent(base)}` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
