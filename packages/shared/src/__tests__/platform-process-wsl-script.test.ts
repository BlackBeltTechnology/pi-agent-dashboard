/**
 * The WSL `sh -c` scripts of probeProcessStart / wslLiveness / verifyAndKillWsl,
 * run for real on Linux through a local seam (the script only needs `sh`,
 * `/proc`, `cat`, `sleep`, `getconf`). Skipped elsewhere: macOS has no /proc and
 * the real-distro behaviour is covered by the windows CI leg.
 * See change: add-windows-process-identity (test-plan E22-E27, E23b, E23c).
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  probeProcessStart,
  resetProcessControlLimiter,
  verifyAndKillWsl,
  wslLiveness,
  type ProcessControlExecFn,
} from "../platform/process.js";

const linux = process.platform === "linux";
const D = "Ubuntu-22.04";
const WIN = { platform: "win32" as const, env: { SystemRoot: "C:\\Windows" } as NodeJS.ProcessEnv };

/** Runs the script argument (`args[5]`) locally with `sh -c`; `PATH` and locale controllable. */
function localSeam(envPath = process.env.PATH ?? "/usr/bin:/bin"): ProcessControlExecFn {
  return (_file, args, o) =>
    new Promise((resolve, reject) => {
      execFile(
        "/bin/sh",
        ["-c", args[5]],
        { env: { PATH: envPath, LANG: "hu_HU.UTF-8" }, signal: o.signal, encoding: "utf8" },
        (err, stdout) => (err ? reject(err) : resolve(String(stdout))),
      );
    });
}
const opts = (envPath?: string) => ({ ...WIN, execFile: localSeam(envPath) });

const children: ChildProcess[] = [];
const strays = new Set<number>();

/** A detached child (own session/group, pgid = pid). Resolves with its pid and printed extra pids. */
async function spawnLeader(script: string, cmd = "sh", args?: string[]): Promise<{ child: ChildProcess; pid: number; extra: number[] }> {
  const child = spawn(cmd, args ?? ["-c", script], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  children.push(child);
  let out = "";
  child.stdout?.on("data", (d) => (out += d));
  await new Promise((r) => setTimeout(r, 400));
  const extra = out.split(/\s+/).filter(Boolean).map(Number);
  for (const p of extra) strays.add(p);
  return { child, pid: child.pid as number, extra };
}

function isDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return true;
  }
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z");
  } catch {
    return true;
  }
}

beforeEach(() => resetProcessControlLimiter());
afterEach(() => {
  for (const c of children.splice(0)) {
    try {
      process.kill(-(c.pid as number), "SIGKILL");
    } catch {
      /* gone */
    }
  }
  for (const p of strays) {
    try {
      process.kill(p, "SIGKILL");
    } catch {
      /* gone */
    }
  }
  strays.clear();
});
const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

describe.skipIf(!linux)("WSL scripts, run locally on Linux", () => {
  it("probe: the age measured by the script puts the start within a second of the spawn", async () => {
    const before = Date.now();
    const { pid } = await spawnLeader("exec sleep 300");
    const start = await probeProcessStart(pid, { kind: "wsl", distro: D }, opts());
    expect(start).not.toBeNull();
    expect(start as number).toBeGreaterThanOrEqual(before - 1500);
    expect(start as number).toBeLessThanOrEqual(Date.now() + 100);
  });

  it("liveness: alive, then absent after the process is gone (hostile locale)", async () => {
    const { child, pid } = await spawnLeader("exec sleep 300");
    expect(await wslLiveness(pid, D, opts())).toBe("alive");
    child.kill("SIGKILL");
    await new Promise((r) => child.once("exit", r));
    expect(await wslLiveness(pid, D, opts())).toBe("absent");
  });

  it("E22: a group leader is killed with its group, including a SIGTERM-ignoring worker", async () => {
    const { pid, extra } = await spawnLeader(
      `sh -c 'trap "" TERM; while :; do sleep 0.1; done' & echo $!; wait`,
    );
    const worker = extra[0];
    expect(worker).toBeGreaterThan(0);
    expect(await verifyAndKillWsl(pid, D, { ...opts(), timeoutMs: 500 })).toBe("killed");
    expect(isDead(pid)).toBe(true);
    expect(isDead(worker)).toBe(true);
  });

  it("E23: a non-leader gets a single-pid kill; its group and sibling survive", async () => {
    const { pid: leader, extra } = await spawnLeader("sleep 300 & echo $!; sleep 300 & echo $!; wait");
    const [n, sibling] = extra;
    expect(await verifyAndKillWsl(n, D, { ...opts(), timeoutMs: 500 })).toBe("killed");
    expect(isDead(n)).toBe(true);
    expect(isDead(sibling)).toBe(false);
    expect(isDead(leader)).toBe(false);
  });

  it("E23b: works with a PATH that has no `ps`", async () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "wsl-nops-"));
    tmpDirs.push(bin);
    for (const tool of ["sh", "cat", "sleep", "getconf"]) {
      const real = ["/bin", "/usr/bin"].map((d) => path.join(d, tool)).find((p) => fs.existsSync(p));
      if (real) fs.symlinkSync(real, path.join(bin, tool));
    }
    const { pid: leader, extra: e1 } = await spawnLeader("sleep 300 & echo $!; wait");
    expect(await verifyAndKillWsl(leader, D, { ...opts(bin), timeoutMs: 500 })).toBe("killed");
    expect(isDead(leader)).toBe(true);
    expect(isDead(e1[0])).toBe(true);
    const { extra } = await spawnLeader("sleep 300 & echo $!; wait");
    expect(await verifyAndKillWsl(extra[0], D, { ...opts(bin), timeoutMs: 500 })).toBe("killed");
  });

  it("E23c: a comm field with spaces and parentheses does not break the pgid parse", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wsl-comm-"));
    tmpDirs.push(dir);
    // A copy of the shell (single-purpose binary, unlike a multi-call coreutils) keeps the odd comm
    // while it loops; `sleep` children are its group's other members.
    const sh = ["/bin/sh", "/usr/bin/sh"].find((p) => fs.existsSync(p)) as string;
    const odd = path.join(dir, "a b) 1 (c");
    fs.copyFileSync(sh, odd);
    fs.chmodSync(odd, 0o755);
    const { pid } = await spawnLeader("", odd, ["-c", "while :; do sleep 1; done"]);
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    expect(stat).toContain("(a b) 1 (c)"); // the hostile comm really is in /proc/<pid>/stat
    expect(await verifyAndKillWsl(pid, D, { ...opts(), timeoutMs: 500 })).toBe("killed");
    expect(isDead(pid)).toBe(true);
  });

  it("E24: SIGKILL after the SIGTERM wait", async () => {
    const { pid } = await spawnLeader(`trap "" TERM; while :; do sleep 0.1; done`);
    const t0 = Date.now();
    expect(await verifyAndKillWsl(pid, D, { ...opts(), timeoutMs: 500 })).toBe("killed");
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(500);
    expect(elapsed).toBeLessThanOrEqual(2500);
    expect(isDead(pid)).toBe(true);
  });

  it("E25: the age check refuses a younger process and signals nothing", async () => {
    const { pid } = await spawnLeader("exec sleep 300");
    expect(await verifyAndKillWsl(pid, D, { ...opts(), minAgeMs: 3_600_000, timeoutMs: 500 })).toBe("mismatch");
    expect(isDead(pid)).toBe(false);
  });

  it("E25b: an old enough process passes (minAgeMs 1000 and 0)", async () => {
    const a = await spawnLeader("exec sleep 300");
    const b = await spawnLeader("exec sleep 300");
    await new Promise((r) => setTimeout(r, 3000));
    expect(await verifyAndKillWsl(a.pid, D, { ...opts(), minAgeMs: 1000, timeoutMs: 500 })).toBe("killed");
    expect(await verifyAndKillWsl(b.pid, D, { ...opts(), minAgeMs: 0, timeoutMs: 500 })).toBe("killed");
  }, 15_000);

  it("E26: an already-reaped pid is `absent` by the explicit marker", async () => {
    const { child, pid } = await spawnLeader("exec sleep 300");
    child.kill("SIGKILL");
    await new Promise((r) => child.once("exit", r));
    expect(await verifyAndKillWsl(pid, D, { ...opts(), timeoutMs: 500 })).toBe("absent");
  });

  it("E27: a process that exits during the SIGTERM wait is `killed` with no SIGKILL", async () => {
    const { child, pid } = await spawnLeader(`trap "sleep 0.1; exit 7" TERM; while :; do sleep 0.05; done`);
    const exited = new Promise<[number | null, NodeJS.Signals | null]>((r) => child.once("exit", (c, s) => r([c, s])));
    expect(await verifyAndKillWsl(pid, D, { ...opts(), timeoutMs: 1500 })).toBe("killed");
    expect(await exited).toEqual([7, null]);
  });
});
