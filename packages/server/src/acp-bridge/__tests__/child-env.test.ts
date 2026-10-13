/**
 * Agent launch hygiene. See change: add-acp-session-driver (test-plan #E20–#E22).
 */
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { assertLaunchable, buildAgentEnv, launchAgentProcess } from "../child-env.js";

describe("buildAgentEnv", () => {
  it("E20: allowlist + configured env minus forbidden keys", () => {
    const { env, warnings } = buildAgentEnv(
      {
        PATH: "/bin",
        HOME: "/h",
        LC_ALL: "C",
        PI_DASHBOARD_SPAWN_TOKEN: "tok",
        PI_DASHBOARD_URL: "http://x",
        PI_DASHBOARD_MCP_TOKEN: "m",
        ELECTRON_RUN_AS_NODE: "1",
        SECRET: "no",
      },
      { NODE_OPTIONS: "--require x", FOO: "1", PI_X: "y", ELECTRON_Z: "z" },
    );
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", LC_ALL: "C", FOO: "1" });
    expect(warnings).toHaveLength(3);
    expect(warnings.join(" ")).toMatch(/NODE_OPTIONS/);
    expect(warnings.join(" ")).toMatch(/PI_X/);
  });
});

describe("launchAgentProcess", () => {
  it("E21: argv is passed literally with shell:false", () => {
    const spawn = vi.fn(() => ({}) as ChildProcess);
    launchAgentProcess({ agent: { command: "qmt", args: ["; rm -rf ~", "$(id)"], env: {} }, cwd: "/w", adapterEnv: { PATH: "/bin" }, spawn });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, options] = spawn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
    expect(cmd).toBe("qmt");
    expect(args).toEqual(["; rm -rf ~", "$(id)"]);
    expect(options.shell).toBe(false);
    expect(options.cwd).toBe("/w");
    expect(options.env).toEqual({ PATH: "/bin" });
  });

  it("E22: Windows .cmd/.bat rejected before spawning; .exe spawned", () => {
    const spawn = vi.fn(() => ({}) as ChildProcess);
    expect(() => launchAgentProcess({ agent: { command: "qmt.cmd", args: [], env: {} }, cwd: "/w", platform: "win32", spawn })).toThrow(/requires a shell/);
    expect(() => launchAgentProcess({ agent: { command: "QMT.BAT", args: [], env: {} }, cwd: "/w", platform: "win32", spawn })).toThrow(/requires a shell/);
    expect(spawn).not.toHaveBeenCalled();
    launchAgentProcess({ agent: { command: "qmt.exe", args: [], env: {} }, cwd: "/w", platform: "win32", spawn });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(() => assertLaunchable("qmt.cmd", "linux")).not.toThrow();
  });

  it("forwards reserved-key warnings", () => {
    const warn = vi.fn();
    launchAgentProcess({ agent: { command: "q", args: [], env: { PI_X: "1" } }, cwd: "/w", adapterEnv: {}, spawn: () => ({}) as ChildProcess, warn });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("PI_X"));
  });
});
