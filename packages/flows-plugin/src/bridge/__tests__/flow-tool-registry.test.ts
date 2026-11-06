/**
 * flows-plugin flow-tools facade for pi-flows code nodes.
 * test-plan #E1–#E16, #P1, #X1–#X4. See change: add-flow-code-node-tools.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getManagedBin } from "@blackbelt-technology/pi-dashboard-shared/managed-paths.js";
import { spawn as realSpawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { envProbeStrategy, ToolRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearFlowTools,
  createFlowTools,
  FLOW_TOOLS_SYMBOL_KEY,
  type FlowTools,
  MAX_OUTPUT_BYTES,
} from "../flow-tool-registry.js";
import activate from "../index.js";

const SLOT = Symbol.for(FLOW_TOOLS_SYMBOL_KEY);
const slot = () => (globalThis as unknown as Record<symbol, FlowTools | undefined>)[SLOT];

function fakePi() {
  const emitted: string[] = [];
  const handlers = new Map<string, Array<(e?: unknown) => unknown>>();
  return {
    emitted,
    fire: (name: string, e?: unknown) => {
      for (const h of handlers.get(name) ?? []) h(e);
    },
    on: (name: string, h: (e?: unknown) => unknown) => {
      handlers.set(name, [...(handlers.get(name) ?? []), h]);
    },
    events: {
      emit: (channel: string) => {
        emitted.push(channel);
      },
      on: () => () => undefined,
    },
  };
}

function spySpawn() {
  return vi.fn((...a: Parameters<typeof realSpawn>) => realSpawn(...a));
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "flow-tools-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isGone = (pid: number) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ESRCH";
  }
};
/** Gone (ESRCH) within `withinMs` — a reparented child may linger as a zombie until init reaps it. */
async function goneWithin(pid: number, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (isGone(pid)) return true;
    await sleep(25);
  }
  return isGone(pid);
}
async function waitForPid(file: string): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const txt = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
    if (txt) return Number(txt);
    await sleep(20);
  }
  throw new Error("pid file never written");
}

afterEach(() => {
  clearFlowTools();
});

describe("publish lifecycle", () => {
  it("E1: activate publishes has/resolve/run/shell and no list", () => {
    activate(fakePi());
    const tools = slot();
    expect(tools).toBeDefined();
    for (const fn of ["has", "resolve", "run", "shell"] as const) expect(typeof tools?.[fn]).toBe("function");
    expect((tools as unknown as Record<string, unknown>).list).toBeUndefined();
  });

  it("E2: session_shutdown clears the slot, idempotently", () => {
    const pi = fakePi();
    activate(pi);
    pi.fire("session_shutdown", { reason: "reload" });
    expect(slot()).toBeUndefined();
    expect(() => pi.fire("session_shutdown", { reason: "reload" })).not.toThrow();
  });

  it("E3: session_start re-publishes after a clear", () => {
    const pi = fakePi();
    activate(pi);
    pi.fire("session_shutdown");
    pi.fire("session_start");
    expect(typeof slot()?.run).toBe("function");
  });
});

describe("resolution by name", () => {
  const tools = createFlowTools();

  it("E4: has() is true for registered tools, false otherwise", () => {
    expect(tools.has("git")).toBe(true);
    expect(tools.has("node")).toBe(true);
    expect(tools.has("bash")).toBe(true);
    expect(tools.has("not-a-registered-tool")).toBe(false);
  });

  it("E5: resolve() gives an absolute path or null, never throws", () => {
    const git = tools.resolve("git");
    expect(git).not.toBeNull();
    expect(path.isAbsolute(git as string)).toBe(true);
    expect(tools.resolve("not-a-registered-tool")).toBeNull();
  });

  it("E6: path-less probe kinds resolve to null", () => {
    const registry = new ToolRegistry();
    process.env.FLOW_TOOLS_TEST_ENV = "1";
    try {
      registry.register({ name: "flow-tools-env", kind: "probe", strategies: [envProbeStrategy("FLOW_TOOLS_TEST_ENV")] });
      expect(registry.resolve("flow-tools-env").ok).toBe(true);
      expect(createFlowTools({ registry: () => registry }).resolve("flow-tools-env")).toBeNull();
    } finally {
      delete process.env.FLOW_TOOLS_TEST_ENV;
    }
  });
});

describe("run()", () => {
  it("E7: runs a registered tool", async () => {
    const r = await createFlowTools().run("git", ["--version"]);
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/git version/);
  });

  it("E8: unregistered tool resolves 127 without spawning", async () => {
    const spawn = spySpawn();
    const r = await createFlowTools({ spawn }).run("not-a-registered-tool");
    expect(r).toMatchObject({ ok: false, code: 127 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("E9: already-aborted signal resolves 130 without spawning", async () => {
    const spawn = spySpawn();
    const tools = createFlowTools({ spawn });
    const ac = new AbortController();
    ac.abort();
    const t0 = Date.now();
    const a = await tools.run("git", ["--version"], { signal: ac.signal });
    const b = await tools.shell("echo x", { signal: ac.signal });
    expect(a).toMatchObject({ ok: false, code: 130 });
    expect(b).toMatchObject({ ok: false, code: 130 });
    expect(Date.now() - t0).toBeLessThan(200);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("E10: a non-executable (module-kind) tool fails soft", async () => {
    await expect(createFlowTools().run("node-pty")).resolves.toMatchObject({ ok: false });
  });
});

describe.skipIf(process.platform === "win32")("timeouts and output cap", () => {
  const tools = createFlowTools();

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("E11: timeoutMs %s means no timeout", async (timeoutMs) => {
    const r = await tools.shell("sleep 1", { timeoutMs });
    expect(r.ok).toBe(true);
  });

  it("E12: output just under the cap is kept whole", async () => {
    const n = MAX_OUTPUT_BYTES - 1;
    const r = await tools.shell(`head -c ${n} /dev/zero | tr '\\0' a`);
    expect(r.ok).toBe(true);
    expect(r.stdout.length).toBe(n);
  }, 30_000);

  it("E13: output over the cap is cut off and the child killed within 2 s", async () => {
    const payload = path.join(tmp(), "payload");
    fs.writeFileSync(payload, Buffer.alloc(MAX_OUTPUT_BYTES + 1024 * 1024, 0x61));
    const t0 = Date.now();
    const r = await tools.shell(`cat ${payload}; sleep 30`);
    expect(r.ok).toBe(false);
    expect(r.stdout.length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    // Streaming 65 MiB from a local file is sub-second; the remainder is the kill bound.
    expect(Date.now() - t0).toBeLessThan(2_500);
  }, 30_000);

  it("E13b: truncation never splits a UTF-8 sequence", async () => {
    const payload = path.join(tmp(), "payload-mb");
    // cap-1 ASCII bytes then a 2-byte "é": the byte cap falls inside the "é".
    fs.writeFileSync(payload, Buffer.concat([Buffer.alloc(MAX_OUTPUT_BYTES - 1, 0x61), Buffer.from("é")]));
    const r = await tools.shell(`cat ${payload}; sleep 30`);
    expect(r.ok).toBe(false);
    expect(Buffer.byteLength(r.stdout, "utf8")).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    expect(r.stdout.includes("\uFFFD")).toBe(false);
  }, 30_000);
});

describe.skipIf(process.platform === "win32")("shell()", () => {
  const tools = createFlowTools();

  it("E14: no login profile and no inherited BASH_ENV output", async () => {
    const dir = tmp();
    const noisy = path.join(dir, "noisy.sh");
    fs.writeFileSync(noisy, "echo PROFILE >&2\n");
    fs.writeFileSync(path.join(dir, ".bash_profile"), "echo PROFILE >&2\n");
    fs.writeFileSync(path.join(dir, ".bashrc"), "echo PROFILE >&2\n");
    const prev = process.env.BASH_ENV;
    process.env.BASH_ENV = noisy;
    try {
      const r = await tools.shell("echo hi", { env: { HOME: dir } });
      expect(r.ok).toBe(true);
      expect(r.stdout.trim()).toBe("hi");
      expect(r.stderr).not.toContain("PROFILE");
    } finally {
      if (prev === undefined) delete process.env.BASH_ENV;
      else process.env.BASH_ENV = prev;
    }
  });

  it("E14b: inherited ENV is dropped too", async () => {
    const noisy = path.join(tmp(), "noisy-env.sh");
    fs.writeFileSync(noisy, "echo PROFILE >&2\n");
    const prev = process.env.ENV;
    process.env.ENV = noisy;
    try {
      const r = await tools.shell("echo hi");
      expect(r.ok).toBe(true);
      expect(r.stderr).not.toContain("PROFILE");
    } finally {
      if (prev === undefined) delete process.env.ENV;
      else process.env.ENV = prev;
    }
  });

  it("E15: an explicit BASH_ENV in opts.env is kept", async () => {
    const script = path.join(tmp(), "env.sh");
    fs.writeFileSync(script, "echo FROM_ENV\n");
    const r = await tools.shell("true", { env: { BASH_ENV: script } });
    expect(r.stdout).toContain("FROM_ENV");
  });

  it("E16: tools only in the managed bin dir are found", async () => {
    // Never touch a real managed bin: HOME must be the ephemeral test HOME, and the
    // tool name is unique so nothing pre-existing can be overwritten or removed.
    expect(path.resolve(os.homedir())).not.toBe(path.resolve(os.userInfo().homedir));
    const bin = getManagedBin();
    expect(bin.startsWith(os.homedir())).toBe(true);
    fs.mkdirSync(bin, { recursive: true });
    const name = `flow-tools-fake-tool-${process.pid}-${Date.now()}`;
    const tool = path.join(bin, name);
    expect(fs.existsSync(tool)).toBe(false);
    fs.writeFileSync(tool, "#!/bin/sh\necho fake 1.0\n", { mode: 0o755 });
    try {
      const r = await tools.shell(name);
      expect(r.ok).toBe(true);
      expect(r.stdout).toContain("fake 1.0");
    } finally {
      fs.rmSync(tool, { force: true });
    }
  });

  it("P1: run/shell do not block the event loop", async () => {
    let ticks = 0;
    const iv = setInterval(() => {
      ticks++;
    }, 100);
    try {
      await tools.shell("sleep 1");
    } finally {
      clearInterval(iv);
    }
    expect(ticks).toBeGreaterThanOrEqual(8);
  });
});

describe.skipIf(process.platform === "win32")("runaway children and failures", () => {
  const tools = createFlowTools();

  it("X1: timeout kills the child and its grandchild within 2 s", async () => {
    const pidFile = path.join(tmp(), "pid");
    const t0 = Date.now();
    const p = tools.shell(`sleep 30 & echo $! > ${pidFile}; wait`, { timeoutMs: 500 });
    const grandchild = await waitForPid(pidFile);
    const r = await p;
    expect(r.ok).toBe(false);
    expect(Date.now() - t0).toBeLessThan(2_500);
    expect(await goneWithin(grandchild, 2_500 - (Date.now() - t0))).toBe(true);
  });

  it("X2: abort kills the child and its grandchild within 2 s", async () => {
    const pidFile = path.join(tmp(), "pid");
    const ac = new AbortController();
    const p = tools.shell(`sleep 30 & echo $! > ${pidFile}; wait`, { signal: ac.signal });
    const grandchild = await waitForPid(pidFile);
    await sleep(300);
    const t0 = Date.now();
    ac.abort();
    const r = await p;
    expect(r.ok).toBe(false);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(await goneWithin(grandchild, 2_000 - (Date.now() - t0))).toBe(true);
  });

  it("X6: win32 .cmd shims are routed through cmd.exe, args preserved", async () => {
    const spawn = vi.fn((..._a: Parameters<typeof realSpawn>) => realSpawn(process.execPath, ["-e", ""]));
    const t = createFlowTools({
      platform: "win32",
      spawn,
      registry: () => ({
        has: () => true,
        resolve: () => ({ ok: true, path: "C:\\node\\npx.cmd" }),
        resolveExecutor: () => ({ ok: true, argv: ["C:\\node\\npx.cmd"] }),
      }),
    });
    await t.run("npx", ["--version"]);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawn.mock.calls[0];
    expect(cmd).toBe("cmd.exe");
    expect(args).toEqual(["/d", "/s", "/c", "C:\\node\\npx.cmd", "--version"]);
  });

  it("X3: a throwing registry never escapes the facade", async () => {
    const boom = () => {
      throw new Error("boom");
    };
    const t = createFlowTools({ registry: () => ({ has: () => true, resolve: boom, resolveExecutor: boom }) });
    expect(t.resolve("git")).toBeNull();
    await expect(t.run("git")).resolves.toMatchObject({ ok: false, code: 127 });
    await expect(t.shell("true")).resolves.toMatchObject({ ok: false, code: 127 });
  });
});

describe("activate with a broken registry (X4)", () => {
  afterEach(() => {
    vi.doUnmock("@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js");
    vi.resetModules();
  });

  it("X4: activate does not throw, slot stays unset, adapter still registered", async () => {
    vi.resetModules();
    vi.doMock("@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js", async (orig) => ({
      ...(await orig<object>()),
      getDefaultRegistry: () => {
        throw new Error("registry boom");
      },
    }));
    const mod = await import("../index.js");
    const pi = fakePi();
    expect(() => mod.default(pi)).not.toThrow();
    expect(slot()).toBeUndefined();
    expect(pi.emitted).toContain("prompt:register-adapter");
  });
});
