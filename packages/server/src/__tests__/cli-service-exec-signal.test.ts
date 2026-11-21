/**
 * `service exec` signal forwarding against REAL children (the unit half, with a
 * stub child + signal seam, lives in cli-service.test.ts). A real SIGTERM-ignoring
 * child is reaped by SIGKILL after the grace, the lease is released first, and
 * exec exits 137; a reparented descendant is deliberately NOT reaped (non-goal).
 * Real-process member: see vitest.real-process-files.ts.
 * See change: harden-path-and-process-guards (#1103; test-plan #S33, #X19).
 */
import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cmdService } from "../services/cli-service.js";

const posix = process.platform !== "win32";
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function stubFetch(releases: string[]): typeof fetch {
  return (async (url: string | URL | Request) => {
    const leaf = new URL(String(url)).pathname.split("/").pop() as string;
    if (leaf === "release") releases.push(String(Date.now()));
    const data = leaf === "ensure" ? { id: "svc", state: "healthy", leaseId: "L1" } : { ok: true };
    return { status: 200, json: async () => ({ success: true, data }) } as Response;
  }) as typeof fetch;
}

const stray: number[] = [];
afterEach(() => {
  for (const pid of stray.splice(0)) if (alive(pid)) process.kill(pid, "SIGKILL");
});

describe.skipIf(!posix)("exec signal forwarding — real children", () => {
  it("#S33 a SIGTERM-ignoring child is SIGKILLed after the grace, lease released, exit 137", async () => {
    let child: ChildProcess | undefined;
    const releases: string[] = [];
    const source = new EventEmitter();
    const t0 = Date.now();
    const done = cmdService(
      ["exec", "svc", "--", process.execPath, "-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1e3)"],
      {
        port: 1,
        out: () => {},
        err: () => {},
        fetch: stubFetch(releases),
        signalSource: source,
        spawnChild: ((cmd: string, args: string[], opts: object) => (child = nodeSpawn(cmd, args, opts))) as never,
      },
    );
    await new Promise((r) => setTimeout(r, 500)); // let node install its SIGTERM handler
    const pid = child?.pid as number;
    stray.push(pid);
    expect(alive(pid)).toBe(true);
    source.emit("SIGTERM");
    const code = await done;
    expect(code).toBe(137);
    expect(alive(pid)).toBe(false);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(5000 + 400); // not killed early: full default grace
    expect(releases).toHaveLength(1);
  });

  it("#X19 a reparented descendant is NOT reaped; exec still returns the child's status and releases", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-sig-"));
    const pidFile = path.join(dir, "pid");
    const releases: string[] = [];
    try {
      const code = await cmdService(["exec", "svc", "--", "sh", "-c", `sleep 100 & echo $! > ${pidFile}; exit 3`], {
        port: 1,
        out: () => {},
        err: () => {},
        fetch: stubFetch(releases),
        signalSource: new EventEmitter(),
      });
      expect(code).toBe(3);
      expect(releases).toHaveLength(1);
      const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
      stray.push(pid);
      expect(alive(pid)).toBe(true); // pins the documented non-goal
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
