/**
 * Windows / WSL process identity helpers in packages/shared/src/platform/process.ts:
 * probeProcessStart, verifyAndKillWindows, wslLiveness, verifyAndKillWsl and
 * the shared 2-slot limiter. All through the injectable async exec seam.
 * See change: add-windows-process-identity (test-plan E1-E18g, E24b, P2-P4, X1, X2, X7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  probeProcessStart,
  resetProcessControlLimiter,
  verifyAndKillWindows,
  verifyAndKillWsl,
  wslLiveness,
  type ProcessControlExecFn,
  type ProcessTarget,
} from "../platform/process.js";

const WIN = { platform: "win32" as const, env: { SystemRoot: "C:\\Windows" } as NodeJS.ProcessEnv };
const PS = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const WSL = "C:\\Windows\\System32\\wsl.exe";
const D = "Ubuntu-22.04";

/** Recording exec that resolves a fixed stdout. */
function fixed(stdout: string | Error) {
  const fn = vi.fn<ProcessControlExecFn>(async () => {
    if (stdout instanceof Error) throw stdout;
    return stdout;
  });
  return fn;
}

/** Exec whose promises are settled by the test; records peak concurrency. */
function manual() {
  const pending: Array<{ file: string; args: string[]; signal: AbortSignal; settle: (v: string) => void }> = [];
  const started: string[] = [];
  let live = 0;
  let peak = 0;
  const fn: ProcessControlExecFn = (file, args, o) =>
    new Promise<string>((resolve, reject) => {
      live++;
      peak = Math.max(peak, live);
      started.push(file);
      const done = () => {
        live--;
      };
      o.signal.addEventListener("abort", () => {
        done();
        reject(new Error("aborted"));
      });
      pending.push({
        file,
        args,
        signal: o.signal,
        settle: (v) => {
          done();
          resolve(v);
        },
      });
    });
  return { fn, pending, started, peak: () => peak, live: () => live };
}

beforeEach(() => {
  resetProcessControlLimiter();
});
afterEach(() => {
  vi.useRealTimers();
  resetProcessControlLimiter();
});

describe("probeProcessStart — win32 host", () => {
  it("E1: absolute PowerShell path, pid in the script, parsed epoch ms", async () => {
    const exec = fixed("1700000000123\r\n");
    const r = await probeProcessStart(4242, { kind: "host" }, { ...WIN, execFile: exec });
    expect(r).toBe(1700000000123);
    expect(exec).toHaveBeenCalledTimes(1);
    const [file, args] = exec.mock.calls[0];
    expect(file).toBe(PS);
    expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-Command"]);
    expect(args[3]).toContain("Get-Process -Id 4242");
    expect(args[3]).toContain("StartTime");
  });

  it("E11: a hostile PATH cannot redirect the binary; no bare names, no shell", async () => {
    const exec = fixed("1");
    const env = { SystemRoot: "C:\\Windows", PATH: "C:\\evil;C:\\Windows" };
    await probeProcessStart(1, { kind: "host" }, { platform: "win32", env, execFile: exec });
    await verifyAndKillWindows(1, { platform: "win32", env, execFile: exec, maxStartMs: 1 });
    await wslLiveness(1, D, { platform: "win32", env, execFile: exec });
    await verifyAndKillWsl(1, D, { platform: "win32", env, execFile: exec });
    const files = exec.mock.calls.map((c) => c[0]);
    expect(files).toEqual([PS, PS, WSL, WSL]);
    for (const c of exec.mock.calls) expect(c[2]).not.toHaveProperty("shell");
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "4242; calc", undefined, 4_294_967_296])(
    "E2: invalid pid %s → null before any interpolation",
    async (pid) => {
      const exec = fixed("1");
      for (const target of [{ kind: "host" }, { kind: "wsl", distro: D }] as ProcessTarget[]) {
        expect(await probeProcessStart(pid as number, target, { ...WIN, execFile: exec })).toBeNull();
      }
      expect(exec).not.toHaveBeenCalled();
    },
  );

  it.each([1, 4_294_967_295])("E2b: boundary pid %s is interpolated verbatim", async (pid) => {
    const exec = fixed("1700000000000");
    expect(await probeProcessStart(pid, { kind: "host" }, { ...WIN, execFile: exec })).toBe(1700000000000);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][1][3]).toContain(`-Id ${pid} `);
  });

  it.each(["", "\r\n", "abc", "1.7e12x", "-1"])("E5: unparsable stdout %j → null", async (out) => {
    expect(await probeProcessStart(4242, { kind: "host" }, { ...WIN, execFile: fixed(out) })).toBeNull();
  });

  it("E5: a rejected exec (exit 1) → null, never throws", async () => {
    const exec = fixed(Object.assign(new Error("exit 1"), { code: 1 }));
    expect(await probeProcessStart(4242, { kind: "host" }, { ...WIN, execFile: exec })).toBeNull();
  });

  it("X1: PowerShell blocked by policy → null (probe) / error (kill), no throw", async () => {
    const exec = fixed(Object.assign(new Error("This program is blocked by group policy"), { code: 1 }));
    expect(await probeProcessStart(4242, { kind: "host" }, { ...WIN, execFile: exec })).toBeNull();
    expect(await verifyAndKillWindows(4242, { ...WIN, execFile: exec, maxStartMs: 1 })).toBe("error");
  });

  it.each([
    [10_000, undefined],
    [500, 500],
  ])("E6: timeout boundary (%i ms)", async (ms, opt) => {
    vi.useFakeTimers();
    const m = manual();
    let r: number | null | undefined;
    const p = probeProcessStart(4242, { kind: "host" }, { ...WIN, execFile: m.fn, ...(opt ? { timeoutMs: opt } : {}) }).then(
      (v) => (r = v),
    );
    await vi.advanceTimersByTimeAsync(ms - 1);
    expect(r).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(r).toBeNull();
    expect(m.pending[0].signal.aborted).toBe(true);
  });
});

describe("probeProcessStart — POSIX host and invalid targets", () => {
  it.each(["linux", "darwin"] as const)("E7: %s delegates to processStartedAt, no PowerShell/wsl", async (platform) => {
    const exec = fixed("x");
    const sa = vi.fn().mockReturnValueOnce(1234).mockReturnValueOnce(null);
    expect(await probeProcessStart(4242, { kind: "host" }, { platform, execFile: exec, processStartedAt: sa })).toBe(1234);
    expect(await probeProcessStart(4242, { kind: "host" }, { platform, execFile: exec, processStartedAt: sa })).toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });

  it("E60 / W13: only the object target shape is valid; extra keys ignored", async () => {
    const exec = fixed("1700000000000");
    expect(await probeProcessStart(4242, "host" as never, { ...WIN, execFile: exec })).toBeNull();
    expect(await probeProcessStart(4242, { kind: "wsl" } as never, { ...WIN, execFile: exec })).toBeNull();
    expect(exec).not.toHaveBeenCalled();
    expect(await probeProcessStart(4242, { kind: "host", distro: "x" } as never, { ...WIN, execFile: exec })).toBe(
      1700000000000,
    );
    // @ts-expect-error a bare string is not a ProcessTarget
    const bare: ProcessTarget = "host";
    void bare;
  });
});

describe("probeProcessStart — WSL target", () => {
  it("E9: absolute wsl.exe, `-d D --exec sh -c <script>`, no Get-Process", async () => {
    const exec = fixed("100000 95000");
    await probeProcessStart(4242, { kind: "wsl", distro: D }, { ...WIN, execFile: exec });
    const [file, args] = exec.mock.calls[0];
    expect(file).toBe(WSL);
    expect(args.slice(0, 5)).toEqual(["-d", D, "--exec", "sh", "-c"]);
    expect(args[5]).toContain("/proc/4242/stat");
    expect(args[5]).not.toContain("Get-Process");
    expect(args[5]).not.toMatch(/["\\]/); // crosses the Windows command line
  });

  it.each([0, 30, -30, 300_000, -300_000])("E8: skew %i ms between clocks does not change the result", async (skew) => {
    const S = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(S);
    const W = S + skew;
    const exec = fixed(`${W} ${W - 5000}`);
    expect(await probeProcessStart(4242, { kind: "wsl", distro: D }, { ...WIN, execFile: exec })).toBe(S - 5000);
  });

  it.each(["", "123456", "abc def", "123 abc", "5 10"])("E10: malformed stdout %j → null", async (out) => {
    expect(await probeProcessStart(4242, { kind: "wsl", distro: D }, { ...WIN, execFile: fixed(out) })).toBeNull();
  });

  it("E10: exit 1 with `No such process` → null", async () => {
    const exec = fixed(Object.assign(new Error("No such process"), { code: 1 }));
    expect(await probeProcessStart(4242, { kind: "wsl", distro: D }, { ...WIN, execFile: exec })).toBeNull();
  });

  it.each(["", "-d", "--exec", "-x", "a b", "a;b", "a'b", 'a"b', "$(id)", "a\nb", "Ubuntü"])(
    "E3: distro %j is rejected before exec",
    async (distro) => {
      const exec = fixed("1 0");
      expect(await probeProcessStart(4242, { kind: "wsl", distro }, { ...WIN, execFile: exec })).toBeNull();
      expect(await wslLiveness(4242, distro, { ...WIN, execFile: exec })).toBe("unknown");
      expect(await verifyAndKillWsl(4242, distro, { ...WIN, execFile: exec })).toBe("error");
      expect(exec).not.toHaveBeenCalled();
    },
  );

  it.each([["a", true], ["a".repeat(64), true], ["Ubuntu-22.04", true], ["x.y_z-1", true], ["a".repeat(65), false]])(
    "E4: distro %j length/charset boundary",
    async (distro, ok) => {
      const exec = fixed("100 50");
      await probeProcessStart(4242, { kind: "wsl", distro }, { ...WIN, execFile: exec });
      expect(exec).toHaveBeenCalledTimes(ok ? 1 : 0);
      if (ok) expect(exec.mock.calls[0][1].slice(0, 4)).toEqual(["-d", distro, "--exec", "sh"]);
    },
  );
});

describe("verifyAndKillWindows", () => {
  it("E17: ONE invocation; handle pinned BEFORE the StartTime check, BEFORE taskkill", async () => {
    const T = 1_700_000_000_000;
    const exec = fixed("killed");
    const r = await verifyAndKillWindows(4242, { ...WIN, execFile: exec, maxStartMs: T + 2000, timeoutMs: 2000 });
    expect(r).toBe("killed");
    expect(exec).toHaveBeenCalledTimes(1);
    const script = exec.mock.calls[0][1][3];
    const pin = script.indexOf("$null = $p.Handle");
    const cmp = script.indexOf(String(T + 2000));
    const kill = script.indexOf("taskkill /F /T /PID 4242");
    expect(pin).toBeGreaterThan(-1);
    expect(pin).toBeLessThan(cmp);
    expect(cmp).toBeLessThan(kill);
  });

  it("X7: an access-denied text with exit 0 is `error`, with no retry inside", async () => {
    const exec = fixed("Access is denied");
    expect(await verifyAndKillWindows(4242, { ...WIN, execFile: exec, maxStartMs: 1 })).toBe("error");
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

describe("W6 validation and non-applicable environments", () => {
  it.each([0, -1, 1.5, Number.NaN])("E13: pid %s → error / unknown, nothing spawned", async (pid) => {
    const exec = fixed("killed");
    expect(await verifyAndKillWindows(pid, { ...WIN, execFile: exec, maxStartMs: 1 })).toBe("error");
    expect(await verifyAndKillWsl(pid, D, { ...WIN, execFile: exec })).toBe("error");
    expect(await wslLiveness(pid, D, { ...WIN, execFile: exec })).toBe("unknown");
    expect(exec).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])("E13: bound %s → error", async (bound) => {
    const exec = fixed("killed");
    expect(await verifyAndKillWindows(4242, { ...WIN, execFile: exec, maxStartMs: bound })).toBe("error");
    expect(await verifyAndKillWsl(4242, D, { ...WIN, execFile: exec, minAgeMs: bound })).toBe("error");
    expect(exec).not.toHaveBeenCalled();
  });

  it("E13: the boundary value 0 reaches exec once", async () => {
    const exec = fixed("killed");
    expect(await verifyAndKillWindows(4242, { ...WIN, execFile: exec, maxStartMs: 0 })).toBe("killed");
    expect(await verifyAndKillWsl(4242, D, { ...WIN, execFile: exec, minAgeMs: 0 })).toBe("killed");
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it.each(["linux", "darwin"] as const)("E13b: %s → error / unknown / null, nothing spawned", async (platform) => {
    const exec = fixed("killed");
    const o = { platform, env: WIN.env, execFile: exec };
    expect(await verifyAndKillWindows(4242, { ...o, maxStartMs: 1 })).toBe("error");
    expect(await verifyAndKillWsl(4242, D, o)).toBe("error");
    expect(await wslLiveness(4242, D, o)).toBe("unknown");
    expect(await probeProcessStart(4242, { kind: "wsl", distro: D }, o)).toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "Windows"])("E13c: SystemRoot=%j → no spawn, never a bare powershell.exe", async (root) => {
    const exec = fixed("killed");
    const env: NodeJS.ProcessEnv = root === undefined ? {} : { SystemRoot: root };
    const o = { platform: "win32" as const, env, execFile: exec };
    expect(await probeProcessStart(4242, { kind: "host" }, o)).toBeNull();
    expect(await verifyAndKillWindows(4242, { ...o, maxStartMs: 1 })).toBe("error");
    expect(await wslLiveness(4242, D, o)).toBe("unknown");
    expect(await verifyAndKillWsl(4242, D, o)).toBe("error");
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("W10 result grammar", () => {
  const killTable: Array<[string | Error, string]> = [
    ["killed", "killed"],
    ["mismatch", "mismatch"],
    ["absent", "absent"],
    [" killed \r\n", "killed"],
    ["", "error"],
    [Object.assign(new Error("exit 1"), { code: 1 }), "error"],
    ["Access is denied", "error"],
    ["unexpected", "error"],
  ];
  it.each(killTable)("E18: stdout %j → %s (windows and wsl)", async (out, expected) => {
    expect(await verifyAndKillWindows(4242, { ...WIN, execFile: fixed(out), maxStartMs: 1 })).toBe(expected);
    expect(await verifyAndKillWsl(4242, D, { ...WIN, execFile: fixed(out) })).toBe(expected);
  });

  it.each(["Windows PowerShell\nkilled", "killed killed", "killed\nabsent", "KILLED", "#< CLIXML\nkilled", "killed."])(
    "E18g: noise %j is never a marker",
    async (out) => {
      expect(await verifyAndKillWindows(4242, { ...WIN, execFile: fixed(out), maxStartMs: 1 })).toBe("error");
      expect(await verifyAndKillWsl(4242, D, { ...WIN, execFile: fixed(out) })).toBe("error");
      expect(await wslLiveness(4242, D, { ...WIN, execFile: fixed(out) })).toBe("unknown");
    },
  );

  it("wslLiveness maps alive / absent exactly, anything else unknown", async () => {
    expect(await wslLiveness(4242, D, { ...WIN, execFile: fixed("alive\n") })).toBe("alive");
    expect(await wslLiveness(4242, D, { ...WIN, execFile: fixed("absent\n") })).toBe("absent");
    expect(await wslLiveness(4242, D, { ...WIN, execFile: fixed("unknown") })).toBe("unknown");
    expect(await wslLiveness(4242, D, { ...WIN, execFile: fixed("") })).toBe("unknown");
    expect(await wslLiveness(4242, D, { ...WIN, execFile: fixed(new Error("boom")) })).toBe("unknown");
  });
});

describe("verifyAndKillWsl script shape", () => {
  it("E21: never uses taskkill; minAgeMs only when given", async () => {
    const exec = fixed("killed");
    await verifyAndKillWsl(4242, D, { ...WIN, execFile: exec, timeoutMs: 2000 });
    await verifyAndKillWsl(4242, D, { ...WIN, execFile: exec, timeoutMs: 2000, minAgeMs: 8000 });
    const [a, b] = exec.mock.calls.map((c) => c[1][5]);
    for (const s of [a, b]) {
      expect(s).not.toContain("taskkill");
      expect(s).toContain("LC_ALL=C");
      expect(s).not.toMatch(/\bps\b/); // W8: no ps dependency
    }
    expect(a).not.toContain("age_ms");
    expect(b).toContain("-ge 8000");
    expect(exec.mock.calls[0][0]).toBe(WSL);
  });
});

describe("limiter (W5) and timeouts (W12)", () => {
  it.each([1, 2, 3, 10])("E14: at most 2 in flight with %i concurrent probes", async (n) => {
    const m = manual();
    const ps = Array.from({ length: n }, () => probeProcessStart(4242, { kind: "host" }, { ...WIN, execFile: m.fn }));
    await vi.waitFor(() => expect(m.pending.length).toBe(Math.min(n, 2)));
    let done = 0;
    while (done < n) {
      m.pending[done].settle("1700000000000");
      done++;
      await vi.waitFor(() => expect(m.pending.length).toBe(Math.min(n, done + 2)));
    }
    await Promise.all(ps);
    expect(m.peak()).toBe(Math.min(n, 2));
  });

  it("E14b: all four helpers share the two slots, FIFO", async () => {
    const m = manual();
    const o = { ...WIN, execFile: m.fn };
    const ps = [
      probeProcessStart(4242, { kind: "host" }, o),
      verifyAndKillWindows(4242, { ...o, maxStartMs: 1 }),
      wslLiveness(4242, D, o),
      verifyAndKillWsl(4242, D, o),
    ];
    await vi.waitFor(() => expect(m.pending.length).toBe(2));
    expect(m.peak()).toBe(2);
    m.pending[0].settle("1");
    await vi.waitFor(() => expect(m.pending.length).toBe(3));
    expect(m.pending[2].file).toBe(WSL);
    expect(m.pending[2].args[5]).toContain("kill -0"); // 3rd issued = wslLiveness
    m.pending[1].settle("killed");
    await vi.waitFor(() => expect(m.pending.length).toBe(4));
    expect(m.pending[3].args[5]).toContain("kill -TERM"); // 4th = verifyAndKillWsl
    m.pending[2].settle("alive");
    m.pending[3].settle("killed");
    await Promise.all(ps);
    expect(m.peak()).toBe(2);
  });

  it("E15: slot released on rejection and on timeout", async () => {
    vi.useFakeTimers();
    const m = manual();
    const hang = () => probeProcessStart(4242, { kind: "host" }, { ...WIN, execFile: m.fn });
    const a = hang();
    const b = hang();
    const c = probeProcessStart(4242, { kind: "host" }, { ...WIN, execFile: fixed(new Error("x")) });
    await vi.advanceTimersByTimeAsync(0);
    expect(await Promise.race([c, Promise.resolve("queued")])).toBe("queued");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await Promise.all([a, b, c])).toEqual([null, null, null]);
    // everything released: the next probe starts immediately
    const exec = fixed("1700000000000");
    await expect(probeProcessStart(4242, { kind: "host" }, { ...WIN, execFile: exec })).resolves.toBe(1700000000000);
  });

  it("E16: POSIX host probes bypass the limiter", async () => {
    vi.useFakeTimers();
    const m = manual();
    const hung = [1, 2].map(() => probeProcessStart(4242, { kind: "host" }, { ...WIN, execFile: m.fn }));
    await vi.advanceTimersByTimeAsync(0);
    const posix = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        probeProcessStart(i, { kind: "host" }, { platform: "linux", processStartedAt: async () => 7 }),
      ),
    );
    expect(posix).toEqual([7, 7, 7, 7, 7]);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all(hung);
  });

  it("E24b/X2: verify-and-kill wrapper timeout is timeoutMs + 10 s, then `error`", async () => {
    vi.useFakeTimers();
    for (const run of [
      (execFile: ProcessControlExecFn) => verifyAndKillWindows(4242, { ...WIN, execFile, maxStartMs: 1, timeoutMs: 2000 }),
      (execFile: ProcessControlExecFn) => verifyAndKillWsl(4242, D, { ...WIN, execFile, timeoutMs: 2000 }),
    ]) {
      const m = manual();
      let r: string | undefined;
      const p = run(m.fn).then((v) => (r = v));
      await vi.advanceTimersByTimeAsync(11_999);
      expect(r).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(r).toBe("error");
      expect(m.pending[0].signal.aborted).toBe(true);
    }
  });

  it("X2: a wedged wsl.exe gives unknown at 10 s, never absent", async () => {
    vi.useFakeTimers();
    const m = manual();
    let r: string | undefined;
    const p = wslLiveness(4242, D, { ...WIN, execFile: m.fn }).then((v) => (r = v));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(r).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(r).toBe("unknown");
  });

  it("P2: 10 probes of 100 ms finish in 5 waves (500 ms), peak 2", async () => {
    vi.useFakeTimers();
    let live = 0;
    let peak = 0;
    const exec: ProcessControlExecFn = () =>
      new Promise((resolve) => {
        live++;
        peak = Math.max(peak, live);
        setTimeout(() => {
          live--;
          resolve("1700000000000");
        }, 100);
      });
    const t0 = Date.now();
    let lastAt = -1;
    const ps = Array.from({ length: 10 }, () =>
      probeProcessStart(4242, { kind: "host" }, { ...WIN, execFile: exec }).then(() => (lastAt = Math.max(lastAt, Date.now() - t0))),
    );
    await vi.advanceTimersByTimeAsync(499);
    expect(lastAt).toBe(400);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all(ps);
    expect(lastAt).toBe(500);
    expect(peak).toBe(2);
  });

  it("P3: 6 wedged probes resolve null in waves of 2 at 10 s, 20 s, 30 s", async () => {
    vi.useFakeTimers();
    const m = manual();
    const at: number[] = [];
    const t0 = Date.now();
    const ps = Array.from({ length: 6 }, () =>
      probeProcessStart(4242, { kind: "host" }, { ...WIN, execFile: m.fn }).then((v) => {
        expect(v).toBeNull();
        at.push(Date.now() - t0);
      }),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.all(ps);
    expect(at).toEqual([10_000, 10_000, 20_000, 20_000, 30_000, 30_000]);
    expect(m.live()).toBe(0);
  });

  it("P3b: queue wait is excluded from the timeout — a queued kill is not starved", async () => {
    vi.useFakeTimers();
    const m = manual();
    const hung = [1, 2].map(() => probeProcessStart(4242, { kind: "host" }, { ...WIN, execFile: m.fn }));
    const exec2: ProcessControlExecFn = () =>
      new Promise((resolve) => setTimeout(() => resolve("killed"), 1000));
    const kill = verifyAndKillWsl(4242, D, { ...WIN, execFile: exec2, timeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(10_000); // both slots free only now
    await Promise.all(hung);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(kill).resolves.toBe("killed");
  });

  it("P4: 50 timed-out probes abort 50 children", async () => {
    vi.useFakeTimers();
    const m = manual();
    for (let i = 0; i < 50; i++) {
      const p = probeProcessStart(4242, { kind: "host" }, { ...WIN, execFile: m.fn, timeoutMs: 100 });
      await vi.advanceTimersByTimeAsync(100);
      await p;
    }
    expect(m.pending.filter((p) => p.signal.aborted)).toHaveLength(50);
    expect(m.live()).toBe(0);
  });
});
