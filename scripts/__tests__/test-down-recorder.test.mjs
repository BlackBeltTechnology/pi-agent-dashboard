/**
 * `docker/test-down.sh` marks its own teardown and stops the recorder (change:
 * add-missing-ci-legs, #451 part 1; test-plan E27/E28/X3/P2). `docker` is a stub
 * (scripts/__tests__/harness-recorder-helpers.mjs); the "recorder" is a plain
 * `sleep` process whose events file the test writes. Pattern:
 * test-up-port-derivation.test.mjs.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeSandbox, sleep, spawnSleeper, TEST_DOWN, waitDead } from "./harness-recorder-helpers.mjs";

let sb;
afterEach(() => sb?.cleanup());

/** Seed workspace state + events file; returns the recorder stand-in pid. */
function seed({ containerId = "cid-aaa111", recorder = true } = {}) {
  mkdirSync(path.dirname(sb.eventsFile), { recursive: true });
  writeFileSync(sb.eventsFile, `boot 2026-01-01T00:00:00Z ${sb.project} ${containerId || "cid-aaa111"}\n`);
  const pid = recorder ? spawnSleeper() : undefined;
  if (pid) sb.trackPid(pid);
  const state = { project: sb.project, dashboardPort: 18111, gatewayPort: 18112, eventsFile: sb.eventsFile };
  if (pid) state.recorderPid = pid;
  if (containerId) state.containerId = containerId;
  writeFileSync(path.join(sb.ws, ".pi-test-harness.json"), JSON.stringify(state));
  return pid;
}

const destroyLine = (id) => `1700000000 destroy harness project=${sb.project} id=${id}`;

/** Append `line` to the events file after `ms` (a stand-in for the recorder). */
function appendLater(line, ms) {
  const child = spawn("sh", ["-c", `sleep ${ms / 1000}; printf '%s\\n' "$1" >> "$2"`, "_", line, sb.eventsFile], { detached: true, stdio: "ignore" });
  child.unref();
}

function down(extraEnv = {}) {
  const started = Date.now();
  const r = spawnSync("bash", [TEST_DOWN], {
    cwd: sb.ws,
    env: { ...sb.env, FAKE_DOWN_SNAPSHOT: path.join(sb.tmpdir, "snapshot.log"), FAKE_EVENTS_LOG_FILE: sb.eventsFile, ...extraEnv },
    encoding: "utf8",
  });
  return { status: r.status, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? ""), ms: Date.now() - started };
}

describe("teardown marker (E27)", () => {
  it("appends teardown-begin <ts> <project> <id> BEFORE compose down, prints the path, kills the recorder", async () => {
    sb = makeSandbox();
    const pid = seed();
    appendLater(destroyLine("cid-aaa111"), 0);
    const r = down();
    expect(r.status).toBe(0);
    const snapshot = readFileSync(path.join(sb.tmpdir, "snapshot.log"), "utf8"); // events file as `compose down` ran
    expect(snapshot).toMatch(new RegExp(`^teardown-begin \\d{4}-\\d\\d-\\d\\dT\\S+Z ${sb.project} cid-aaa111$`, "m"));
    expect(r.stdout).toContain(sb.eventsFile);
    expect(await waitDead(pid, 2000)).toBe(true);
  });

  it("resolves the id with `compose ps -q` BEFORE any removal when the state has none", () => {
    sb = makeSandbox({ FAKE_CONTAINER_ID: "cid-resolved9" });
    seed({ containerId: "" });
    const r = down();
    expect(r.status).toBe(0);
    const calls = sb.dockerCalls();
    const ps = calls.findIndex((c) => / ps -q/.test(c));
    const dn = calls.findIndex((c) => / down /.test(c));
    expect(ps).toBeGreaterThanOrEqual(0);
    expect(ps).toBeLessThan(dn);
    expect(readFileSync(path.join(sb.tmpdir, "snapshot.log"), "utf8")).toMatch(/^teardown-begin \S+ \S+ cid-resolved9$/m);
  });
});

describe("destroy-line wait (E28, P2)", () => {
  it("a destroy line already present: recorder stopped promptly", async () => {
    sb = makeSandbox();
    const pid = seed();
    appendLater(destroyLine("cid-aaa111"), 0);
    await sleep(100);
    const r = down();
    expect(r.ms).toBeLessThan(2000);
    expect(await waitDead(pid, 1500)).toBe(true);
  });

  it("a late destroy line is waited for (not cut off by an early stop)", () => {
    sb = makeSandbox();
    seed();
    appendLater(destroyLine("cid-aaa111"), 2000);
    const r = down({ PI_HARNESS_DESTROY_WAIT_SECS: "5" });
    expect(r.ms).toBeGreaterThanOrEqual(1900);
    expect(r.ms).toBeLessThan(4200);
  });

  it("another container's destroy does NOT end the wait", () => {
    sb = makeSandbox();
    seed();
    appendLater(destroyLine("cid-OTHER"), 500);
    const r = down({ PI_HARNESS_DESTROY_WAIT_SECS: "3" });
    expect(r.ms).toBeGreaterThanOrEqual(2900);
  });

  it("(P2) no destroy line ever: the wait is bounded at 10 s (+1 s)", async () => {
    sb = makeSandbox();
    const pid = seed();
    const r = down();
    expect(r.status).toBe(0);
    expect(r.ms).toBeGreaterThanOrEqual(9800);
    expect(r.ms).toBeLessThan(11500);
    expect(await waitDead(pid, 1500)).toBe(true);
  }, 20_000);
});

describe("recorder dead or absent at teardown (X3, decision L2)", () => {
  for (const mode of ["dead", "absent"]) {
    it(`${mode} recorder → one warning, marker still written, no wait, compose down runs, exit 0`, async () => {
      sb = makeSandbox();
      if (mode === "dead") {
        const pid = seed();
        process.kill(pid, "SIGKILL");
        expect(await waitDead(pid)).toBe(true);
      } else {
        seed({ recorder: false });
      }
      const r = down();
      expect(r.status).toBe(0);
      expect(r.ms).toBeLessThan(1500);
      expect(r.stderr.split("\n").filter((l) => l.startsWith("harness-audit:"))).toHaveLength(1);
      expect(r.stderr).toMatch(/recorder is not running at teardown/);
      expect(readFileSync(sb.eventsFile, "utf8")).toMatch(/^teardown-begin \S+ \S+ cid-aaa111$/m);
      expect(sb.dockerCalls().some((c) => / down /.test(c))).toBe(true);
      expect(existsSync(path.join(sb.ws, ".pi-test-harness.json"))).toBe(false);
    });
  }
});
