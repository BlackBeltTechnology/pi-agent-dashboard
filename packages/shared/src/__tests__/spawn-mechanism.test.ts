/**
 * Tests for platform/spawn-mechanism.ts pure selector + argv builders.
 *
 * Every test passes `platform` explicitly. Never mutates process.platform.
 */
import { describe, it, expect } from "vitest";
import {
  selectMechanism,
  buildWtArgs,
  sessionFlagsToArgv,
  type SpawnMechanismContext,
} from "../platform/spawn-mechanism.js";

function ctx(overrides: Partial<SpawnMechanismContext> = {}): SpawnMechanismContext {
  return {
    platform: "linux",
    userStrategy: "tmux",
    electronMode: false,
    available: { tmux: false, wt: false, wslTmux: false },
    ...overrides,
  };
}

describe("selectMechanism", () => {
  it("electron mode always returns headless", () => {
    expect(selectMechanism(ctx({ electronMode: true, platform: "win32", available: { tmux: false, wt: true, wslTmux: true } }))).toBe("headless");
    expect(selectMechanism(ctx({ electronMode: true, platform: "linux", available: { tmux: true, wt: false, wslTmux: false } }))).toBe("headless");
    expect(selectMechanism(ctx({ electronMode: true, platform: "darwin", available: { tmux: true, wt: false, wslTmux: false } }))).toBe("headless");
  });

  it("userStrategy headless always returns headless", () => {
    expect(selectMechanism(ctx({ userStrategy: "headless", platform: "win32", available: { tmux: false, wt: true, wslTmux: true } }))).toBe("headless");
    expect(selectMechanism(ctx({ userStrategy: "headless", platform: "linux", available: { tmux: true, wt: false, wslTmux: false } }))).toBe("headless");
  });

  it("Linux with tmux returns tmux", () => {
    expect(selectMechanism(ctx({ platform: "linux", available: { tmux: true, wt: false, wslTmux: false } }))).toBe("tmux");
  });

  it("macOS with tmux returns tmux", () => {
    expect(selectMechanism(ctx({ platform: "darwin", available: { tmux: true, wt: false, wslTmux: false } }))).toBe("tmux");
  });

  it("Linux without tmux returns headless", () => {
    expect(selectMechanism(ctx({ platform: "linux", available: { tmux: false, wt: false, wslTmux: false } }))).toBe("headless");
  });

  it("Windows with wt returns wt", () => {
    expect(selectMechanism(ctx({ platform: "win32", available: { tmux: false, wt: true, wslTmux: false } }))).toBe("wt");
  });

  it("Windows with wt AND wsl-tmux prefers wt", () => {
    expect(selectMechanism(ctx({ platform: "win32", available: { tmux: false, wt: true, wslTmux: true } }))).toBe("wt");
  });

  it("Windows with only wsl-tmux returns wsl-tmux", () => {
    expect(selectMechanism(ctx({ platform: "win32", available: { tmux: false, wt: false, wslTmux: true } }))).toBe("wsl-tmux");
  });

  it("Windows with nothing available returns headless", () => {
    expect(selectMechanism(ctx({ platform: "win32", available: { tmux: false, wt: false, wslTmux: false } }))).toBe("headless");
  });

  it("unknown platform falls back to headless", () => {
    expect(selectMechanism(ctx({ platform: "openbsd" as NodeJS.Platform, available: { tmux: true, wt: false, wslTmux: false } }))).toBe("headless");
  });
});

describe("buildWtArgs", () => {
  it("produces argv in expected order", () => {
    const argv = buildWtArgs({
      cwd: "C:\\proj",
      title: "proj",
      piArgv: ["C:\\node.exe", "cli.js", "--mode", "rpc"],
    });
    expect(argv).toEqual([
      "-w", "0",
      "new-tab",
      "-d", "C:\\proj",
      "--title", "proj",
      "--",
      "C:\\node.exe", "cli.js", "--mode", "rpc",
    ]);
  });

  it("preserves cwd with spaces as a single argv element", () => {
    const argv = buildWtArgs({
      cwd: "C:\\Users\\Bob's Project (2)",
      title: "x",
      piArgv: ["pi"],
    });
    expect(argv).toContain("C:\\Users\\Bob's Project (2)");
    expect(argv.filter(a => a.includes("Bob"))).toHaveLength(1);
  });

  it("places piArgv after -- sentinel with --fork intact", () => {
    const argv = buildWtArgs({
      cwd: "C:\\proj",
      title: "proj",
      piArgv: ["node.exe", "cli.js", "--fork", "C:\\x\\session.jsonl"],
    });
    const sentinelIdx = argv.indexOf("--");
    expect(sentinelIdx).toBeGreaterThan(0);
    expect(argv.slice(sentinelIdx + 1)).toEqual(["node.exe", "cli.js", "--fork", "C:\\x\\session.jsonl"]);
  });

  it("never includes -p profile flag", () => {
    const argv = buildWtArgs({ cwd: "C:\\x", title: "y", piArgv: ["pi"] });
    expect(argv).not.toContain("-p");
  });
});

describe("sessionFlagsToArgv", () => {
  it("returns --session file for continue mode", () => {
    expect(sessionFlagsToArgv({ sessionFile: "/s/abc.jsonl", mode: "continue" })).toEqual(["--session", "/s/abc.jsonl"]);
  });

  it("returns --fork file for fork mode", () => {
    expect(sessionFlagsToArgv({ sessionFile: "C:\\s\\abc.jsonl", mode: "fork" })).toEqual(["--fork", "C:\\s\\abc.jsonl"]);
  });

  it("returns empty array with no file", () => {
    expect(sessionFlagsToArgv({})).toEqual([]);
    expect(sessionFlagsToArgv({ mode: "continue" })).toEqual([]);
    expect(sessionFlagsToArgv({ mode: "fork" })).toEqual([]);
  });

  it("returns empty array with file but no mode", () => {
    expect(sessionFlagsToArgv({ sessionFile: "/s/x.jsonl" })).toEqual([]);
  });
});
