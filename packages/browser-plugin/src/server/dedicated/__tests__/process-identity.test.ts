/**
 * Process identity by command line (task 2.2; test-plan #R5/#R6 building blocks):
 * parsers, matchers, and one test against REAL spawned dummy processes.
 * See change: add-dedicated-agent-browser.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { isProcessAlive } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { afterEach, describe, expect, it } from "vitest";
import { DedicatedChrome } from "../chrome-process.js";
import {
  classifyProcesses,
  hasPipeFlag,
  hasUserDataDir,
  isBrowserProcess,
  listProcesses,
  parsePsOutput,
  parseWin32Processes,
} from "../process-identity.js";
import { FakeChromeChild } from "./fake-chrome.js";

describe("listing parsers", () => {
  it("parses `ps -axww -o pid=,args=` rows (args keep their spaces)", () => {
    const out = [
      "    1 /sbin/launchd",
      "  500 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a b/.pi/dashboard/agent-chrome --remote-debugging-pipe",
      "",
      "garbage line",
    ].join("\n");
    expect(parsePsOutput(out)).toEqual([
      { pid: 1, args: "/sbin/launchd" },
      {
        pid: 500,
        args: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/a b/.pi/dashboard/agent-chrome --remote-debugging-pipe",
      },
    ]);
  });

  it("parses PowerShell JSON: array, single object, null CommandLine, BOM, garbage", () => {
    const row = { ProcessId: 12, CommandLine: '"C:\\chrome.exe" --user-data-dir="C:\\x"' };
    expect(parseWin32Processes(JSON.stringify([row, { ProcessId: 4, CommandLine: null }]))).toEqual([
      { pid: 12, args: row.CommandLine },
    ]);
    expect(parseWin32Processes(`\uFEFF${JSON.stringify(row)}`)).toEqual([{ pid: 12, args: row.CommandLine }]);
    expect(parseWin32Processes("")).toEqual([]);
    expect(parseWin32Processes("not json")).toEqual([]);
  });
});

describe("matchers", () => {
  const DIR = "/Users/me/.pi/dashboard/agent-chrome";

  it("requires the exact user-data-dir (not a prefix or sibling)", () => {
    expect(hasUserDataDir(`chrome --user-data-dir=${DIR} about:blank`, DIR)).toBe(true);
    expect(hasUserDataDir(`chrome --user-data-dir=${DIR}`, DIR)).toBe(true);
    expect(hasUserDataDir(`chrome --user-data-dir="${DIR}" x`, DIR)).toBe(true);
    expect(hasUserDataDir(`chrome --user-data-dir=${DIR}/ x`, DIR)).toBe(true);
    expect(hasUserDataDir(`chrome --user-data-dir=${DIR}-downloads`, DIR)).toBe(false);
    expect(hasUserDataDir(`chrome --user-data-dir=${DIR}2`, DIR)).toBe(false);
    expect(hasUserDataDir(`chrome --x=--user-data-dir=${DIR}`, DIR)).toBe(false);
    expect(hasUserDataDir("chrome --user-data-dir=/other", DIR)).toBe(false);
    expect(hasUserDataDir("chrome", DIR)).toBe(false);
  });

  it("handles directories with spaces", () => {
    const dir = "/Users/John Smith/.pi/dashboard/agent-chrome";
    expect(hasUserDataDir(`chrome --user-data-dir=${dir} --remote-debugging-pipe`, dir)).toBe(true);
  });

  it("win32: quoted, backslashed and case-insensitive", () => {
    const dir = "C:\\Users\\Me\\.pi\\dashboard\\agent-chrome";
    const line = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir="c:\\users\\me\\.pi\\dashboard\\agent-chrome" --remote-debugging-pipe';
    expect(hasUserDataDir(line, dir, "win32")).toBe(true);
    expect(hasUserDataDir(line, dir, "linux")).toBe(false); // POSIX paths are case-sensitive
    expect(hasUserDataDir(line.replace("agent-chrome", "agent-chrome-downloads"), dir, "win32")).toBe(false);
  });

  it("detects the pipe flag as a whole token and skips helper processes", () => {
    expect(hasPipeFlag("chrome --remote-debugging-pipe --x")).toBe(true);
    expect(hasPipeFlag("chrome --remote-debugging-pipe=json")).toBe(true);
    expect(hasPipeFlag("chrome --remote-debugging-pipeline")).toBe(false);
    expect(hasPipeFlag("chrome --remote-debugging-port=9222")).toBe(false);
    expect(isBrowserProcess("chrome --type=renderer --user-data-dir=/x")).toBe(false);
    expect(isBrowserProcess("chrome --user-data-dir=/x")).toBe(true);
  });

  it("classifies dedicated vs foreign vs unrelated", () => {
    const list = [
      { pid: 1, args: `chrome --user-data-dir=${DIR} --remote-debugging-pipe` },
      { pid: 2, args: `chrome --user-data-dir=${DIR}` },
      { pid: 3, args: `chrome --type=gpu-process --user-data-dir=${DIR} --remote-debugging-pipe` },
      { pid: 4, args: "chrome --user-data-dir=/other --remote-debugging-pipe" },
    ];
    const c = classifyProcesses(list, DIR, "darwin");
    expect(c.dedicated.map((p) => p.pid)).toEqual([1]);
    expect(c.foreign.map((p) => p.pid)).toEqual([2]);
  });
});

// ── Task 2.2 verify: one test against real spawned dummy processes ──────────
describe.skipIf(process.platform === "win32")("identity against real processes", () => {
  const spawned: Array<{ pid?: number; kill(s?: NodeJS.Signals): boolean }> = [];
  let tmp = "";

  afterEach(() => {
    for (const c of spawned) {
      try {
        if (c.pid) process.kill(-c.pid, "SIGKILL");
      } catch {
        try {
          c.kill("SIGKILL");
        } catch {
          /* gone */
        }
      }
    }
    spawned.length = 0;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  function dummy(script: string, flags: string[]) {
    const child = spawn(process.execPath, [script, ...flags], { detached: true, stdio: "ignore" });
    spawned.push(child);
    return child;
  }

  it("real `ps` listing finds the dedicated dummy, ignores look-alikes; DedicatedChrome kills only the orphan", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dedicated-identity-"));
    const configDir = path.join(tmp, ".pi", "dashboard");
    const dataDir = path.join(configDir, "agent-chrome");
    fs.mkdirSync(dataDir, { recursive: true });
    const script = path.join(tmp, "dummy.mjs");
    fs.writeFileSync(script, "setInterval(() => {}, 1000);\n");

    const orphan = dummy(script, ["--remote-debugging-pipe", `--user-data-dir=${dataDir}`, "about:blank"]);
    // Look-alikes: pipe flag but another dir; right dir but a sibling name.
    const otherDir = dummy(script, ["--remote-debugging-pipe", `--user-data-dir=${path.join(tmp, "elsewhere")}`]);
    const sibling = dummy(script, ["--remote-debugging-pipe", `--user-data-dir=${dataDir}-downloads`]);
    await new Promise((r) => setTimeout(r, 300)); // let them exec

    const listing = await listProcesses();
    const { dedicated, foreign } = classifyProcesses(listing, dataDir);
    expect(dedicated.map((p) => p.pid)).toEqual([orphan.pid]);
    expect(foreign).toEqual([]);

    const fake: FakeChromeChild[] = [];
    const chrome = new DedicatedChrome({
      resolveBinary: () => "/fake/chrome",
      spawn: () => {
        const c = new FakeChromeChild(1);
        fake.push(c);
        return c;
      },
      getDashboardConfigDir: () => configDir,
      selfPid: process.pid,
    });
    await chrome.ensureRunning(); // real ps + real killProcessGroup on the orphan, fake spawn after

    expect(fake).toHaveLength(1);
    expect(isProcessAlive(orphan.pid as number)).toBe(false);
    expect(isProcessAlive(otherDir.pid as number)).toBe(true);
    expect(isProcessAlive(sibling.pid as number)).toBe(true);
  }, 20_000);
});
