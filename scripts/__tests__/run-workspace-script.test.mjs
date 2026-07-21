import { describe, expect, it } from "vitest";
import { buildWorkspaceRunInvocation, CLIENT_WORKSPACE } from "../run-workspace-script.mjs";

describe("run-workspace-script", () => {
  it("forwards extra args after npm's -- separator", () => {
    const invocation = buildWorkspaceRunInvocation({
      workspace: CLIENT_WORKSPACE,
      scriptName: "dev",
      forwardedArgs: ["--port", "3000"],
      nodeExecPath: "/node",
      npmExecPath: "/npm-cli.js",
    });

    expect(invocation).toEqual({
      command: "/node",
      args: [
        "/npm-cli.js",
        `--workspace=${CLIENT_WORKSPACE}`,
        "run",
        "dev",
        "--",
        "--port",
        "3000",
      ],
    });
  });

  it("omits the extra separator when no args are forwarded", () => {
    const invocation = buildWorkspaceRunInvocation({
      workspace: CLIENT_WORKSPACE,
      scriptName: "build",
      forwardedArgs: [],
      nodeExecPath: "/node",
      npmExecPath: "/npm-cli.js",
    });

    expect(invocation.args).toEqual([
      "/npm-cli.js",
      `--workspace=${CLIENT_WORKSPACE}`,
      "run",
      "build",
    ]);
  });

  it("falls back to npm binary when npm_execpath is absent", () => {
    const invocation = buildWorkspaceRunInvocation({
      workspace: CLIENT_WORKSPACE,
      scriptName: "dev",
      forwardedArgs: ["--host"],
      npmExecPath: "",
    });

    expect(invocation.command).toBe(process.platform === "win32" ? "npm.cmd" : "npm");
    expect(invocation.args).toEqual([
      `--workspace=${CLIENT_WORKSPACE}`,
      "run",
      "dev",
      "--",
      "--host",
    ]);
  });
});
