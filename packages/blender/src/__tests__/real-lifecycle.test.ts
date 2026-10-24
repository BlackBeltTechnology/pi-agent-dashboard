/**
 * L1-real: the real `bin/pi-blender mcp` launcher → server → Blender host process tree against the real
 * WebAssembly runtime (design D9). Covers isolation (no network, no host reach), cancellation, timeout,
 * boot repair, crash recovery, idle shutdown and shutdown. Gated by `describeReal` (BLENDER_WASM_E2E=1 and
 * a JSPI-capable Node); the socket-guard self-test (task 4.4) is plain L1 and always runs.
 *
 *   BLENDER_WASM_E2E=1 vitest run real-lifecycle
 *
 * Shared runtime cache: `TEST_CACHE`. The X13/X14 repair tests copy it into a per-test home and need the
 * network (they re-download the pinned tarball once).
 *
 * See change: add-blender-wasm-mcp (tasks 4.4, 4.45–4.61; test-plan X4–X24).
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PIN } from "../pin.js";
import { descendants, hostPidBelow, isAlive, type McpClient, SOCKET_GUARD, startServer, waitUntil } from "./helpers/mcp-client.js";
import { describeReal, TEST_CACHE } from "./helpers/runtime.js";

const tmpDirs: string[] = [];
const clients: McpClient[] = [];
const stray: number[] = [];

function tmpDir(prefix = "blender-life-"): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(d);
  return d;
}

function server(opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): McpClient {
  const c = startServer({ cwd: opts.cwd ?? tmpDir("blender-root-"), env: opts.env });
  clients.push(c);
  return c;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: test-suite cleanup walks several kinds of leaked resource.
afterEach(async () => {
  for (const pid of stray.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  for (const c of clients.splice(0)) {
    const pid = c.child.pid;
    const tree = pid && isAlive(pid) ? descendants(pid).map((d) => d.pid) : [];
    if (c.child.exitCode === null && c.child.signalCode === null) {
      c.child.stdin?.end();
      const exited = await Promise.race([c.exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 8000))]);
      if (!exited) c.child.kill("SIGKILL");
    }
    for (const p of tree) {
      try {
        process.kill(p, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const py = (c: McpClient, code: string, extra: Record<string, unknown> = {}) => c.call("blender_python", { code, ...extra });
const host = (c: McpClient): number | undefined => hostPidBelow(c.child.pid as number);
/** Pid of the live host, failing the test with context when there is none. */
function mustHost(c: McpClient): number {
  const pid = host(c);
  if (pid === undefined) throw new Error(`no Blender host below the launcher; stderr:\n${c.stderr()}`);
  return pid;
}
const gone = (pid: number, ms: number) => waitUntil(() => !isAlive(pid), ms);

// ── Plain L1: the socket guard itself (task 4.4) ────────────────────────────

describe("socket-guard self-test (task 4.4)", () => {
  function runGuarded(script: string): { log: { pid: number; kind: string; detail: string }[]; stdout: string } {
    const dir = tmpDir("blender-guard-");
    const logFile = path.join(dir, "guard.log");
    const file = path.join(dir, "child.cjs");
    fs.writeFileSync(file, script);
    const stdout = execFileSync(process.execPath, [file], {
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: `--require ${SOCKET_GUARD}`, BLENDER_WASM_GUARD_LOG: logFile },
      timeout: 30_000,
    });
    const text = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
    return { log: text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { pid: number; kind: string; detail: string }), stdout };
  }

  it("a child that listens, connects, opens a dgram socket and constructs a WebSocket is logged for each", () => {
    const { log } = runGuarded(`
      const net = require("node:net"), dgram = require("node:dgram");
      const srv = net.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const port = srv.address().port;
        const s = net.connect(port, "127.0.0.1");
        s.on("error", () => {});
        s.on("connect", () => s.destroy());
        const d = dgram.createSocket("udp4");
        d.on("error", () => {});
        d.close();
        try { new WebSocket("ws://127.0.0.1:" + port); } catch {}
        setTimeout(() => process.exit(0), 300);
      });
    `);
    const kinds = new Set(log.map((l) => l.kind));
    expect(kinds).toEqual(new Set(["listen", "connect", "dgram", "websocket"]));
    expect(log.every((l) => typeof l.pid === "number")).toBe(true);
  });

  it("a unix-socket connect to an arbitrary path is logged, a connect to a tsx tooling pipe is not", () => {
    const { log } = runGuarded(`
      const net = require("node:net"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-sock-"));
      fs.mkdirSync(path.join(dir, "tsx-501"));
      const bs = String.fromCharCode(92), win = process.platform === "win32";
      const plain = win ? bs + bs + "." + bs + "pipe" + bs + "guard-plain-" + process.pid : path.join(dir, "plain.sock");
      const tooling = win ? bs + bs + "." + bs + "pipe" + bs + "tsx-" + process.pid : path.join(dir, "tsx-501", "4242.pipe");
      let left = 2;
      const done = () => { if (--left === 0) { fs.rmSync(dir, { recursive: true, force: true }); process.exit(0); } };
      for (const p of [plain, tooling]) {
        const srv = net.createServer((s) => s.destroy());
        srv.listen(p, () => { const c = net.connect(p); c.on("error", done); c.on("close", done); });
      }
    `);
    const connects = log.filter((l) => l.kind === "connect");
    expect(connects).toHaveLength(1);
    expect(connects[0].detail).toMatch(/guard-plain|plain\.sock/);
    expect(log.filter((l) => l.kind === "listen")).toHaveLength(2);
  });

  it("a child that does none of these produces an empty log", () => {
    const { log, stdout } = runGuarded(`console.log("quiet " + (1 + 1));`);
    expect(stdout.trim()).toBe("quiet 2");
    expect(log).toEqual([]);
  });

  it("a child with an IPC channel and piped stdio (no network) produces an empty log", async () => {
    const dir = tmpDir("blender-guard-");
    const logFile = path.join(dir, "guard.log");
    const file = path.join(dir, "ipc-child.cjs");
    fs.writeFileSync(file, `process.on("message", (m) => { process.send({ echo: m }); process.exit(0); });`);
    const child = spawn(process.execPath, [file], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: { ...process.env, NODE_OPTIONS: `--require ${SOCKET_GUARD}`, BLENDER_WASM_GUARD_LOG: logFile },
    });
    const reply = new Promise<unknown>((resolve) => child.once("message", resolve));
    child.send("hi");
    expect(await reply).toEqual({ echo: "hi" });
    await new Promise((r) => child.once("exit", r));
    expect(fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "").toBe("");
  });
});

// ── L1-real ─────────────────────────────────────────────────────────────────

describeReal("real lifecycle: isolation", () => {
  it("X4: boot plus one call of each tool under the socket guard leaves the guard log empty for the server and host", async () => {
    const root = tmpDir("blender-root-");
    const logFile = path.join(tmpDir("blender-guard-"), "guard.log");
    fs.writeFileSync(path.join(root, "seed.txt"), "seed");
    // A private copy of the valid cache: a shared-cache re-provision by another suite would (legitimately)
    // connect to the registry and must not be mistaken for a leak by this test.
    const { home } = copiedHome();
    const c = server({ cwd: root, env: { BLENDER_WASM_HOME: home, BLENDER_WASM_DIR: "", NODE_OPTIONS: `--require ${SOCKET_GUARD}`, BLENDER_WASM_GUARD_LOG: logFile } });

    const scene = await c.call("blender_scene");
    expect(scene.isError, JSON.stringify(scene.data)).toBe(false);
    const python = await py(c, "import bpy\nbpy.ops.mesh.primitive_cube_add()\nprint('cube')");
    expect(python.isError, JSON.stringify(python.data)).toBe(false);
    const exported = await c.call("blender_export", { path: "out/x4.glb" });
    expect(exported.isError, JSON.stringify(exported.data)).toBe(false);
    const imported = await c.call("blender_import", { path: "out/x4.glb" });
    expect(imported.isError, JSON.stringify(imported.data)).toBe(false);
    const reset = await c.call("blender_reset", { mode: "empty" });
    expect(reset.isError, JSON.stringify(reset.data)).toBe(false);

    const tree = descendants(c.child.pid as number);
    const hostPid = mustHost(c);
    const watched = new Set([c.child.pid as number, hostPid, ...tree.map((d) => d.pid)]);
    const text = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
    const entries = text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { pid: number; kind: string; detail: string });
    expect(entries.filter((e) => watched.has(e.pid)), `guard log:\n${text}`).toEqual([]);
    expect(text, "the log must be empty for every process, not only the final tree").toBe("");
  });

  it("X5: python socket.connect to a local TCP listener fails with OSError and the listener sees no connection", async () => {
    let connections = 0;
    const listener = net.createServer((s) => {
      connections++;
      s.destroy();
    });
    await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r));
    const port = (listener.address() as net.AddressInfo).port;
    try {
      const c = server();
      const r = await py(
        c,
        `import socket
try:
    s = socket.socket()
    s.connect(("127.0.0.1", ${port}))
    print("CONNECTED")
except BaseException as e:
    print("EXC", type(e).__name__, [k.__name__ for k in type(e).__mro__], repr(e))
`,
      );
      expect(r.isError, JSON.stringify(r.data)).toBe(false);
      expect(r.output).toContain("OSError");
      expect(r.output).not.toContain("CONNECTED");
      await new Promise((res) => setTimeout(res, 500));
      expect(connections).toBe(0);
    } finally {
      await new Promise<void>((r) => listener.close(() => r()));
    }
  });

  it("X6: python cannot read a unique host file outside the root: neither output nor written files contain the secret", async () => {
    const secret = `S3CRET-${randomUUID()}`;
    const hostFile = path.join(tmpDir("blender-secret-"), "secret.txt");
    fs.writeFileSync(hostFile, secret);
    const root = tmpDir("blender-root-");
    const c = server({ cwd: root });
    const r = await py(
      c,
      `import os
try:
    data = open(${JSON.stringify(hostFile)}).read()
    print("READ", data)
    open("/out/leak.txt", "w").write(data)
except BaseException as e:
    print("EXC", type(e).__name__, repr(e))
`,
    );
    const everything = JSON.stringify(r.raw) + (r.output ?? "");
    expect(everything).not.toContain(secret);
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    for (const f of walk(root)) expect(fs.readFileSync(f, "utf8"), f).not.toContain(secret);
    expect(r.output ?? "").toContain("EXC");
  });

  it("X7: python subprocess.run fails with python-error naming OSError", async () => {
    const c = server();
    const r = await py(c, `import subprocess\nsubprocess.run(["ls"])`);
    expect(r.isError).toBe(true);
    expect(r.data.code).toBe("python-error");
    expect(`${String(r.data.message)}\n${r.output ?? ""}`).toContain("OSError");
  });
});

describeReal("real lifecycle: cancel, timeout, crash, idle", () => {
  it("X10: cancelling a call in flight sends no response, kills the host within 5 s, and the next call has sessionReset", async () => {
    const c = server();
    const warm = await c.call("blender_scene");
    expect(warm.isError, JSON.stringify(warm.data)).toBe(false);
    const hostPid = mustHost(c);

    const { id, response } = c.callAsync("blender_python", { code: "import time\ntime.sleep(60)" });
    let settled = false;
    void response.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 1500));
    expect(settled).toBe(false);
    expect(isAlive(hostPid)).toBe(true);

    c.notify("notifications/cancelled", { requestId: id });
    expect(await gone(hostPid, 5000), "host pid still alive 5 s after cancel").toBe(true);
    await new Promise((r) => setTimeout(r, 3000));
    expect(settled, "a cancelled call must not receive a response").toBe(false);

    const next = await c.call("blender_scene");
    expect(next.isError, JSON.stringify(next.data)).toBe(false);
    expect(next.data.sessionReset).toBe(true);
  });

  it("X11: an endless loop with timeoutSec 5 returns timeout within 10 s, the host is gone within 5 s, the next call has sessionReset", async () => {
    const c = server();
    const warm = await c.call("blender_scene");
    expect(warm.isError, JSON.stringify(warm.data)).toBe(false);
    const hostPid = mustHost(c);

    const started = Date.now();
    const r = await py(c, "while True:\n    pass", { timeoutSec: 5 });
    const elapsed = Date.now() - started;
    expect(r.isError).toBe(true);
    expect(r.data.code).toBe("timeout");
    expect(elapsed).toBeLessThanOrEqual(10_000);
    expect(await gone(hostPid, 5000), "host pid still alive after the timeout result").toBe(true);

    const next = await c.call("blender_scene");
    expect(next.isError, JSON.stringify(next.data)).toBe(false);
    expect(next.data.sessionReset).toBe(true);
  });

  it("X16: python os.abort() is session-crashed with diagnostic lines, ping still works, the next call has sessionReset", async () => {
    const c = server();
    const warm = await c.call("blender_scene");
    expect(warm.isError, JSON.stringify(warm.data)).toBe(false);
    const hostPid = mustHost(c);

    const r = await py(c, "import os\nos.abort()");
    expect(r.isError).toBe(true);
    expect(r.data.code).toBe("session-crashed");
    const message = String(r.data.message);
    expect(message).toMatch(/\n./); // header line plus at least one diagnostic line
    expect(message).not.toContain("(no diagnostic output)");
    expect(await gone(hostPid, 5000)).toBe(true);

    const ping = await c.rpc("ping");
    expect(ping.error).toBeUndefined();
    expect(ping.result).toEqual({});

    const next = await c.call("blender_scene");
    expect(next.isError, JSON.stringify(next.data)).toBe(false);
    expect(next.data.sessionReset).toBe(true);
  });

  it("X18: after BLENDER_WASM_IDLE_SEC=2 of idleness the host is gone and the next result has sessionReset", async () => {
    const c = server({ env: { BLENDER_WASM_IDLE_SEC: "2" } });
    const first = await c.call("blender_scene");
    expect(first.isError, JSON.stringify(first.data)).toBe(false);
    expect(first.data.sessionReset).toBe(false);
    const hostPid = mustHost(c);

    await new Promise((r) => setTimeout(r, 3000));
    expect(isAlive(hostPid), "old host pid must be gone during the 3 s gap").toBe(false);

    const next = await c.call("blender_scene");
    expect(next.isError, JSON.stringify(next.data)).toBe(false);
    expect(next.data.sessionReset).toBe(true);
  });

  it("X19: a 4 s call with BLENDER_WASM_IDLE_SEC=2 is not cut off by the idle timer and reports sessionReset false", async () => {
    const c = server({ env: { BLENDER_WASM_IDLE_SEC: "2" } });
    const warm = await c.call("blender_scene");
    expect(warm.isError, JSON.stringify(warm.data)).toBe(false);
    const r = await py(c, "import time\ntime.sleep(4)\nprint('slept')");
    expect(r.isError, JSON.stringify(r.data)).toBe(false);
    expect(r.data.sessionReset).toBe(false);
    expect(r.output).toContain("slept");
  });

  it("X22: with Node 24, a valid cache and no flags given to the server, blender_scene succeeds", async () => {
    const c = server();
    expect(c.child.spawnargs.join(" ")).not.toContain("experimental-wasm-jspi");
    const r = await c.call("blender_scene");
    expect(r.isError, JSON.stringify(r.data)).toBe(false);
    expect(typeof r.data.blenderVersion).toBe("string");
  });
});

describeReal("real lifecycle: shutdown", () => {
  it("X23: closing the server's stdin exits the server and kills the host within 5 s", async () => {
    const c = server();
    const warm = await c.call("blender_scene");
    expect(warm.isError, JSON.stringify(warm.data)).toBe(false);
    const hostPid = mustHost(c);
    const pids = descendants(c.child.pid as number).map((d) => d.pid);
    stray.push(...pids);

    await c.close();
    expect(await waitUntil(() => c.child.exitCode !== null || c.child.signalCode !== null, 5000)).toBe(true);
    expect(await gone(hostPid, 5000), "host pid still alive 5 s after stdin close").toBe(true);
    for (const p of pids) expect(await gone(p, 5000), `pid ${p} survived the shutdown`).toBe(true);
  });

  it("X24: SIGKILL of the launcher alone leaves no server or host process after 5 s", async () => {
    const c = server();
    const warm = await c.call("blender_scene");
    expect(warm.isError, JSON.stringify(warm.data)).toBe(false);
    const hostPid = mustHost(c);

    const loop = c.callAsync("blender_python", { code: "while True:\n    pass" });
    void loop.response.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1500));
    expect(isAlive(hostPid)).toBe(true);

    // Collect the whole tree BEFORE the kill: server + host (+ anything else below the launcher).
    const launcher = c.child.pid as number;
    const below = descendants(launcher).map((d) => d.pid);
    expect(below.length).toBeGreaterThanOrEqual(2);
    expect(below).toContain(hostPid);
    stray.push(...below);

    if (process.platform === "win32") execFileSync("taskkill", ["/F", "/PID", String(launcher)]); // no /T: the tree must die by itself
    else process.kill(launcher, "SIGKILL");

    for (const p of below) expect(await gone(p, 5000), `pid ${p} still alive 5 s after the launcher was killed`).toBe(true);
  });
});

// ── Boot failure + repair (needs the network for the re-provision) ───────────

const sha256File = (p: string): string => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

/** A fresh BLENDER_WASM_HOME holding a byte-for-byte copy of the shared valid cache. */
function copiedHome(): { home: string; versionDir: string } {
  const home = tmpDir("blender-home-");
  fs.cpSync(path.join(TEST_CACHE, PIN.version), path.join(home, PIN.version), { recursive: true });
  return { home, versionDir: path.join(home, PIN.version) };
}

/** Overwrite `len` bytes at the middle of `file` with 0xFF, keeping its size. */
function corruptInPlace(file: string, len: number): void {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, "r+");
  try {
    fs.writeSync(fd, Buffer.alloc(len, 0xff), 0, len, Math.floor(size / 2));
  } finally {
    fs.closeSync(fd);
  }
  expect(fs.statSync(file).size).toBe(size);
}

async function expectBootFailThenRepair(file: string, bytes: number): Promise<void> {
  const { home, versionDir } = copiedHome();
  const target = path.join(versionDir, file);
  const good = sha256File(target);
  corruptInPlace(target, bytes);
  expect(sha256File(target)).not.toBe(good);

  const c = server({ env: { BLENDER_WASM_HOME: home, BLENDER_WASM_DIR: "" } });
  const first = await c.call("blender_scene");
  expect(first.isError).toBe(true);
  expect(first.data.code, JSON.stringify(first.data)).toBe("boot-failed");
  // repairAfterBootFailure re-hashed against the stamp and deleted the damaged version dir.
  expect(fs.existsSync(versionDir), "the damaged cache dir must be deleted after the boot failure").toBe(false);
  expect(c.stderr()).toContain("failed verification; removing it");

  const ping = await c.rpc("ping");
  expect(ping.error).toBeUndefined();

  const second = await c.call("blender_scene");
  expect(second.isError, `${JSON.stringify(second.data)}\n${c.stderr()}`).toBe(false);
  expect(c.stderr(), "the next call must re-provision (download observed)").toContain("downloading @knervous/blender-web@0.0.5");
  expect(sha256File(target), "the runtime file must be restored").toBe(good);
}

describeReal("real lifecycle: boot failure + repair", () => {
  it("X13: a cached blender.wasm with the same size and corrupted bytes gives boot-failed; ping ok; the next call re-provisions and succeeds", async () => {
    await expectBootFailThenRepair(path.join("runtime", "st", "blender.wasm"), 1);
  });

  it("X14: a cached runtime/st/blender.js with the same size and corrupted content gives boot-failed; the next call re-provisions and succeeds", async () => {
    await expectBootFailThenRepair(path.join("runtime", "st", "blender.js"), 4096);
  });
});
