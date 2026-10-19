/**
 * DedicatedChrome — process supervision (tasks 2.1–2.4; test-plan #E4 #E5 #E6
 * #R3 #R4 #R5 #R6 #R9 #R10). Real fs in a temp HOME; fake spawn / pipe / process
 * listing / kill. See change: add-dedicated-agent-browser.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildChromeArgs,
  CHROME_INTERNAL_ID_BASE,
  CHROME_STDIO,
  type ChromeExitInfo,
  DedicatedChrome,
  type DedicatedChromeDeps,
  type DedicatedChromeError,
  mergeSeededPreferences,
} from "../chrome-process.js";
import { encodeFrame } from "../pipe-framing.js";
import type { ProcessInfo } from "../process-identity.js";
import { type FakeChromeBehavior, FakeChromeChild } from "./fake-chrome.js";

const SELF_PID = 4242;
const BINARY = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

interface Harness {
  chrome: DedicatedChrome;
  home: string;
  dataDir: string;
  downloadsDir: string;
  children: FakeChromeChild[];
  spawn: ReturnType<typeof vi.fn>;
  killProcessGroup: ReturnType<typeof vi.fn>;
  listProcesses: ReturnType<typeof vi.fn>;
  clock: { t: number };
}

let tmpHomes: string[] = [];

function harness(
  over: Partial<DedicatedChromeDeps> & { behavior?: FakeChromeBehavior; list?: () => ProcessInfo[] } = {},
): Harness {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dedicated-chrome-"));
  tmpHomes.push(home);
  const configDir = path.join(home, ".pi", "dashboard");
  const children: FakeChromeChild[] = [];
  let nextPid = 7000;
  const spawn = vi.fn(() => {
    const c = new FakeChromeChild(nextPid++, over.behavior);
    children.push(c);
    return c;
  });
  const killProcessGroup = vi.fn(async () => ({ ok: true, forced: false }));
  const listProcesses = vi.fn(async () => (over.list ? over.list() : []));
  const clock = { t: 1_000_000 };
  const { behavior: _b, list: _l, ...deps } = over;
  const chrome = new DedicatedChrome({
    resolveBinary: () => BINARY,
    spawn,
    now: () => clock.t,
    listProcesses,
    killProcessGroup,
    isProcessAlive: () => false,
    processStartedAt: () => null,
    getDashboardConfigDir: () => configDir,
    selfPid: SELF_PID,
    ...deps,
  });
  return {
    chrome,
    home,
    dataDir: chrome.dataDir,
    downloadsDir: chrome.downloadsDir,
    children,
    spawn,
    killProcessGroup,
    listProcesses,
    clock,
  };
}

afterEach(() => {
  vi.useRealTimers();
  for (const h of tmpHomes) fs.rmSync(h, { recursive: true, force: true });
  tmpHomes = [];
});

function duSync(dir: string): number {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? duSync(p) : fs.lstatSync(p).size;
  }
  return n;
}

const posix = process.platform !== "win32";

// ── #E4 argv + stdio ────────────────────────────────────────────────────────
describe("launch argv and stdio (#E4)", () => {
  it("buildChromeArgs carries the pipe + data dir and none of the forbidden switches", () => {
    const args = buildChromeArgs("/d/agent-chrome");
    expect(args).toContain("--user-data-dir=/d/agent-chrome");
    expect(args).toContain("--remote-debugging-pipe");
    expect(args).toContain("--disable-sync");
    expect(args).toContain("--no-first-run");
    expect(args).toContain("--no-default-browser-check");
    expect(args.at(-1)).toBe("about:blank");
    for (const forbidden of ["--remote-debugging-port", "--enable-automation", "--headless"]) {
      expect(args.some((a) => a.startsWith(forbidden))).toBe(false);
    }
  });

  it.each(["darwin", "linux", "win32"] as const)("spawns with the pipe argv and stdio layout on %s", async (platform) => {
    const h = harness({ platform });
    await h.chrome.ensureRunning();
    expect(h.spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = h.spawn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
    expect(cmd).toBe(BINARY);
    expect(args).toEqual(buildChromeArgs(h.dataDir));
    expect(args).toContain(`--user-data-dir=${h.dataDir}`);
    expect(opts.stdio).toEqual(["ignore", "ignore", "ignore", "pipe", "pipe"]);
    expect(opts.stdio).toBe(CHROME_STDIO);
    // Own process group on POSIX (so killProcessGroup reaches helpers); win32 has none.
    expect(opts.detached).toBe(platform !== "win32");
    expect(opts.windowsHide).toBe(false);
  });

  it("dataDir/downloadsDir live under the dashboard config dir", () => {
    const h = harness();
    expect(h.dataDir).toBe(path.join(h.home, ".pi", "dashboard", "agent-chrome"));
    expect(h.downloadsDir).toBe(path.join(h.home, ".pi", "dashboard", "agent-chrome-downloads"));
  });
});

// ── #E5 preferences ─────────────────────────────────────────────────────────
describe("Preferences seeding (#E5)", () => {
  const prefsPath = (h: Harness) => path.join(h.dataDir, "Default", "Preferences");

  it("merges the four keys into an existing file and keeps unrelated keys", async () => {
    const h = harness();
    fs.mkdirSync(path.join(h.dataDir, "Default"), { recursive: true });
    fs.writeFileSync(
      prefsPath(h),
      JSON.stringify({
        homepage: "https://example.com",
        profile: { name: "Agent", password_manager_enabled: true },
        signin: { allowed: true, other: 1 },
        autofill: { credit_card_enabled: true },
      }),
    );
    await h.chrome.ensureRunning();
    const prefs = JSON.parse(fs.readFileSync(prefsPath(h), "utf8"));
    expect(prefs.homepage).toBe("https://example.com");
    expect(prefs.credentials_enable_service).toBe(false);
    expect(prefs.profile).toEqual({ name: "Agent", password_manager_enabled: false });
    expect(prefs.signin).toEqual({ allowed: false, other: 1 });
    expect(prefs.autofill).toEqual({ credit_card_enabled: true, profile_enabled: false });
  });

  it("creates the file when absent, before Chrome is spawned", async () => {
    const h = harness();
    h.spawn.mockImplementationOnce(() => {
      // seeded already at spawn time
      expect(JSON.parse(fs.readFileSync(prefsPath(h), "utf8")).credentials_enable_service).toBe(false);
      const c = new FakeChromeChild(1);
      h.children.push(c);
      return c;
    });
    await h.chrome.ensureRunning();
    expect(JSON.parse(fs.readFileSync(prefsPath(h), "utf8"))).toEqual({
      credentials_enable_service: false,
      profile: { password_manager_enabled: false },
      signin: { allowed: false },
      autofill: { profile_enabled: false },
    });
  });

  it("replaces a corrupt file and non-object parents instead of throwing", async () => {
    const h = harness();
    fs.mkdirSync(path.join(h.dataDir, "Default"), { recursive: true });
    fs.writeFileSync(prefsPath(h), "{not json");
    await h.chrome.ensureRunning();
    expect(JSON.parse(fs.readFileSync(prefsPath(h), "utf8")).signin).toEqual({ allowed: false });
    expect(mergeSeededPreferences({ profile: "oops", signin: [] }).profile).toEqual({ password_manager_enabled: false });
  });
});

// ── #E6 modes ───────────────────────────────────────────────────────────────
describe.skipIf(!posix)("directory + owner record modes (#E6)", () => {
  const mode = (p: string) => fs.statSync(p).mode & 0o777;

  it("creates the dir 0700 and the owner record 0600 on first launch", async () => {
    const h = harness();
    expect(h.chrome.state()).toBe("not-created");
    await h.chrome.ensureRunning();
    expect(mode(h.dataDir)).toBe(0o700);
    expect(mode(h.downloadsDir)).toBe(0o700);
    const ownerFile = path.join(h.dataDir, ".dashboard-owner.json");
    expect(mode(ownerFile)).toBe(0o600);
    const rec = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
    expect(rec.serverPid).toBe(SELF_PID);
    expect(typeof rec.serverCmd).toBe("string");
    expect(fs.readdirSync(h.dataDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("tightens a pre-existing wider dir", async () => {
    const h = harness();
    fs.mkdirSync(h.dataDir, { recursive: true, mode: 0o755 });
    fs.chmodSync(h.dataDir, 0o755);
    await h.chrome.ensureRunning();
    expect(mode(h.dataDir)).toBe(0o700);
  });
});

// ── #R3 single flight ───────────────────────────────────────────────────────
describe("single-flight launch (#R3)", () => {
  it("connect + open fired together spawn one Chrome and resolve against it", async () => {
    vi.useFakeTimers();
    const h = harness({ behavior: { versionDelayMs: 200 } });
    const connect = h.chrome.ensureRunning();
    const open = h.chrome.ensureRunning();
    expect(h.chrome.state()).toBe("starting");
    await vi.advanceTimersByTimeAsync(199);
    expect(h.chrome.state()).toBe("starting");
    await vi.advanceTimersByTimeAsync(1);
    await expect(Promise.all([connect, open])).resolves.toBeDefined();
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(h.chrome.state()).toBe("running");
    await h.chrome.ensureRunning(); // already running: no second spawn
    expect(h.spawn).toHaveBeenCalledTimes(1);
  });

  it("concurrent callers share the same failure and the promise is cleared", async () => {
    const h = harness({ resolveBinary: () => null });
    const results = await Promise.allSettled([h.chrome.ensureRunning(), h.chrome.ensureRunning()]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect((results[0] as PromiseRejectedResult).reason).toBe((results[1] as PromiseRejectedResult).reason);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("a synchronous spawn failure is launch-failed and a retry is possible", async () => {
    const h = harness();
    h.spawn.mockImplementationOnce(() => {
      throw new Error("EACCES");
    });
    await expect(h.chrome.ensureRunning()).rejects.toMatchObject({ code: "launch-failed" });
    await expect(h.chrome.ensureRunning()).resolves.toBeUndefined();
  });
});

// ── #R4 launch failure ──────────────────────────────────────────────────────
describe("launch failure (#R4)", () => {
  const FOREIGN = (dir: string): ProcessInfo => ({ pid: 999, args: `${BINARY} --user-data-dir=${dir}` });

  it("(a) exits before replying after handing off to a running foreign instance → profile-in-use", async () => {
    let spawned = false;
    const h = harness({ list: () => (spawned ? [FOREIGN(h.dataDir)] : []) });
    h.spawn.mockImplementation(() => {
      spawned = true;
      const c = new FakeChromeChild(7100, { silent: true });
      queueMicrotask(() => c.exit(0));
      h.children.push(c);
      return c;
    });
    await expect(h.chrome.ensureRunning()).rejects.toMatchObject({ code: "profile-in-use", name: "DedicatedChromeError" });
    expect(h.chrome.state()).not.toBe("starting");
    expect(h.killProcessGroup).not.toHaveBeenCalled();
  });

  it("(b) exits with code 1 → launch-failed; the next call launches again", async () => {
    const h = harness();
    h.spawn.mockImplementationOnce(() => {
      const c = new FakeChromeChild(7200, { silent: true });
      queueMicrotask(() => c.exit(1));
      h.children.push(c);
      return c;
    });
    await expect(h.chrome.ensureRunning()).rejects.toMatchObject({ code: "launch-failed" });
    expect(fs.existsSync(path.join(h.dataDir, ".dashboard-owner.json"))).toBe(false);
    await h.chrome.ensureRunning();
    expect(h.spawn).toHaveBeenCalledTimes(2);
    expect(h.chrome.state()).toBe("running");
  });

  it("(c) never replies → launch-failed at 15 s with a group kill; then launches again", async () => {
    vi.useFakeTimers();
    const h = harness({ behavior: { silent: true } });
    const p = h.chrome.ensureRunning();
    const settled = p.then(
      () => "ok",
      (e: DedicatedChromeError) => e.code,
    );
    await vi.advanceTimersByTimeAsync(14_999);
    expect(h.killProcessGroup).not.toHaveBeenCalled();
    expect(h.chrome.state()).toBe("starting");
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled).toBe("launch-failed");
    expect(h.killProcessGroup).toHaveBeenCalledWith(7000);
    expect(h.chrome.state()).toBe("stopped");
    expect(fs.existsSync(path.join(h.dataDir, ".dashboard-owner.json"))).toBe(false);
    // not a crash: the failed launch is an expected exit
    const second = h.chrome.ensureRunning();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.spawn).toHaveBeenCalledTimes(2);
    second.catch(() => {});
  });

  it("a failed Browser.setDownloadBehavior fails the launch and kills the group", async () => {
    const h = harness({ behavior: { failDownloads: true } });
    await expect(h.chrome.ensureRunning()).rejects.toMatchObject({ code: "launch-failed" });
    expect(h.killProcessGroup).toHaveBeenCalledWith(7000);
    expect(h.chrome.state()).toBe("stopped");
  });

  it("reports no Chrome binary as launch-failed without spawning", async () => {
    const h = harness({ resolveBinary: () => null });
    await expect(h.chrome.ensureRunning()).rejects.toMatchObject({ code: "launch-failed" });
    expect(h.spawn).not.toHaveBeenCalled();
  });
});

// ── #R5 ownership decision table, #R6 identity ──────────────────────────────
describe.each(["darwin", "win32"] as const)("ownership + identity decisions on %s listings (#R5, #R6)", (platform) => {
  const dedicatedLine = (dir: string, pid = 500): ProcessInfo =>
    platform === "win32"
      ? {
          pid,
          // win32 listings quote the path and may differ in case
          args: `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir="${dir.toUpperCase()}" --remote-debugging-pipe --disable-sync --no-first-run about:blank`,
        }
      : { pid, args: `${BINARY} --user-data-dir=${dir} --remote-debugging-pipe --disable-sync --no-first-run --no-default-browser-check about:blank` };
  const helperLine = (dir: string): ProcessInfo => ({ pid: 501, args: `${BINARY} Helper --type=renderer --user-data-dir=${dir} --remote-debugging-pipe` });
  const foreignLine = (dir: string, pid = 600): ProcessInfo =>
    platform === "win32"
      ? { pid, args: `"C:\\chrome.exe" --user-data-dir="${dir}"` }
      : { pid, args: `${BINARY} --profile-directory=Default --user-data-dir=${dir}` };
  const OWNER_STARTED = 1_700_000_000_000;
  const OWNER_CMD = "node /srv/pi-dashboard/server.js --port 8000";

  function setup(opts: {
    listing: (dir: string) => ProcessInfo[];
    ownerRecord?: { serverPid: number; serverStartedAt: number | null; serverCmd: string };
    ownerAlive?: boolean;
    ownerStartedNow?: number | null;
    afterKill?: (h: Harness) => void;
  }): Harness {
    const killed: number[] = [];
    const h: Harness = harness({
      platform,
      list: () => opts.listing(h.dataDir).filter((p) => !killed.includes(p.pid)),
      isProcessAlive: (pid) => pid === opts.ownerRecord?.serverPid && opts.ownerAlive === true,
      processStartedAt: () => opts.ownerStartedNow ?? null,
    });
    // the dir exists (a Chrome ran there before)
    fs.mkdirSync(h.dataDir, { recursive: true });
    if (opts.ownerRecord) {
      fs.writeFileSync(path.join(h.dataDir, ".dashboard-owner.json"), JSON.stringify(opts.ownerRecord));
    }
    h.killProcessGroup.mockImplementation(async (pid: number) => {
      killed.push(pid);
      return { ok: true, forced: false };
    });
    return h;
  }

  const otherServer = platform === "win32"
    ? { serverPid: 31337, serverStartedAt: null, serverCmd: OWNER_CMD }
    : { serverPid: 31337, serverStartedAt: OWNER_STARTED, serverCmd: OWNER_CMD };

  it("(y,y,n) owner server alive → owned-by-other-server, nothing killed, nothing spawned", async () => {
    const h = setup({
      listing: (dir) => [dedicatedLine(dir), helperLine(dir), { pid: 31337, args: OWNER_CMD }],
      ownerRecord: otherServer,
      ownerAlive: true,
      ownerStartedNow: platform === "win32" ? null : OWNER_STARTED + 400,
    });
    await expect(h.chrome.ensureRunning()).rejects.toMatchObject({ code: "owned-by-other-server" });
    expect(h.killProcessGroup).not.toHaveBeenCalled();
    expect(h.spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(h.dataDir, ".dashboard-owner.json"))).toBe(true); // theirs, kept
  });

  it("(y,n,n) owner dead → kill the dedicated Chrome by identity, then launch", async () => {
    const h = setup({ listing: (dir) => [dedicatedLine(dir), helperLine(dir)], ownerRecord: otherServer, ownerAlive: false });
    const order: string[] = [];
    h.killProcessGroup.mockImplementation(async (pid: number) => {
      order.push(`kill:${pid}`);
      return { ok: true, forced: false };
    });
    h.spawn.mockImplementation(() => {
      order.push("spawn");
      const c = new FakeChromeChild(7500);
      h.children.push(c);
      return c;
    });
    await h.chrome.ensureRunning();
    expect(order).toEqual(["kill:500", "spawn"]); // the renderer helper is never targeted
    expect(h.chrome.state()).toBe("running");
  });

  it("(y, no record) → orphan: killed by identity, then launch", async () => {
    const h = setup({ listing: (dir) => [dedicatedLine(dir)] });
    await h.chrome.ensureRunning();
    expect(h.killProcessGroup).toHaveBeenCalledWith(500);
    expect(h.spawn).toHaveBeenCalledTimes(1);
  });

  it("owner pid alive but reused (start time differs / command line differs) → treated as dead", async () => {
    const h = setup({
      listing: (dir) => [dedicatedLine(dir), { pid: 31337, args: "/usr/bin/some-unrelated-daemon" }],
      ownerRecord: otherServer,
      ownerAlive: true,
      ownerStartedNow: platform === "win32" ? null : OWNER_STARTED + 3_600_000,
    });
    await h.chrome.ensureRunning();
    expect(h.killProcessGroup).toHaveBeenCalledWith(500);
  });

  it("owner record naming this very process (plugin reload) → orphan to us: kill + relaunch", async () => {
    const h = setup({
      listing: (dir) => [dedicatedLine(dir)],
      ownerRecord: { serverPid: SELF_PID, serverStartedAt: null, serverCmd: "x" },
      ownerAlive: true,
    });
    await h.chrome.ensureRunning();
    expect(h.killProcessGroup).toHaveBeenCalledWith(500);
    expect(h.spawn).toHaveBeenCalledTimes(1);
  });

  it("(n,·,y) foreign Chrome without the pipe flag → profile-in-use, no kill, no spawn", async () => {
    const h = setup({ listing: (dir) => [foreignLine(dir)] });
    await expect(h.chrome.ensureRunning()).rejects.toMatchObject({ code: "profile-in-use" });
    expect(h.killProcessGroup).not.toHaveBeenCalled();
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("(n,·,n) nothing on the directory → launch", async () => {
    const h = setup({
      listing: (dir) => [{ pid: 700, args: `${BINARY} --user-data-dir=${path.join(path.dirname(dir), "other-profile")}` }],
    });
    await h.chrome.ensureRunning();
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(h.killProcessGroup).not.toHaveBeenCalled();
  });

  it("#R6 pid reused by an unrelated process between listing and kill → no kill is issued", async () => {
    let call = 0;
    const h = setup({
      listing: (dir) => {
        call++;
        return call === 1 ? [dedicatedLine(dir, 500)] : [{ pid: 500, args: "/usr/bin/vim notes.txt" }];
      },
    });
    await h.chrome.ensureRunning();
    expect(h.killProcessGroup).not.toHaveBeenCalled();
    expect(h.spawn).toHaveBeenCalledTimes(1);
  });

  it("#R6 command lines lacking the dedicated flags are never killed", async () => {
    const h = setup({
      listing: (dir) => [
        { pid: 800, args: `/usr/bin/some-tool --remote-debugging-pipe` }, // pipe, no dir
        { pid: 801, args: `${BINARY} --remote-debugging-pipe --user-data-dir=${path.join(path.dirname(dir), "agent-chrome-downloads")}` }, // sibling dir
        { pid: 802, args: `${BINARY} --remote-debugging-pipe --user-data-dir=${dir}-2` }, // prefix only
      ],
    });
    await h.chrome.ensureRunning();
    expect(h.killProcessGroup).not.toHaveBeenCalled();
  });
});

// ── #R9 unexpected exit ─────────────────────────────────────────────────────
describe("unexpected exit (#R9)", () => {
  it("pipe EOF + exit → exit event (unexpected), owner record removed, state stopped, next ensureRunning respawns", async () => {
    const h = harness();
    await h.chrome.ensureRunning();
    const exits: ChromeExitInfo[] = [];
    h.chrome.onExit((i) => exits.push(i));
    const ownerFile = path.join(h.dataDir, ".dashboard-owner.json");
    expect(fs.existsSync(ownerFile)).toBe(true);

    h.children[0].exit(0);

    expect(exits).toEqual([{ code: 0, signal: null, expected: false, reason: "exit" }]);
    expect(h.chrome.state()).toBe("stopped");
    expect(fs.existsSync(ownerFile)).toBe(false);
    expect(() => h.chrome.send({ id: 1, method: "Target.getTargets" })).toThrowError(expect.objectContaining({ code: "not-running" }));

    await h.chrome.ensureRunning();
    expect(h.spawn).toHaveBeenCalledTimes(2);
    expect(h.chrome.state()).toBe("running");
    expect(exits).toHaveLength(1); // the second EOF/exit of the dead child is not re-reported
  });

  it("exit reported once even when the dead child fires exit after EOF handling", async () => {
    const h = harness();
    await h.chrome.ensureRunning();
    const exits: ChromeExitInfo[] = [];
    h.chrome.onExit((i) => exits.push(i));
    h.children[0].exit(137, null);
    h.children[0].emit("exit", 137, null);
    expect(exits).toHaveLength(1);
  });

  it("pipe EOF with the process still alive waits 2 s for the exit, then group-kills and reports pipe-eof", async () => {
    vi.useFakeTimers();
    const h = harness();
    const ready = h.chrome.ensureRunning();
    await vi.advanceTimersByTimeAsync(0);
    await ready;
    const exits: ChromeExitInfo[] = [];
    h.chrome.onExit((i) => exits.push(i));
    h.children[0].eof();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(exits).toEqual([]);
    expect(h.killProcessGroup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.killProcessGroup).toHaveBeenCalledWith(7000);
    expect(exits).toEqual([{ code: null, signal: null, expected: false, reason: "pipe-eof" }]);
    expect(h.chrome.state()).toBe("stopped");
  });

  it("a Chrome that exits on its own after EOF inside the grace window is not group-killed", async () => {
    vi.useFakeTimers();
    const h = harness();
    const ready = h.chrome.ensureRunning();
    await vi.advanceTimersByTimeAsync(0);
    await ready;
    h.children[0].eof();
    await vi.advanceTimersByTimeAsync(500);
    h.children[0].emit("exit", 0, null);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.killProcessGroup).not.toHaveBeenCalled();
  });

  it("caches are invalidated when Chrome exits", async () => {
    const h = harness();
    await h.chrome.ensureRunning();
    fs.writeFileSync(path.join(h.dataDir, "a.bin"), Buffer.alloc(100));
    const first = await h.chrome.sizeBytes();
    fs.writeFileSync(path.join(h.dataDir, "b.bin"), Buffer.alloc(50));
    expect(await h.chrome.sizeBytes()).toBe(first); // cached
    h.children[0].exit(0);
    expect(await h.chrome.sizeBytes()).toBe(duSync(h.dataDir)); // fresh walk: exit dropped the owner record too
    expect(await h.chrome.sizeBytes()).not.toBe(first);
  });
});

// ── #R10 graceful shutdown ──────────────────────────────────────────────────
describe("graceful shutdown (#R10)", () => {
  it("Chrome ignoring Browser.close → killProcessGroup at 5 s, not before", async () => {
    vi.useFakeTimers();
    const h = harness({ behavior: { ignoreClose: true } });
    const ready = h.chrome.ensureRunning();
    await vi.advanceTimersByTimeAsync(0);
    await ready;
    const exits: ChromeExitInfo[] = [];
    h.chrome.onExit((i) => exits.push(i));

    let stopped = false;
    const stop = h.chrome.stop().then(() => {
      stopped = true;
    });
    expect(h.children[0].methods()).toContain("Browser.close");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(h.killProcessGroup).not.toHaveBeenCalled();
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stop;
    expect(h.killProcessGroup).toHaveBeenCalledTimes(1);
    expect(h.killProcessGroup).toHaveBeenCalledWith(7000);
    expect(h.chrome.state()).toBe("stopped");
    expect(exits).toEqual([{ code: null, signal: null, expected: true, reason: "killed" }]);
    expect(fs.existsSync(path.join(h.dataDir, ".dashboard-owner.json"))).toBe(false);
  });

  it("Chrome honouring Browser.close exits gracefully: no kill, event expected, owner record cleared", async () => {
    const h = harness();
    await h.chrome.ensureRunning();
    const exits: ChromeExitInfo[] = [];
    h.chrome.onExit((i) => exits.push(i));
    await h.chrome.stop();
    expect(h.killProcessGroup).not.toHaveBeenCalled();
    expect(exits).toEqual([{ code: 0, signal: null, expected: true, reason: "exit" }]);
    expect(h.chrome.state()).toBe("stopped");
    expect(fs.existsSync(path.join(h.dataDir, ".dashboard-owner.json"))).toBe(false);
  });

  it("stop() when nothing runs is a no-op; concurrent stops share one shutdown", async () => {
    const h = harness();
    await expect(h.chrome.stop()).resolves.toBeUndefined();
    await h.chrome.ensureRunning();
    const [a, b] = [h.chrome.stop(), h.chrome.stop()];
    expect(a).toBe(b);
    await a;
    expect(h.children[0].methods().filter((m) => m === "Browser.close")).toHaveLength(1);
  });

  it("stop() during a launch aborts it (launch-failed) and leaves Chrome down", async () => {
    vi.useFakeTimers();
    const h = harness({ behavior: { versionDelayMs: 200 } });
    const launch = h.chrome.ensureRunning();
    const outcome = launch.then(
      () => "ok",
      (e: DedicatedChromeError) => e.code,
    );
    await vi.advanceTimersByTimeAsync(10); // Chrome is spawned, still waiting for Browser.getVersion
    const stop = h.chrome.stop();
    await vi.advanceTimersByTimeAsync(300);
    await stop;
    expect(await outcome).toBe("launch-failed");
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(h.chrome.state()).toBe("stopped");
    // and a fresh connect launches again
    const again = h.chrome.ensureRunning();
    await vi.advanceTimersByTimeAsync(300);
    await again;
    expect(h.spawn).toHaveBeenCalledTimes(2);
  });

  it("stop() before Chrome is even spawned aborts the launch without spawning", async () => {
    const h = harness();
    const launch = h.chrome.ensureRunning();
    const outcome = launch.then(
      () => "ok",
      (e: DedicatedChromeError) => e.code,
    );
    await h.chrome.stop();
    expect(await outcome).toBe("launch-failed");
    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.chrome.state()).not.toBe("starting");
    await h.chrome.ensureRunning();
    expect(h.spawn).toHaveBeenCalledTimes(1);
  });

  it("ensureRunning during a shutdown waits for it, then launches a fresh Chrome", async () => {
    vi.useFakeTimers();
    const h = harness({ behavior: { ignoreClose: true } });
    const ready = h.chrome.ensureRunning();
    await vi.advanceTimersByTimeAsync(0);
    await ready;
    const stop = h.chrome.stop();
    const next = h.chrome.ensureRunning();
    expect(h.spawn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    await stop;
    await vi.advanceTimersByTimeAsync(0);
    await next;
    expect(h.spawn).toHaveBeenCalledTimes(2);
  });
});

// ── Downloads, pipe I/O ─────────────────────────────────────────────────────
describe("server-set downloads and pipe I/O", () => {
  it("sets the download dir itself right after Browser.getVersion, before ensureRunning resolves", async () => {
    const h = harness();
    await h.chrome.ensureRunning();
    const [version, downloads] = h.children[0].written;
    expect(version.method).toBe("Browser.getVersion");
    expect(downloads.method).toBe("Browser.setDownloadBehavior");
    expect(downloads.params).toEqual({ behavior: "allow", downloadPath: h.downloadsDir });
    expect(downloads.id).toBeGreaterThanOrEqual(CHROME_INTERNAL_ID_BASE);
  });

  it("send() writes NUL-terminated JSON; internal replies are consumed, others delivered", async () => {
    const h = harness();
    await h.chrome.ensureRunning();
    const got: unknown[] = [];
    const off = h.chrome.onMessage((m) => got.push(m));
    h.chrome.send({ id: 5, method: "Target.getTargets" });
    expect(h.children[0].written.at(-1)).toEqual({ id: 5, method: "Target.getTargets" });
    h.children[0].reply(5, { targetInfos: [] });
    h.children[0].reply(CHROME_INTERNAL_ID_BASE + 99, {}); // unknown internal id: swallowed
    expect(got).toEqual([{ id: 5, result: { targetInfos: [] } }]);
    off();
    h.children[0].emitFrame({ method: "Target.targetCreated" });
    expect(got).toHaveLength(1);
  });

  it("reassembles frames split across and merged within chunks; drops malformed frames", async () => {
    const h = harness();
    await h.chrome.ensureRunning();
    const got: unknown[] = [];
    h.chrome.onMessage((m) => got.push(m));
    const a = encodeFrame({ method: "A", params: { s: "héllo ✓" } });
    const b = encodeFrame({ method: "B" });
    const fd4 = h.children[0].fd4;
    fd4.emit("data", a.subarray(0, 7));
    fd4.emit("data", Buffer.concat([a.subarray(7), Buffer.from("{broken\0"), b]));
    expect(got).toEqual([{ method: "A", params: { s: "héllo ✓" } }, { method: "B" }]);
  });

  it("a throwing message listener does not break delivery to the others", async () => {
    const h = harness();
    await h.chrome.ensureRunning();
    const got: unknown[] = [];
    h.chrome.onMessage(() => {
      throw new Error("boom");
    });
    h.chrome.onMessage((m) => got.push(m));
    h.children[0].emitFrame({ method: "X" });
    expect(got).toEqual([{ method: "X" }]);
  });

  it("send() before launch throws code not-running", () => {
    const h = harness();
    expect(() => h.chrome.send({ id: 1 })).toThrowError(expect.objectContaining({ code: "not-running" }));
  });
});

// ── State, reset, size, lastUsed ────────────────────────────────────────────
describe("state, reset, sizeBytes, lastUsed", () => {
  it("state walks not-created → starting → running → stopped", async () => {
    vi.useFakeTimers();
    const h = harness({ behavior: { versionDelayMs: 50 } });
    expect(h.chrome.state()).toBe("not-created");
    const p = h.chrome.ensureRunning();
    expect(h.chrome.state()).toBe("starting");
    await vi.advanceTimersByTimeAsync(50);
    await p;
    expect(h.chrome.state()).toBe("running");
    const s = h.chrome.stop();
    await vi.advanceTimersByTimeAsync(0);
    await s;
    expect(h.chrome.state()).toBe("stopped");
  });

  it("reset is refused while running (code not-stopped) and deletes the dir once stopped", async () => {
    const h = harness();
    await h.chrome.ensureRunning();
    await expect(h.chrome.reset()).rejects.toMatchObject({ code: "not-stopped" });
    expect(fs.existsSync(h.dataDir)).toBe(true);
    await h.chrome.stop();
    h.chrome.touch();
    await h.chrome.reset();
    expect(fs.existsSync(h.dataDir)).toBe(false);
    expect(h.chrome.state()).toBe("not-created");
    expect(h.chrome.lastUsed).toBeUndefined();
    expect(await h.chrome.sizeBytes()).toBeUndefined();
    await expect(h.chrome.reset()).resolves.toBeUndefined(); // idempotent
  });

  it("reset is refused when another Chrome is on the directory", async () => {
    let busy = false;
    const h = harness({ list: () => (busy ? [{ pid: 9, args: `${BINARY} --user-data-dir=${h.dataDir} --remote-debugging-pipe` }] : []) });
    fs.mkdirSync(h.dataDir, { recursive: true });
    busy = true;
    await expect(h.chrome.reset()).rejects.toMatchObject({ code: "not-stopped" });
    expect(fs.existsSync(h.dataDir)).toBe(true);
  });

  it("sizeBytes sums files recursively and is cached for a minute", async () => {
    const h = harness();
    expect(await h.chrome.sizeBytes()).toBeUndefined();
    fs.mkdirSync(path.join(h.dataDir, "Default", "Cache"), { recursive: true });
    fs.writeFileSync(path.join(h.dataDir, "a"), Buffer.alloc(10));
    fs.writeFileSync(path.join(h.dataDir, "Default", "Cache", "b"), Buffer.alloc(32));
    expect(await h.chrome.sizeBytes()).toBe(42);
    fs.writeFileSync(path.join(h.dataDir, "c"), Buffer.alloc(8));
    h.clock.t += 59_000;
    expect(await h.chrome.sizeBytes()).toBe(42); // still cached
    h.clock.t += 1_001;
    expect(await h.chrome.sizeBytes()).toBe(50);
  });

  it("concurrent sizeBytes calls share one walk", async () => {
    const h = harness();
    fs.mkdirSync(h.dataDir, { recursive: true });
    const readdir = vi.spyOn(fs.promises, "readdir");
    const [a, b] = await Promise.all([h.chrome.sizeBytes(), h.chrome.sizeBytes()]);
    expect(a).toBe(b);
    expect(readdir).toHaveBeenCalledTimes(1);
    readdir.mockRestore();
  });

  it("stop invalidates the size cache; touch() stamps lastUsed from the clock", async () => {
    const h = harness();
    await h.chrome.ensureRunning();
    fs.writeFileSync(path.join(h.dataDir, "a"), Buffer.alloc(5));
    const before = await h.chrome.sizeBytes();
    fs.writeFileSync(path.join(h.dataDir, "z"), Buffer.alloc(7));
    await h.chrome.stop();
    const after = await h.chrome.sizeBytes();
    expect(after).toBe(duSync(h.dataDir)); // fresh walk (the owner record is gone too), not the cached value
    expect(after).not.toBe(before);
    expect(h.chrome.lastUsed).toBeUndefined();
    h.clock.t = 123_456;
    h.chrome.touch();
    expect(h.chrome.lastUsed).toBe(123_456);
  });
});
