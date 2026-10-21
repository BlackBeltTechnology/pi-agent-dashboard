/**
 * `pi-obs wake-hook`: a macOS LaunchAgent that notices the Mac waking from
 * sleep (wall-clock jump between ticks) and runs `capture refresh` through
 * `pi-dashboard service exec`. See change: add-obs-capture-refresh.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLIST_LABEL, plistPath, renderPlist, watchForWake } from "../wake-hook.js";
import { baseDeps, runCli, tmpHome } from "./cli-harness.js";

const errCode = (r: { json(): Record<string, unknown> }) => (r.json().error as { code?: string } | undefined)?.code;

function fakeClock(steps: number[]) {
  // `steps[i]` = wall-clock ms that elapse during the i-th sleep.
  let t = 1_000_000;
  let i = 0;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += steps[i++] ?? ms;
    },
    slept,
  };
}

describe("watchForWake", () => {
  it("fires once per clock jump larger than gapMs, after the settle delay", async () => {
    // tick 15 s, tick 15 s, a 40-minute sleep, settle, tick 15 s
    const c = fakeClock([15_000, 15_000, 40 * 60_000, 10_000, 15_000]);
    const wakes: number[] = [];
    await watchForWake({
      now: c.now,
      sleep: c.sleep,
      tickMs: 15_000,
      gapMs: 60_000,
      settleMs: 10_000,
      maxTicks: 4,
      onWake: async (gap) => {
        wakes.push(gap);
      },
    });
    expect(wakes).toEqual([40 * 60_000]);
    expect(c.slept).toContain(10_000);
  });

  it("a failing refresh is logged and the watcher keeps running", async () => {
    const c = fakeClock([5 * 60_000, 10_000, 5 * 60_000, 10_000]);
    const logs: string[] = [];
    let calls = 0;
    await watchForWake({
      now: c.now,
      sleep: c.sleep,
      tickMs: 15_000,
      gapMs: 60_000,
      settleMs: 10_000,
      maxTicks: 2,
      log: (l) => logs.push(l),
      onWake: async () => {
        calls++;
        throw new Error("service unreachable");
      },
    });
    expect(calls).toBe(2);
    expect(logs.some((l) => l.includes("service unreachable"))).toBe(true);
  });
});

describe("renderPlist", () => {
  it("runs `wake-hook run` with absolute node + entry, keeps alive, carries PATH, no secrets", () => {
    const xml = renderPlist({ nodePath: "/abs/node", entryPath: "/abs/pi-obs.mjs", service: "obs", pathEnv: "/usr/bin:/opt/bin", logFile: "/s/wake.log" });
    expect(xml).toContain(`<string>${PLIST_LABEL}</string>`);
    for (const a of ["/abs/node", "/abs/pi-obs.mjs", "wake-hook", "run", "--service", "obs"]) expect(xml).toContain(`<string>${a}</string>`);
    expect(xml).toContain("<key>KeepAlive</key>");
    expect(xml).toContain("<string>/usr/bin:/opt/bin</string>");
    expect(xml).toContain("<string>/s/wake.log</string>");
    expect(xml).not.toMatch(/PASSWORD|SECRET/i);
  });

  it("escapes XML metacharacters", () => {
    const xml = renderPlist({ nodePath: "/a&b/node", entryPath: "/x<y>/e.mjs", service: "obs", pathEnv: "/bin", logFile: "/l" });
    expect(xml).toContain("/a&amp;b/node");
    expect(xml).toContain("/x&lt;y&gt;/e.mjs");
  });
});

describe("pi-obs wake-hook install|uninstall", () => {
  function setup(over: { yes?: boolean; platform?: "darwin" | "linux" } = {}) {
    const home = tmpHome();
    const calls: Array<[string, string[]]> = [];
    const deps = baseDeps(home, {
      host: { home, platform: over.platform ?? "darwin", env: { PATH: "/usr/bin:/opt/bin" } },
      run: async (file: string, args: string[]) => {
        calls.push([file, args]);
        return { code: 0, stdout: file === "id" ? "501\n" : "" };
      },
    });
    return { home, calls, run: (argv: string[]) => runCli([...argv, ...(over.yes ? ["--yes"] : []), "--json"], deps) };
  }

  it("install writes the LaunchAgent plist and bootstraps it into gui/<uid>", async () => {
    const s = setup({ yes: true });
    const r = await s.run(["wake-hook", "install"]);
    expect(r.code).toBe(0);
    const p = plistPath(s.home);
    expect(r.json().plist).toBe(p);
    expect(fs.readFileSync(p, "utf8")).toContain("<string>wake-hook</string>");
    expect(s.calls).toContainEqual(["launchctl", ["bootstrap", "gui/501", p]]);
  });

  it("install without consent (non-TTY, no --yes) refuses and writes nothing", async () => {
    const s = setup();
    const r = await s.run(["wake-hook", "install"]);
    expect(errCode(r)).toBe("refused");
    expect(fs.existsSync(plistPath(s.home))).toBe(false);
    expect(s.calls.filter(([f]) => f === "launchctl")).toEqual([]);
  });

  it("uninstall boots the agent out and removes the plist", async () => {
    const s = setup({ yes: true });
    await s.run(["wake-hook", "install"]);
    const r = await s.run(["wake-hook", "uninstall"]);
    expect(r.code).toBe(0);
    expect(fs.existsSync(plistPath(s.home))).toBe(false);
    expect(s.calls).toContainEqual(["launchctl", ["bootout", `gui/501/${PLIST_LABEL}`]]);
  });

  it("is macOS-only", async () => {
    const s = setup({ yes: true, platform: "linux" });
    const r = await s.run(["wake-hook", "install"]);
    expect(errCode(r)).toBe("refused");
    expect(fs.existsSync(path.join(s.home, "Library"))).toBe(false);
  });
});
