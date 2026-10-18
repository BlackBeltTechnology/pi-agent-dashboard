/**
 * `openspec status --all` recipe + raw-result mapping against REAL child
 * processes: stdout AND stderr survive a non-zero exit (a broken change exits
 * 1 with complete JSON), and a never-exiting CLI is aborted at the recipe's
 * 30 s timeout (#X1, fake timers).
 * See change: use-openspec-status-all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { statusAllRawFromResult } from "../../openspec-poller.js";
import { classifyStatusAll } from "../../openspec-status-all.js";
import { OPENSPEC_STATUS_ALL, OPENSPEC_STATUS_ALL_TIMEOUT } from "../openspec.js";
import { type Recipe, runAsync } from "../runner.js";

const nodeRecipe = (script: string, timeout: number): Recipe<void, string> => ({
  argv: () => [process.execPath, "-e", script],
  parse: (s) => s, // same parse as OPENSPEC_STATUS_ALL
  timeout,
});

afterEach(() => vi.useRealTimers());

describe("OPENSPEC_STATUS_ALL recipe", () => {
  it("is `openspec status --all --json` with a 30 s timeout and raw stdout", () => {
    expect(OPENSPEC_STATUS_ALL.argv({ cwd: "/x" })).toEqual(["openspec", "status", "--all", "--json"]);
    expect(OPENSPEC_STATUS_ALL.timeout).toBe(30_000);
    expect(OPENSPEC_STATUS_ALL_TIMEOUT).toBe(30_000);
    expect(OPENSPEC_STATUS_ALL.tolerate).toBeUndefined(); // tolerate would drop stderr
    expect(OPENSPEC_STATUS_ALL.parse('{"a":1}', { cwd: "/x" })).toBe('{"a":1}');
  });
});

describe("statusAllRawFromResult with real child processes", () => {
  it("exit 1 keeps both stdout (complete JSON) and stderr, and classifies as success", async () => {
    const json = JSON.stringify({
      changes: [{ changeName: "bad", status: [{ severity: "error", code: "change_error", message: "Invalid YAML" }] }],
      root: { path: "/r", source: "nearest" },
    });
    const script = `process.stdout.write(${JSON.stringify(json)});process.stderr.write("warn: one change failed");process.exit(1)`;
    const raw = statusAllRawFromResult(await runAsync(nodeRecipe(script, 10_000), undefined, {}));
    expect(raw.exitCode).toBe(1);
    expect(raw.stdout).toBe(json);
    expect(raw.stderr).toBe("warn: one change failed");
    expect(raw.failure).toBeUndefined();
    expect(classifyStatusAll(raw).kind).toBe("ok");
  });

  it("an old CLI's commander error lands on stderr and classifies as unsupported", async () => {
    const script = `process.stderr.write("error: unknown option '--all'");process.exit(1)`;
    const raw = statusAllRawFromResult(await runAsync(nodeRecipe(script, 10_000), undefined, {}));
    expect(classifyStatusAll(raw).kind).toBe("unsupported");
  });

  it("exit 0 returns stdout", async () => {
    const raw = statusAllRawFromResult(await runAsync(nodeRecipe(`process.stdout.write("{}")`, 10_000), undefined, {}));
    expect(raw).toEqual({ stdout: "{}", stderr: "", exitCode: 0 });
  });

  it("#X1 a never-exiting CLI is aborted at the recipe timeout (30 s, fake timers) → failure", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = runAsync(nodeRecipe("setInterval(()=>{},1000)", OPENSPEC_STATUS_ALL.timeout!), undefined, {});
    await vi.advanceTimersByTimeAsync(29_999);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const raw = statusAllRawFromResult(await pending);
    expect(raw.failure).toBe("timeout");
    expect(classifyStatusAll(raw).kind).toBe("failed");
  }, 20_000);
});
