/**
 * The stdio MCP server (design D8) over in-memory streams, with a fake supervisor (argument validation,
 * encoding) or the real Supervisor driving the scripted fake host (lazy start, serial calls, cancel, crash,
 * result encoding). The `--root` startup check spawns the real launcher.
 *
 * See change: add-blender-wasm-mcp (test-plan E19–E24, E30, E36, E38, E42, E54, E55, X8, X9, X17).
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { tailBytes } from "../host/jobs.js";
import { OUTPUT_TAIL_BYTES } from "../host/protocol.js";
import { LATEST_PROTOCOL_VERSION, runServer, type ServerDeps, SUPPORTED_PROTOCOL_VERSIONS } from "../mcp/server.js";
import { TOOL_DEFS } from "../mcp/tools.js";
import { resolveLimits } from "../mcp/workspace.js";
import { cleanupAll, makeHarness, makeRoot, settlesWithin, sleep, tmpDir } from "./helpers/fake-host-kit.js";
import { FakeSupervisor } from "./helpers/fake-supervisor.js";
import { LAUNCHER, waitUntil } from "./helpers/mcp-client.js";

type Msg = { jsonrpc?: string; id?: number | null; result?: Record<string, unknown>; error?: { code: number; message: string } };
interface ToolMsg {
  isError?: boolean;
  content: { type: string; text: string }[];
}

interface Mcp {
  /** Every raw stdout line. */
  lines: string[];
  stderr: string[];
  send(method: string, params?: unknown): { id: number; response: Promise<Msg> };
  notify(method: string, params?: unknown): void;
  raw(line: string): void;
  call(name: string, args?: unknown): Promise<{ isError: boolean; data: Record<string, unknown> & { code?: string; message?: string }; output?: string; raw: ToolMsg }>;
  end(): Promise<number>;
}

const started: Mcp[] = [];

function startMcp(supervisor: ServerDeps["supervisor"], root: string = makeRoot(), limits = resolveLimits({})): Mcp {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const lines: string[] = [];
  const stderr: string[] = [];
  const waiters = new Map<number, (m: Msg) => void>();
  const rl = readline.createInterface({ input: stdout });
  rl.on("line", (line) => {
    lines.push(line);
    try {
      const m = JSON.parse(line) as Msg;
      if (typeof m.id === "number") waiters.get(m.id)?.(m);
    } catch {
      /* asserted by the tests that care */
    }
  });
  const done = runServer({ stdin, stdout, stderr: (t) => stderr.push(t), root, limits, supervisor, version: "9.9.9" });
  let n = 0;
  const send: Mcp["send"] = (method, params) => {
    const id = ++n;
    const response = new Promise<Msg>((resolve) => waiters.set(id, resolve));
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return { id, response };
  };
  let ended: Promise<number> | undefined;
  const mcp: Mcp = {
    lines,
    stderr,
    send,
    notify: (method, params) => void stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`),
    raw: (line) => void stdin.write(`${line}\n`),
    call: async (name, args) => {
      const msg = await send("tools/call", { name, arguments: args }).response;
      const raw = msg.result as unknown as ToolMsg;
      return {
        isError: raw.isError === true,
        data: JSON.parse(raw.content[0].text) as Record<string, unknown>,
        output: raw.content.length > 1 ? raw.content[raw.content.length - 1].text : undefined,
        raw,
      };
    },
    end: () => {
      ended ??= (async () => {
        stdin.end();
        const code = await done;
        rl.close();
        return code;
      })();
      return ended;
    },
  };
  started.push(mcp);
  return mcp;
}

afterEach(async () => {
  for (const m of started.splice(0)) await m.end().catch(() => undefined);
  await cleanupAll();
});

const TOOL_NAMES = ["blender_export", "blender_import", "blender_python", "blender_reset", "blender_scene"];

describe("protocol subset", () => {
  it("E19: initialize advertises the tools capability; tools/list returns exactly the 5 tools, each with an inputSchema", async () => {
    const mcp = startMcp(new FakeSupervisor());
    const init = await mcp.send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }).response;
    expect(init.result?.capabilities).toEqual({ tools: {} });
    expect(init.result?.serverInfo).toEqual({ name: "blender-wasm", version: "9.9.9" });
    mcp.notify("notifications/initialized");
    const list = await mcp.send("tools/list").response;
    const tools = (list.result as { tools: { name: string; description: string; inputSchema: { type: string; properties: object } }[] }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(TOOL_NAMES);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(typeof t.inputSchema.properties).toBe("object");
      expect(t.description.length).toBeGreaterThan(20);
    }
    expect(tools).toEqual(TOOL_DEFS);
    expect(mcp.lines).toHaveLength(2); // the notification produced no response
  });

  it("E20: resources/list is -32601, the line `{bad` is -32700, and stdout holds only JSON-RPC lines", async () => {
    const mcp = startMcp(new FakeSupervisor());
    const unknown = await mcp.send("resources/list").response;
    expect(unknown.error?.code).toBe(-32601);
    const before = mcp.lines.length;
    mcp.raw("{bad");
    expect(await waitUntil(() => mcp.lines.length === before + 1, 3000, 10)).toBe(true);
    const parse = JSON.parse(mcp.lines[before]) as Msg;
    expect(parse).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32700 } });
    // Still alive after the bad line, and other malformed inputs get the right codes.
    mcp.raw("[1,2]");
    mcp.raw(JSON.stringify({ jsonrpc: "2.0", id: 77 }));
    mcp.notify("some/unknown-notification");
    expect((await mcp.send("ping").response).result).toEqual({});
    await mcp.end();
    const msgs = mcp.lines.map((l) => JSON.parse(l) as Msg); // every line parses
    expect(msgs.every((m) => m.jsonrpc === "2.0")).toBe(true);
    expect(msgs.map((m) => m.error?.code)).toEqual([-32601, -32700, -32600, -32600, undefined]);
    expect(msgs.find((m) => m.id === 77)?.error?.code).toBe(-32600);
    expect(mcp.stderr).toEqual([]);
  });

  it("E21: a supported requested protocol version is echoed; an unknown one gets the latest supported", async () => {
    const mcp = startMcp(new FakeSupervisor());
    expect(LATEST_PROTOCOL_VERSION).toBe("2025-06-18");
    const echoed = await mcp.send("initialize", { protocolVersion: "2025-06-18" }).response;
    expect(echoed.result?.protocolVersion).toBe("2025-06-18");
    const old = await mcp.send("initialize", { protocolVersion: "2024-11-05" }).response;
    expect(old.result?.protocolVersion).toBe("2024-11-05");
    const unknown = await mcp.send("initialize", { protocolVersion: "1999-01-01" }).response;
    expect(unknown.result?.protocolVersion).toBe("2025-06-18");
    const missing = await mcp.send("initialize").response;
    expect(missing.result?.protocolVersion).toBe("2025-06-18");
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain("2025-03-26");
  });

  it("closing stdin shuts the supervisor down and resolves with exit code 0", async () => {
    const sup = new FakeSupervisor();
    const mcp = startMcp(sup);
    await mcp.send("ping").response;
    expect(await mcp.end()).toBe(0);
    expect(sup.shutdownCalls).toBe(1);
  });
});

describe("tool call validation (fake supervisor)", () => {
  it("E22: timeoutSec 0 and 601 are invalid-arguments; 1 and 600 are accepted and passed through", async () => {
    const sup = new FakeSupervisor();
    const mcp = startMcp(sup);
    for (const bad of [0, 601, -1, 1.5, "5", null]) {
      const r = await mcp.call("blender_python", { code: "pass", timeoutSec: bad });
      expect(r.isError).toBe(true);
      expect(r.data.code).toBe("invalid-arguments");
    }
    expect(sup.requests).toHaveLength(0);
    for (const good of [1, 600]) {
      const r = await mcp.call("blender_python", { code: "pass", timeoutSec: good });
      expect(r.isError).toBe(false);
      expect(sup.requests.at(-1)?.timeoutSec).toBe(good);
    }
    expect(sup.requests).toHaveLength(2);
    const dflt = await mcp.call("blender_python", { code: "pass" });
    expect(dflt.isError).toBe(false);
    expect(sup.requests.at(-1)?.timeoutSec).toBe(120);
  });

  it("E22: timeoutSec bounds apply to every tool", async () => {
    const sup = new FakeSupervisor();
    const mcp = startMcp(sup);
    for (const [tool, args] of [["blender_scene", {}], ["blender_reset", {}], ["blender_import", { path: "a.glb" }], ["blender_export", { path: "a.glb" }]] as const) {
      expect((await mcp.call(tool, { ...args, timeoutSec: 601 })).data.code).toBe("invalid-arguments");
      expect((await mcp.call(tool, { ...args, timeoutSec: 0 })).data.code).toBe("invalid-arguments");
    }
    expect(sup.requests).toHaveLength(0);
  });

  it("E23: an unknown tool name is an isError result with invalid-arguments (not a JSON-RPC error)", async () => {
    const sup = new FakeSupervisor();
    const mcp = startMcp(sup);
    const r = await mcp.call("blender_render", {});
    expect(r.isError).toBe(true);
    expect(r.data.code).toBe("invalid-arguments");
    expect(String(r.data.message)).toContain("blender_render");
    const noName = await mcp.send("tools/call", {}).response;
    expect((noName.result as unknown as ToolMsg).isError).toBe(true);
    expect(sup.requests).toHaveLength(0);
  });

  it("unknown or mistyped arguments are invalid-arguments and never reach the supervisor", async () => {
    const sup = new FakeSupervisor();
    const mcp = startMcp(sup);
    for (const [tool, args] of [
      ["blender_python", {}],
      ["blender_python", { code: 5 }],
      ["blender_python", { code: "x", extra: 1 }],
      ["blender_python", { code: "x", inputs: "a" }],
      ["blender_python", { code: "x", inputs: [1] }],
      ["blender_scene", { limit: 0 }],
      ["blender_scene", { limit: 1001 }],
      ["blender_reset", { mode: "nope" }],
      ["blender_import", {}],
      ["blender_export", { path: "a.glb", selectedOnly: "yes" }],
    ] as const) {
      const r = await mcp.call(tool, args);
      expect({ tool, args, code: r.data.code }).toEqual({ tool, args, code: "invalid-arguments" });
    }
    expect(sup.requests).toHaveLength(0);
    expect((await mcp.call("blender_scene", { limit: 1000 })).isError).toBe(false);
    expect((await mcp.call("blender_reset", { mode: "empty" })).isError).toBe(false);
    expect((await mcp.call("blender_reset")).isError).toBe(false);
  });

  it("a non-object `arguments` is invalid-arguments", async () => {
    const mcp = startMcp(new FakeSupervisor());
    for (const bad of ["str", [1], 5, null]) {
      expect((await mcp.call("blender_scene", bad)).data.code).toBe("invalid-arguments");
    }
  });

  it("E42: export of out/scene.usdc is unsupported-format; .blend + selectedOnly is invalid-arguments; the host is not called", async () => {
    const h = makeHarness();
    const mcp = startMcp(h.supervisor());
    const usd = await mcp.call("blender_export", { path: "out/scene.usdc" });
    expect(usd.isError).toBe(true);
    expect(usd.data.code).toBe("unsupported-format");
    expect(String(usd.data.message)).toContain(".usdc");
    const upper = await mcp.call("blender_export", { path: "out/scene.USDC" });
    expect(upper.data.code).toBe("unsupported-format");
    const noExt = await mcp.call("blender_export", { path: "out/scene" });
    expect(noExt.data.code).toBe("unsupported-format");
    const blendSel = await mcp.call("blender_export", { path: "out/scene.blend", selectedOnly: true });
    expect(blendSel.isError).toBe(true);
    expect(blendSel.data.code).toBe("invalid-arguments");
    expect(h.logEntries()).toEqual([]);
    // .blend without selectedOnly (or with false) is fine.
    expect((await mcp.call("blender_export", { path: "out/scene.blend", selectedOnly: false })).isError).toBe(false);
  });

  it("import of an unsupported extension is unsupported-format and never reaches the host", async () => {
    const h = makeHarness();
    const mcp = startMcp(h.supervisor());
    const r = await mcp.call("blender_import", { path: "model.usdz" });
    expect(r.data.code).toBe("unsupported-format");
    expect(h.logEntries()).toEqual([]);
  });
});

describe("staging errors never reach the host (real supervisor, fake host)", () => {
  it("E30: an input `missing.obj` is input-not-found and the fake host is not called", async () => {
    const h = makeHarness();
    const mcp = startMcp(h.supervisor());
    const r = await mcp.call("blender_python", { code: "pass", inputs: ["missing.obj"] });
    expect(r.isError).toBe(true);
    expect(r.data.code).toBe("input-not-found");
    expect(String(r.data.message)).toContain("missing.obj");
    expect(h.logEntries()).toEqual([]);
    expect(h.spies.spawnHost).not.toHaveBeenCalled();
  });

  it("E36: a .gltf with buffers[0].uri `x.bin` is unsupported-format naming x.bin; a self-contained .gltf is imported", async () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "ext.gltf"), JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "x.bin", byteLength: 4 }] }));
    fs.writeFileSync(path.join(root, "img.gltf"), JSON.stringify({ asset: { version: "2.0" }, images: [{ uri: "tex.png" }] }));
    fs.writeFileSync(path.join(root, "ok.gltf"), JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "data:application/octet-stream;base64,AAAA", byteLength: 3 }] }));
    const h = makeHarness({ steps: [{ result: { objects: ["Cube"] } }] });
    const mcp = startMcp(h.supervisor(), root);
    const r = await mcp.call("blender_import", { path: "ext.gltf" });
    expect(r.isError).toBe(true);
    expect(r.data.code).toBe("unsupported-format");
    expect(String(r.data.message)).toContain("x.bin");
    expect(String((await mcp.call("blender_import", { path: "img.gltf" })).data.message)).toContain("tex.png");
    expect(h.logEntries()).toEqual([]);
    const ok = await mcp.call("blender_import", { path: "ok.gltf" });
    expect(ok.isError).toBe(false);
    expect(ok.data.objects).toEqual(["Cube"]);
    expect(h.ops()[0].args).toEqual({ ext: ".gltf", path: "/in/ok.gltf" });
  });

  it("E38: a directory path to blender_import is invalid-arguments and the host is not called", async () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "model.glb"));
    const h = makeHarness();
    const mcp = startMcp(h.supervisor(), root);
    const r = await mcp.call("blender_import", { path: "model.glb" });
    expect(r.isError).toBe(true);
    expect(r.data.code).toBe("invalid-arguments");
    expect(h.logEntries()).toEqual([]);
  });

  it("an import of a missing file is input-not-found; extensions are case-insensitive and a .blend travels as `blend`", async () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "Scene.BLEND"), "BLENDER");
    const h = makeHarness({ steps: [{ result: { objects: [] } }] });
    const mcp = startMcp(h.supervisor(), root);
    expect((await mcp.call("blender_import", { path: "nope.glb" })).data.code).toBe("input-not-found");
    expect(h.logEntries()).toEqual([]);
    expect((await mcp.call("blender_import", { path: "Scene.BLEND" })).isError).toBe(false);
    expect(h.ops()[0]).toMatchObject({ hasBlend: true, files: {}, args: { ext: ".blend" } });
  });
});

describe("result encoding (real supervisor, fake host)", () => {
  it("E24: printed output at 16 KiB − 1, 16 KiB and 1 MiB — the last block is ≤ 16 KiB and ends DONE; truncation is flagged only when over 16 KiB", async () => {
    const outputs = [16 * 1024 - 1, 16 * 1024, 1024 * 1024].map((n) => tailBytes(`${"x".repeat(n - 4)}DONE`, OUTPUT_TAIL_BYTES));
    const h = makeHarness({ steps: outputs.map((o) => ({ output: o.text, outputTruncated: o.truncated })) });
    const mcp = startMcp(h.supervisor());
    const results = [] as Awaited<ReturnType<Mcp["call"]>>[];
    for (let i = 0; i < 3; i++) results.push(await mcp.call("blender_python", { code: "print('x')" }));
    for (const r of results) {
      expect(r.isError).toBe(false);
      expect(r.raw.content.at(-1)?.text).toBe(r.output);
      expect(Buffer.byteLength(r.output ?? "")).toBeLessThanOrEqual(16 * 1024);
      expect(r.output?.endsWith("DONE")).toBe(true);
    }
    expect(results.map((r) => r.data.outputTruncated)).toEqual([undefined, undefined, true]);
    expect(Buffer.byteLength(results[1].output ?? "")).toBe(16384);
    expect(Buffer.byteLength(results[2].output ?? "")).toBe(16384);
    // block 0 is JSON with the bookkeeping fields
    expect(results[0].data).toMatchObject({ sessionReset: false, outputs: [] });
    expect(typeof results[0].data.durationMs).toBe("number");
  });

  it("no printed output → a single content block; errors carry code/message/sessionReset/durationMs and the output tail", async () => {
    const h = makeHarness({ steps: [{}, { error: { code: "python-error", message: "NameError: x" }, output: "trace tail", outputTruncated: true }] });
    const mcp = startMcp(h.supervisor());
    const ok = await mcp.call("blender_reset");
    expect(ok.raw.content).toHaveLength(1);
    const err = await mcp.call("blender_python", { code: "x" });
    expect(err.isError).toBe(true);
    expect(err.data).toMatchObject({ code: "python-error", message: "NameError: x", sessionReset: false, outputTruncated: true });
    expect(typeof err.data.durationMs).toBe("number");
    expect(err.output).toBe("trace tail");
  });

  it("scene results pass the host's fields through", async () => {
    const h = makeHarness({ steps: [{ result: { blender: "5.3.0 Alpha", runtimeVersion: "0.0.5", total: 3, truncated: false, objects: [{ name: "Cube" }] } }] });
    const mcp = startMcp(h.supervisor());
    const r = await mcp.call("blender_scene", { limit: 5 });
    expect(r.data).toMatchObject({ blenderVersion: "5.3.0 Alpha", runtimeVersion: "0.0.5", total: 3, truncated: false, objects: [{ name: "Cube" }] });
    expect(h.ops()[0]).toMatchObject({ op: "scene", args: { limit: 5 } });
  });
});

describe("lazy start and concurrency", () => {
  it("E54: initialize, ping and tools/list succeed with zero probe, provision, repair and spawn calls", async () => {
    const h = makeHarness();
    const mcp = startMcp(h.supervisor());
    expect((await mcp.send("initialize", { protocolVersion: "2025-06-18" }).response).result).toBeDefined();
    expect((await mcp.send("ping").response).result).toEqual({});
    expect(((await mcp.send("tools/list").response).result as { tools: unknown[] }).tools).toHaveLength(5);
    // an argument-validation failure is also lazy
    expect((await mcp.call("blender_python", { code: 1 })).data.code).toBe("invalid-arguments");
    await sleep(100);
    expect(h.spies.probe).not.toHaveBeenCalled();
    expect(h.spies.provision).not.toHaveBeenCalled();
    expect(h.spies.repair).not.toHaveBeenCalled();
    expect(h.spies.spawnHost).not.toHaveBeenCalled();
    expect(await mcp.end()).toBe(0);
    expect(h.spies.spawnHost).not.toHaveBeenCalled();
  });

  it("X8: two tools/call back to back run serially — the second reaches the host after the first result was sent", async () => {
    const h = makeHarness({ steps: [{ delayMs: 200, result: { n: 1 } }, { result: { n: 2 } }] });
    const mcp = startMcp(h.supervisor());
    const a = mcp.send("tools/call", { name: "blender_python", arguments: { code: "1" } });
    const b = mcp.send("tools/call", { name: "blender_python", arguments: { code: "2" } });
    await Promise.all([a.response, b.response]);
    const log = h.logEntries().filter((e) => e.type !== "boot");
    expect(log.map((e) => `${e.type}${e.n}`)).toEqual(["op0", "sent0", "op1", "sent1"]);
    expect(log[2].t).toBeGreaterThanOrEqual(log[1].t);
    expect(log[1].t - log[0].t).toBeGreaterThanOrEqual(150);
    // responses keep their own ids and arrive in call order
    const ids = mcp.lines.map((l) => (JSON.parse(l) as Msg).id);
    expect(ids).toEqual([a.id, b.id]);
  });

  it("X9: notifications/cancelled for a queued call — it never reaches the host and no response is sent for it", async () => {
    const h = makeHarness({ steps: [{ delayMs: 600 }, {}] });
    const mcp = startMcp(h.supervisor());
    const a = mcp.send("tools/call", { name: "blender_python", arguments: { code: "A" } });
    const b = mcp.send("tools/call", { name: "blender_python", arguments: { code: "B" } });
    expect(await waitUntil(() => h.ops().length === 1, 10_000)).toBe(true);
    mcp.notify("notifications/cancelled", { requestId: b.id, reason: "user" });
    expect((await a.response).result).toBeDefined();
    expect(await settlesWithin(b.response, 400)).toBe(false);
    expect(h.ops()).toHaveLength(1);
    expect(mcp.lines.map((l) => (JSON.parse(l) as Msg).id)).toEqual([a.id]);
    // The server keeps serving afterwards.
    expect((await mcp.call("blender_python", { code: "C" })).isError).toBe(false);
    expect(h.ops().map((o) => (o.args as { code: string }).code)).toEqual(["A", "C"]);
  });

  it("X9: cancelling the in-flight call sends no response and the next call starts a fresh session", async () => {
    const h = makeHarness({ steps: [{ delayMs: 60_000 }, {}] });
    const mcp = startMcp(h.supervisor());
    const a = mcp.send("tools/call", { name: "blender_python", arguments: { code: "A" } });
    expect(await waitUntil(() => h.ops().length === 1, 10_000)).toBe(true);
    mcp.notify("notifications/cancelled", { requestId: a.id });
    expect(await settlesWithin(a.response, 500)).toBe(false);
    const next = await mcp.call("blender_python", { code: "N" });
    expect(next.isError).toBe(false);
    expect(next.data.sessionReset).toBe(true);
  });

  it("X17: a host that exits mid-call is session-crashed; the server stays alive, stdout stays clean and the next call boots again", async () => {
    const h = makeHarness({ steps: [{ exitCode: 1, stderr: "fatal: wasm trap" }, {}] });
    const mcp = startMcp(h.supervisor());
    const crashed = await mcp.call("blender_python", { code: "x" });
    expect(crashed.isError).toBe(true);
    expect(crashed.data.code).toBe("session-crashed");
    expect(String(crashed.data.message)).toContain("fatal: wasm trap");
    expect((await mcp.send("ping").response).result).toEqual({});
    const next = await mcp.call("blender_python", { code: "y" });
    expect(next.isError).toBe(false);
    expect(next.data.sessionReset).toBe(true);
    expect(h.boots()).toHaveLength(2);
    expect(await mcp.end()).toBe(0);
    for (const l of mcp.lines) expect((JSON.parse(l) as Msg).jsonrpc).toBe("2.0");
  });

  it("closing stdin kills the live host", async () => {
    const h = makeHarness();
    const mcp = startMcp(h.supervisor());
    expect((await mcp.call("blender_scene")).isError).toBe(false);
    const pid = h.boots()[0].pid;
    await mcp.end();
    const alive = (): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(await waitUntil(() => !alive(), 5000)).toBe(true);
  });
});

describe("startup root check", () => {
  function runLauncher(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [LAUNCHER, "mcp", ...args], { cwd, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
      child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
      child.on("exit", (code) => resolve({ code, stdout, stderr }));
    });
  }

  it("E55: `--root does-not-exist` prints an error to stderr, nothing to stdout, and exits 1", async () => {
    const cwd = tmpDir();
    const r = await runLauncher(["--root", "does-not-exist"], cwd);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("does-not-exist");
    expect(r.stderr).toContain("no such directory");
  }, 60_000);

  it("E55: `--root <file>` prints an error to stderr, nothing to stdout, and exits 1", async () => {
    const cwd = tmpDir();
    fs.writeFileSync(path.join(cwd, "afile"), "x");
    const r = await runLauncher(["--root", "afile"], cwd);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("afile");
    expect(r.stderr).toContain("not a directory");
  }, 60_000);
});
