/**
 * automation-plugin plugin_action handler — run/stop dispatch to the SAME
 * engine cores the REST routes call. The engine is not yet inited in a unit
 * test (engineRef null), so a `run` reaches the core and gets back a structured
 * "engine not ready" result (logged) — proving the wiring, not the engine.
 * See change: fix-plugin-action-fanout-and-handlers.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Admission seam: "real" delegates to the shared gate (release wrapped in a spy);
// "unavailable" forces the 503 indeterminate refusal; "throw" rejects.
// See change: harden-path-and-process-guards (#1104).
const gate = vi.hoisted(() => ({
  mode: "real" as "real" | "unavailable" | "throw",
  release: vi.fn(),
  calls: [] as unknown[],
  writeThrows: false,
  homedir: undefined as string | undefined,
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/plugin-route-cwd.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/plugin-route-cwd.js")>();
  return {
    ...actual,
    admitRouteCwdParam: async (raw: unknown, opts: Parameters<typeof actual.admitRouteCwdParam>[1]) => {
      gate.calls.push(raw);
      if (gate.mode === "throw") throw new Error("boom");
      if (gate.mode === "unavailable") {
        return { ok: false, status: 503, body: { error: "cwd-admission-unavailable" } };
      }
      const r = await actual.admitRouteCwdParam(raw, opts);
      if (!r.ok) return r;
      return {
        ...r,
        release: () => {
          gate.release();
          r.release();
        },
      };
    },
  };
});

vi.mock("../automation-writer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../automation-writer.js")>();
  return {
    ...actual,
    writeAutomation: (input: Parameters<typeof actual.writeAutomation>[0]) => {
      if (gate.writeThrows) throw new Error("EACCES");
      return actual.writeAutomation(input);
    },
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  const homedir = () => gate.homedir ?? actual.homedir();
  return { ...actual, homedir, default: { ...actual, homedir } };
});

import { registerPlugin } from "../index.js";

type Handler = (msg: unknown) => void;

const tmpDirs: string[] = [];
function tmpDir(): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "auto-pa-")));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  gate.mode = "real";
  gate.writeThrows = false;
  gate.homedir = undefined;
  gate.calls.length = 0;
  gate.release.mockClear();
  vi.restoreAllMocks();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const VALID_CONFIG = {
  trigger: { kind: "schedule", cron: "0 0 * * *" },
  action: { kind: "prompt", prompt: "hello" },
};

async function setup(known: string[] = []) {
  let handler: Handler | undefined;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const fastify = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
  const ctx = {
    logger,
    provide: vi.fn(),
    consume: vi.fn((key: string) => (key === "host.knownFolderCwds" ? () => known : undefined)),
    consumeAll: vi.fn(() => []),
    getPluginConfig: vi.fn(() => ({})),
    sessionManager: { listAll: () => [], getSession: () => undefined },
    fastify,
    spawnSession: vi.fn(),
    abortSpawnedRun: vi.fn(),
    emitEventToSession: vi.fn(),
    sendToSession: vi.fn(),
    onEvent: vi.fn(),
    onSessionEnded: vi.fn(),
    registerBrowserHandler: (type: string, h: Handler) => {
      if (type === "plugin_action") handler = h;
    },
  } as unknown as Parameters<typeof registerPlugin>[0];
  await registerPlugin(ctx);
  if (!handler) throw new Error("plugin_action handler not registered");
  return { handler, logger, ctx };
}

const tick = () => new Promise((r) => setImmediate(r));

describe("automation plugin_action handler", () => {
  it("run reaches the engine core and reports a structured result", async () => {
    const cwd = tmpDir();
    const { handler, logger } = await setup([cwd]);
    handler({ pluginId: "automation", action: "run", payload: { scope: "folder", cwd, name: "nightly" } });
    await vi.waitFor(() => expect(gate.release).toHaveBeenCalledTimes(1));
    const logged = logger.info.mock.calls.map((c) => String(c[0]));
    expect(logged.some((l) => l.includes('automation run "nightly"'))).toBe(true);
  });

  it("run without a name is a guarded warning, not a throw", async () => {
    const { handler, logger } = await setup();
    handler({ pluginId: "automation", action: "run", payload: { scope: "folder" } });
    await tick();
    expect(logger.warn).toHaveBeenCalledWith("automation run: name required");
  });

  it("stop without a runId is a guarded warning", async () => {
    const { handler, logger } = await setup();
    handler({ pluginId: "automation", action: "stop", payload: {} });
    await tick();
    expect(logger.warn).toHaveBeenCalledWith("automation stop: runId required");
  });

  // test-plan #E5 (plugin_action half) — the stop action admits its cwd like
  // the REST route: an unadmitted cwd (and a folder stop without one) is
  // refused before any lookup; nothing is signalled.
  // See change: polish-automation-board (design D3).
  it("stop with an unadmitted cwd is refused and never aborts", async () => {
    const { handler, logger, ctx } = await setup();
    handler({ pluginId: "automation", action: "stop", payload: { scope: "folder", cwd: "/not/admitted", runId: "r1" } });
    // `admitRouteCwdParam` runs async fs probes with an internal deadline, so
    // poll for the refusal rather than a fixed tick count (flaky under load).
    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith("automation stop runId=r1: cwd not admitted"),
    );
    expect((ctx as unknown as { abortSpawnedRun: ReturnType<typeof vi.fn> }).abortSpawnedRun).not.toHaveBeenCalled();
  });

  it("folder stop without a cwd is refused", async () => {
    const { handler, logger } = await setup();
    handler({ pluginId: "automation", action: "stop", payload: { scope: "folder", runId: "r1" } });
    // No cwd → `required` → synchronous 400; poll to stay robust under load.
    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith("automation stop runId=r1: cwd not admitted"),
    );
  });

  it("ignores a mismatched pluginId (defense-in-depth)", async () => {
    const { handler, logger } = await setup();
    handler({ pluginId: "goal", action: "run", payload: { name: "x" } });
    await tick();
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("automation run"));
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // ── #1104: create/run admit payload.cwd like REST + stop ────────────────
  const automationYaml = (cwd: string, name: string) => path.join(cwd, ".pi", "automation", name, "automation.yaml");
  const create = (handler: Handler, payload: Record<string, unknown>) =>
    handler({ pluginId: "automation", action: "create", payload: { name: "nightly", config: VALID_CONFIG, ...payload } });
  const run = (handler: Handler, payload: Record<string, unknown>) =>
    handler({ pluginId: "automation", action: "run", payload: { name: "a", ...payload } });
  const warned = (logger: { warn: ReturnType<typeof vi.fn> }, msg: string) =>
    expect(logger.warn).toHaveBeenCalledWith(msg);
  const runLogged = (logger: { info: ReturnType<typeof vi.fn> }) =>
    logger.info.mock.calls.some((c) => String(c[0]).startsWith("automation run "));

  it("S1: create with an admitted cwd writes the automation and releases the token once", async () => {
    const cwd = tmpDir();
    const { handler, logger } = await setup([cwd]);
    create(handler, { scope: "folder", cwd });
    await vi.waitFor(() => expect(gate.release).toHaveBeenCalledTimes(1));
    expect(fs.existsSync(automationYaml(cwd, "nightly"))).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("S2: create with an unadmitted cwd is refused and writes nothing", async () => {
    const cwd = tmpDir();
    const { handler, logger } = await setup([]);
    create(handler, { scope: "folder", cwd });
    await vi.waitFor(() => warned(logger, "automation create: cwd not admitted"));
    expect(fs.existsSync(path.join(cwd, ".pi"))).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), ".pi", "automation", "nightly"))).toBe(false);
  });

  it.each([
    ["absent", undefined, true],
    ["null", null, true],
    ["empty string", "", true],
    ["number 0", 0, true],
    ["object", {}, true],
    ["array", [], true],
    ["unadmitted path", "/x", true],
  ])("S3: folder create with cwd %s is refused, never falling back to process.cwd()", async (_n, value, _r) => {
    const procCwd = vi.spyOn(process, "cwd");
    const { handler, logger } = await setup([]);
    create(handler, { scope: "folder", ...(value === undefined ? {} : { cwd: value }) });
    await vi.waitFor(() => warned(logger, "automation create: cwd not admitted"));
    expect(procCwd).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(process.cwd(), ".pi", "automation", "nightly"))).toBe(false);
  });

  it("S4: global create writes under the home dir without a cwd; a supplied unadmitted cwd is still refused", async () => {
    const home = tmpDir();
    gate.homedir = home;
    const { handler, logger } = await setup([]);
    create(handler, { scope: "global" });
    await vi.waitFor(() => expect(fs.existsSync(automationYaml(home, "nightly"))).toBe(true));
    expect(logger.warn).not.toHaveBeenCalled();

    const other = tmpDir();
    create(handler, { scope: "global", name: "second", cwd: other });
    await vi.waitFor(() => warned(logger, "automation create: cwd not admitted"));
    expect(fs.existsSync(automationYaml(home, "second"))).toBe(false);
  });

  it("S5: run with an unadmitted cwd never scans or starts a run", async () => {
    const cwd = tmpDir();
    fs.mkdirSync(path.join(cwd, ".pi", "automation", "a"), { recursive: true });
    fs.writeFileSync(automationYaml(cwd, "a"), "name: a\n");
    const readdir = vi.spyOn(fs.promises, "readdir");
    const readdirSync = vi.spyOn(fs, "readdirSync");
    const { handler, logger } = await setup([]);
    run(handler, { scope: "folder", cwd });
    await vi.waitFor(() => warned(logger, "automation run: cwd not admitted"));
    expect(runLogged(logger)).toBe(false);
    expect(readdir.mock.calls.some((c) => String(c[0]).startsWith(cwd))).toBe(false);
    expect(readdirSync.mock.calls.some((c) => String(c[0]).startsWith(cwd))).toBe(false);
  });

  it.each([[123], [{}], [[]], [true]])("S6: run with non-string cwd %j is refused", async (value) => {
    const { handler, logger } = await setup([]);
    run(handler, { scope: "folder", cwd: value });
    await vi.waitFor(() => warned(logger, "automation run: cwd not admitted"));
    expect(runLogged(logger)).toBe(false);
  });

  it.each([["absent", undefined], ["null", null], ["empty string", ""]])(
    "S7: run with cwd %s still reaches the engine core",
    async (_n, value) => {
      const { handler, logger } = await setup([]);
      run(handler, { scope: "folder", ...(value === undefined ? {} : { cwd: value }) });
      await vi.waitFor(() => expect(runLogged(logger)).toBe(true));
      expect(logger.warn).not.toHaveBeenCalled();
    },
  );

  it("S8: run with an admitted cwd reaches the engine and releases once", async () => {
    const cwd = tmpDir();
    const { handler, logger } = await setup([cwd]);
    run(handler, { scope: "folder", cwd });
    await vi.waitFor(() => expect(runLogged(logger)).toBe(true));
    expect(gate.release).toHaveBeenCalledTimes(1);
  });

  it("S9: create, run and stop all refuse the same unadmitted cwd through one gate", async () => {
    const cwd = tmpDir();
    const { handler, logger } = await setup([]);
    create(handler, { scope: "folder", cwd });
    run(handler, { scope: "folder", cwd });
    handler({ pluginId: "automation", action: "stop", payload: { scope: "folder", cwd, runId: "r1" } });
    await vi.waitFor(() => {
      warned(logger, "automation create: cwd not admitted");
      warned(logger, "automation run: cwd not admitted");
      warned(logger, "automation stop runId=r1: cwd not admitted");
    });
    expect(gate.calls).toHaveLength(3);
  });

  it("X1/X2: indeterminate admission refuses create and run without writing or running", async () => {
    const cwd = tmpDir();
    gate.mode = "unavailable";
    const { handler, logger } = await setup([cwd]);
    create(handler, { scope: "folder", cwd });
    run(handler, { scope: "folder", cwd });
    await vi.waitFor(() => {
      warned(logger, "automation create: cwd not admitted");
      warned(logger, "automation run: cwd not admitted");
    });
    expect(fs.existsSync(path.join(cwd, ".pi"))).toBe(false);
    expect(runLogged(logger)).toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("X3: an admission that throws is contained and starts nothing", async () => {
    const cwd = tmpDir();
    gate.mode = "throw";
    const { handler, logger } = await setup([cwd]);
    create(handler, { scope: "folder", cwd });
    run(handler, { scope: "folder", cwd });
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(2));
    expect(fs.existsSync(path.join(cwd, ".pi"))).toBe(false);
    expect(runLogged(logger)).toBe(false);
  });

  it("X4: a write failure after admission still releases the token", async () => {
    const cwd = tmpDir();
    gate.writeThrows = true;
    const { handler, logger } = await setup([cwd]);
    create(handler, { scope: "folder", cwd });
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1));
    expect(gate.release).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(cwd, ".pi", "automation", "nightly"))).toBe(false);
  });

  it("P4: admission + dispatch stays well under 50 ms p95 per request", async () => {
    const cwd = tmpDir();
    const { handler, logger } = await setup([cwd]);
    const samples: number[] = [];
    for (let i = 0; i < 200; i++) {
      const before = logger.info.mock.calls.length;
      const t0 = performance.now();
      run(handler, { scope: "folder", cwd, name: "a" });
      await vi.waitFor(() => expect(logger.info.mock.calls.length).toBeGreaterThan(before), { interval: 1 });
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(50);
  });
});
