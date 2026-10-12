import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { parseMcpArgs, runMcp } from "../mcp-proxy.js";
import type { ProvisionReport } from "../provision.js";
import { cleanupTmp, tmpDir } from "./helpers/fixtures.js";
import { CLI, TSX } from "./helpers/paths.js";
import { MCP_STUB, nodeStub, readLog } from "./helpers/stubs.js";

afterEach(cleanupTmp);

const report = (binary: string): ProvisionReport => ({ version: null, source: "override", asset: null, cacheHit: false, binary, durationMs: 0 });

/** A fake child process that exits right away; records the spawn call. */
function fakeSpawn() {
  const calls: { command: string; args: string[] }[] = [];
  const spawn = (command: string, args: string[]) => {
    calls.push({ command, args });
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: () => true });
    setImmediate(() => child.emit("exit", 0, null));
    return child as unknown as ChildProcess;
  };
  return { calls, spawn };
}

function harness(extra: Partial<Parameters<typeof runMcp>[1]> = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const outChunks: string[] = [];
  stdout.on("data", (d) => outChunks.push(d.toString()));
  const err: string[] = [];
  const signals: Record<string, () => void> = {};
  return {
    stdin,
    out: () => outChunks.join(""),
    err: () => err.join(""),
    signals,
    deps: {
      stdin,
      stdout,
      stderr: (t: string) => err.push(t),
      cwd: () => "/tmp/p",
      onSignal: (s: string, h: () => void) => {
        signals[s] = h;
      },
      ...extra,
    } as Parameters<typeof runMcp>[1],
  };
}

describe("root translation + option handling", () => {
  it("E18 default root is the cwd, --root overrides; both automation roots are set and stderr names the root", async () => {
    for (const [argv, root] of [[[], "/tmp/p"], [["--root", "/tmp/q"], "/tmp/q"]] as const) {
      const f = fakeSpawn();
      const h = harness({ provision: async () => report("/bin/pc"), spawn: f.spawn as never });
      h.stdin.end();
      expect(await runMcp([...argv], h.deps)).toBe(0);
      expect(f.calls).toEqual([{ command: "/bin/pc", args: ["mcp", "--automation-read-root", root, "--automation-write-root", root] }]);
      expect(h.err()).toContain(root);
    }
  });

  it("E19 other options are usage errors and never start a server; --help exits 0", async () => {
    for (const bad of [["--automation-read-root", "/"], ["--bridge", "127.0.0.1:1"], ["--control-token", "x"]]) {
      const f = fakeSpawn();
      const h = harness({ provision: async () => report("/bin/pc"), spawn: f.spawn as never });
      expect(await runMcp(bad, h.deps)).toBe(1);
      expect(f.calls).toHaveLength(0);
      expect(h.err()).toContain("usage: pi-photocraft mcp");
    }
    const f = fakeSpawn();
    const h = harness({ provision: async () => report("/bin/pc"), spawn: f.spawn as never });
    expect(await runMcp(["--help"], h.deps)).toBe(0);
    expect(f.calls).toHaveLength(0);
    expect(parseMcpArgs(["-h"]).kind).toBe("help");
  });

  it("X10 provisioning failure: nothing on stdout, error on stderr, exit 69", async () => {
    const f = fakeSpawn();
    const h = harness({
      provision: async () => {
        throw new Error("no network");
      },
      spawn: f.spawn as never,
    });
    expect(await runMcp([], h.deps)).toBe(69);
    expect(h.out()).toBe("");
    expect(h.err()).toContain("no network");
    expect(f.calls).toHaveLength(0);
  });
});

describe("serialization", () => {
  function setupStub(env: Record<string, string> = {}) {
    const dir = tmpDir();
    const logFile = path.join(dir, "events.jsonl");
    const bin = nodeStub(MCP_STUB);
    const spawn = (command: string, args: string[], options: object) =>
      nodeSpawn(command, args, { ...options, env: { ...process.env, STUB_LOG: logFile, ...env } } as never);
    return { logFile, bin, spawn };
  }

  it("F1 tools/call is serialized; initialize and notifications pass through immediately", async () => {
    const s = setupStub();
    const h = harness({ provision: async () => report(s.bin), spawn: s.spawn as never });
    const msg = (o: object) => `${JSON.stringify({ jsonrpc: "2.0", ...o })}\n`;
    h.stdin.write(msg({ id: 0, method: "initialize" }));
    h.stdin.write(msg({ id: 1, method: "tools/call", params: { name: "doc_open" } }));
    h.stdin.write(msg({ id: 2, method: "tools/call", params: { name: "command_run" } }));
    h.stdin.write(msg({ method: "notifications/x" }));
    h.stdin.end();
    expect(await runMcp([], h.deps)).toBe(0);

    const events = readLog(s.logFile);
    const t = (ev: string, key?: string, id?: number) => events.find((e) => e.ev === ev && (key === undefined || e.key === key) && (id === undefined || e.id === id))?.t as number;
    const order = events.filter((e) => e.ev === "recv").map((e) => e.key);
    expect(order).toEqual(["initialize", "call#1", "notifications/x", "call#2"]);
    expect(t("recv", "call#2")).toBeGreaterThanOrEqual(t("send", undefined, 1));
    expect(t("recv", "notifications/x")).toBeLessThan(t("send", undefined, 1));
    const ids = h
      .out()
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).id);
    expect(ids.sort()).toEqual([0, 1, 2]);
  });

  it("F3 non-JSON server stdout goes to stderr, never into the MCP channel", async () => {
    const s = setupStub({ STUB_NOISE: "1" });
    const h = harness({ provision: async () => report(s.bin), spawn: s.spawn as never });
    h.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call" })}\n`);
    h.stdin.end();
    expect(await runMcp([], h.deps)).toBe(0);
    const lines = h.out().trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).id).toBe(7);
    expect(h.err()).toContain("warning: x");
  });
});

describe("signals", () => {
  it("X11 SIGTERM / SIGINT terminate the server child and exit 143 / 130", async () => {
    for (const [signal, code] of [["SIGTERM", 143], ["SIGINT", 130]] as const) {
      const dir = tmpDir();
      const pidFile = path.join(dir, "pid");
      const bin = nodeStub(MCP_STUB);
      const wrapper = nodeSpawn(process.execPath, ["--import", TSX, CLI, "mcp", "--root", dir], {
        env: { ...process.env, NODE_OPTIONS: "", PHOTOCRAFT_BIN: bin, STUB_HANG: pidFile },
        stdio: ["pipe", "ignore", "ignore"],
      });
      const exited = new Promise<number | null>((resolve) => wrapper.on("close", (c) => resolve(c)));
      const deadline = Date.now() + 15_000;
      while (!fs.existsSync(pidFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      expect(fs.existsSync(pidFile)).toBe(true);
      const childPid = Number(fs.readFileSync(pidFile, "utf8"));
      wrapper.kill(signal);
      expect(await exited).toBe(code);
      await new Promise((r) => setTimeout(r, 100));
      let alive = true;
      try {
        process.kill(childPid, 0);
      } catch {
        alive = false;
      }
      expect(alive).toBe(false);
    }
  }, 40_000);
});
