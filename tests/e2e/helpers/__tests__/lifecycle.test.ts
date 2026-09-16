/**
 * Unit tests (vitest `tests` project, NOT Playwright) for the harness failure
 * diagnostics in `tests/e2e/lifecycle.ts`.
 *
 * Why they exist: the first CI dispatches of the sharded browser-E2E workflow
 * failed with "container never became healthy" and NO cause, because
 * test-up.sh's output ends at `Container ... Started` (compose returns as soon
 * as the container is up). `captureHarnessFailure` snapshots what happened
 * after that; these tests pin the report shape and the degrade-without-docker
 * behavior of the failure path.
 *
 * See change: stabilize-browser-e2e.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureHarnessFailure,
  type DockerProbe,
  harnessFailureLogPath,
  harnessRestartCount,
  resolveHarnessProject,
  throwIfCrashLooping,
} from "../../lifecycle.js";

const tmpDirs: string[] = [];

function workspace(stateFile?: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-lifecycle-"));
  tmpDirs.push(dir);
  if (stateFile !== undefined) {
    fs.writeFileSync(
      path.join(dir, ".pi-test-harness.json"),
      typeof stateFile === "string" ? stateFile : JSON.stringify(stateFile),
    );
  }
  return dir;
}

/** Probe stub keyed on the docker args the helper actually passes. */
function stubProbe(responses: { names?: string; inspect?: string; logs?: string }): DockerProbe {
  return (args) => {
    if (args[0] === "ps") return { status: 0, stdout: responses.names ?? "", stderr: "" };
    if (args[0] === "inspect") {
      // Pin the template: a typo in the Go-template field would otherwise only
      // surface in a production failure bundle nobody re-reads.
      if (!args.some((a) => a.includes("{{.RestartCount}}"))) {
        throw new Error(`inspect must request {{.RestartCount}}, got: ${args.join(" ")}`);
      }
      return { status: 0, stdout: responses.inspect ?? "", stderr: "" };
    }
    if (args[0] === "logs") {
      // docker logs writes container logs to BOTH streams; the helper merges them.
      return { status: 0, stdout: responses.logs ?? "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: `unexpected docker ${args.join(" ")}` };
  };
}

afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
});

describe("resolveHarnessProject", () => {
  it("reads the compose project from the state file", () => {
    const ws = workspace({ project: "pi-dash-test-42", dashboardPort: 18693, gatewayPort: 19693 });
    expect(resolveHarnessProject(ws)).toBe("pi-dash-test-42");
  });

  it("degrades to undefined (never throws) when the state file is absent or malformed", () => {
    expect(resolveHarnessProject(workspace())).toBeUndefined();
    expect(resolveHarnessProject(workspace("not json"))).toBeUndefined();
    expect(resolveHarnessProject(workspace({ dashboardPort: 1 }))).toBeUndefined();
  });
});

describe("harnessRestartCount", () => {
  it("parses the restart count of the project's container", () => {
    const ws = workspace({ project: "p" });
    const probe = stubProbe({ names: "p-pi-dashboard-1\n", inspect: "3\n" });
    expect(harnessRestartCount(ws, probe)).toBe(3);
  });

  it("is undefined before the container exists (and when there is no project)", () => {
    const ws = workspace({ project: "p" });
    expect(harnessRestartCount(ws, stubProbe({}))).toBeUndefined();
    expect(harnessRestartCount(workspace(), stubProbe({ names: "x-pi-dashboard-1\n" }))).toBeUndefined();
  });

  it("reads a failed inspect (empty stdout) as unknown, not zero restarts", () => {
    // `Number("") === 0` would report a busy daemon as a healthy zero, hiding a
    // crash-loop from throwIfCrashLooping.
    const ws = workspace({ project: "p" });
    expect(harnessRestartCount(ws, stubProbe({ names: "p-pi-dashboard-1\n", inspect: "\n" }))).toBeUndefined();
  });
});

describe("throwIfCrashLooping", () => {
  const boom = { names: "p-pi-dashboard-1\n", inspect: "2\n", logs: "SMOKE FAILED\n" };

  it("stays silent below the threshold (a single transient restart is not a loop)", () => {
    const ws = workspace({ project: "p" });
    const logPath = path.join(ws, "test-results", "test-up.log");
    const probe = stubProbe({ ...boom, inspect: "1\n" });
    expect(() => throwIfCrashLooping(ws, logPath, probe)).not.toThrow();
    expect(fs.existsSync(harnessFailureLogPath(logPath))).toBe(false);
  });

  it("throws at the threshold, naming the count and the captured bundle", () => {
    const ws = workspace({ project: "p" });
    const logPath = path.join(ws, "test-results", "test-up.log");
    expect(() => throwIfCrashLooping(ws, logPath, stubProbe(boom))).toThrow(
      /crash-looping \(restarts=2\)/,
    );
    expect(fs.readFileSync(harnessFailureLogPath(logPath), "utf8")).toContain("SMOKE FAILED");
  });

  it("still throws (without a bundle clause) when the container vanishes mid-probe", () => {
    // First `ps` (restart count) sees the container, the second (inside the
    // capture) does not: the diagnostic must degrade, not swallow the failure.
    let psCalls = 0;
    const probe: DockerProbe = (args) => {
      if (args[0] === "ps") {
        psCalls += 1;
        return { status: 0, stdout: psCalls === 1 ? "p-pi-dashboard-1\n" : "", stderr: "" };
      }
      return { status: 0, stdout: args[0] === "inspect" ? "2\n" : "", stderr: "" };
    };
    const ws = workspace({ project: "p" });
    const logPath = path.join(ws, "test-results", "test-up.log");
    expect(() => throwIfCrashLooping(ws, logPath, probe)).toThrow(/crash-looping/);
  });
});

describe("captureHarnessFailure", () => {
  it("writes the container state + log tail into the uploaded bundle", () => {
    const ws = workspace({ project: "p" });
    const logPath = path.join(ws, "test-results", "test-up.log");
    const probe = stubProbe({
      names: "p-pi-dashboard-1\n",
      inspect: "status=restarting restarts=4 exit=1\n",
      logs: "[test-entrypoint] SMOKE FAILED: GET /api/health did not return 200\n",
    });

    const out = captureHarnessFailure(ws, logPath, probe);

    expect(out).toBe(harnessFailureLogPath(logPath));
    const body = fs.readFileSync(out as string, "utf8");
    expect(body).toContain("harness project: p");
    expect(body).toContain("p-pi-dashboard-1");
    expect(body).toContain("restarts=4");
    expect(body).toContain("SMOKE FAILED");
  });

  it("returns undefined (writes nothing) when docker shows no container", () => {
    const ws = workspace({ project: "p" });
    const logPath = path.join(ws, "test-results", "test-up.log");
    expect(captureHarnessFailure(ws, logPath, stubProbe({}))).toBeUndefined();
    expect(fs.existsSync(harnessFailureLogPath(logPath))).toBe(false);
  });
});
