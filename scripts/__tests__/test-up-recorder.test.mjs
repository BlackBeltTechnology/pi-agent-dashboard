/**
 * `docker/test-up.sh` starts a per-harness lifecycle recorder (change:
 * add-missing-ci-legs, #451 part 1; test-plan E24/E25/E26/X1/X2/X4/X6).
 * `docker` is a stub on PATH (scripts/__tests__/harness-recorder-helpers.mjs);
 * no daemon is touched. Pattern: test-up-oversubscribe-guard.test.mjs.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isAlive, makeSandbox, readState, spawnSleeper, TEST_DOWN, TEST_UP, waitDead } from "./harness-recorder-helpers.mjs";

const WARNING = /^harness-audit: lifecycle capture unavailable \(.+\); continuing$/;
let sb;
afterEach(() => sb?.cleanup());

function up(extraEnv = {}) {
  const env = { ...sb.env, ...extraEnv };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  const r = spawnSync("bash", [TEST_UP, "-d"], { cwd: sb.ws, env, encoding: "utf8" });
  return { status: r.status, stderr: String(r.stderr ?? ""), stdout: String(r.stdout ?? "") };
}

describe("state file + events path (E24)", () => {
  it("records recorderPid, eventsFile under $TMPDIR/pi-dash-test, and the container id", () => {
    sb = makeSandbox(); // TMPDIR = "<dir>/" (trailing slash)
    const r = up();
    expect(r.status).toBe(0);
    const state = readState(sb.ws);
    expect(isAlive(state.recorderPid)).toBe(true);
    expect(state.eventsFile).toBe(sb.eventsFile);
    expect(state.eventsFile).not.toContain("//");
    expect(state.containerId).toBe("cid-aaa111");
    expect(existsSync(sb.eventsFile)).toBe(true);
    expect(readFileSync(sb.eventsFile, "utf8")).toMatch(new RegExp(`^boot \\S+ ${sb.project} cid-aaa111$`, "m"));
  });

  it("falls back to /tmp/pi-dash-test when TMPDIR is unset", () => {
    sb = makeSandbox({ TMPDIR: undefined });
    const expected = `/tmp/pi-dash-test/${sb.project}.events.log`;
    try {
      expect(up().status).toBe(0);
      expect(readState(sb.ws).eventsFile).toBe(expected);
    } finally {
      rmSync(expected, { force: true });
    }
  });
});

describe("recorder is started before compose up, scoped to its own project (E25)", () => {
  it("project-scoped `docker events` precedes `compose up`", () => {
    sb = makeSandbox();
    expect(up().status).toBe(0);
    const calls = sb.dockerCalls();
    const events = calls.findIndex((c) => c.startsWith("events") && c.includes(`label=com.docker.compose.project=${sb.project}`));
    const composeUp = calls.findIndex((c) => c.startsWith("compose") && / up( |$)/.test(c));
    expect(events, calls.join("\n")).toBeGreaterThanOrEqual(0);
    expect(composeUp).toBeGreaterThan(events);
    // Never an unscoped recorder.
    expect(calls.filter((c) => c.startsWith("events") && !c.includes("label=com.docker.compose.project="))).toEqual([]);
  });
});

describe("re-up idempotence (E26)", () => {
  const seedState = (extra) => {
    writeFileSync(
      path.join(sb.ws, ".pi-test-harness.json"),
      JSON.stringify({ project: sb.project, dashboardPort: 18111, gatewayPort: 18112, ...extra }),
    );
  };
  const seedEvents = (body) => {
    mkdirSync(path.dirname(sb.eventsFile), { recursive: true });
    writeFileSync(sb.eventsFile, body);
  };

  it("(a) live recorder + same container → one recorder, same PID, no new boot line", () => {
    sb = makeSandbox();
    const pid = spawnSleeper();
    sb.trackPid(pid);
    seedEvents(`boot 2026-01-01T00:00:00Z ${sb.project} cid-aaa111\n`);
    seedState({ recorderPid: pid, eventsFile: sb.eventsFile, containerId: "cid-aaa111" });
    expect(up().status).toBe(0);
    expect(readState(sb.ws).recorderPid).toBe(pid);
    expect(sb.dockerCalls().filter((c) => c.startsWith("events"))).toEqual([]);
    expect(readFileSync(sb.eventsFile, "utf8").match(/^boot /gm)).toHaveLength(1);
  });

  it("(b) live recorder + NEW container id → same PID, exactly one new boot line", () => {
    sb = makeSandbox({ FAKE_CONTAINER_ID: "cid-bbb222" });
    const pid = spawnSleeper();
    sb.trackPid(pid);
    seedEvents(`boot 2026-01-01T00:00:00Z ${sb.project} cid-aaa111\n`);
    seedState({ recorderPid: pid, eventsFile: sb.eventsFile, containerId: "cid-aaa111" });
    expect(up().status).toBe(0);
    expect(readState(sb.ws).recorderPid).toBe(pid);
    const boots = readFileSync(sb.eventsFile, "utf8").match(/^boot .*$/gm);
    expect(boots).toHaveLength(2);
    expect(boots[1]).toMatch(/cid-bbb222$/);
  });

  it("(c) dead recorder PID → exactly one new recorder with a new PID", async () => {
    sb = makeSandbox();
    const dead = spawnSleeper(60);
    process.kill(dead, "SIGKILL");
    expect(await waitDead(dead)).toBe(true);
    seedState({ recorderPid: dead, eventsFile: sb.eventsFile, containerId: "cid-aaa111" });
    expect(up().status).toBe(0);
    const state = readState(sb.ws);
    expect(state.recorderPid).not.toBe(dead);
    expect(isAlive(state.recorderPid)).toBe(true);
    expect(sb.dockerCalls().filter((c) => c.startsWith("events"))).toHaveLength(1);
  });
});

describe("faults: capture is best-effort (decision L2)", () => {
  it("(X1) `docker events` exits 1 → boot proceeds, exactly one warning, no recorderPid", () => {
    sb = makeSandbox({ FAKE_EVENTS_FAIL: "1" });
    const r = up();
    expect(r.status).toBe(0);
    expect(sb.dockerCalls().some((c) => c.startsWith("compose") && / up( |$)/.test(c))).toBe(true);
    const warnings = r.stderr.split("\n").filter((l) => l.startsWith("harness-audit:"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(WARNING);
    expect(readState(sb.ws)).not.toHaveProperty("recorderPid");
  });

  it("(X6) uncreatable $TMPDIR/pi-dash-test → boot proceeds, exactly one warning, no recorder left", () => {
    sb = makeSandbox();
    // A regular FILE where `$TMPDIR/pi-dash-test` must go: mkdir -p fails even for
    // root (CI runs as root, where chmod 555 would not block the write), while
    // TMPDIR itself stays valid for the script's own `mktemp`.
    writeFileSync(path.join(sb.tmpdir, "pi-dash-test"), "x");
    const r = up();
    expect(r.status).toBe(0);
    expect(sb.dockerCalls().some((c) => c.startsWith("compose") && / up( |$)/.test(c))).toBe(true);
    const warnings = r.stderr.split("\n").filter((l) => l.startsWith("harness-audit:"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(WARNING);
    expect(readState(sb.ws)).not.toHaveProperty("recorderPid");
    expect(sb.dockerCalls().filter((c) => c.startsWith("events"))).toEqual([]);
  });

  it("(X2) a failed `compose up` exits non-zero and leaves no live recorder", async () => {
    sb = makeSandbox({ FAKE_UP_FAIL: "1" });
    const r = up();
    expect(r.status).not.toBe(0);
    const pid = readState(sb.ws).recorderPid;
    expect(pid).toBeGreaterThan(0);
    expect(await waitDead(pid, 4000)).toBe(true);
  });

  it("(X4) the events file outlives the worktree: marker + destroy lines survive its removal", async () => {
    // The stub stream replays a create + destroy for this boot's container.
    sb = makeSandbox();
    const stream = path.join(sb.tmpdir, "stream.txt");
    writeFileSync(
      stream,
      `1 create n project=${sb.project} id=cid-aaa111\n2 destroy n project=${sb.project} id=cid-aaa111\n`,
    );
    const extra = { FAKE_EVENTS_FILE: stream, FAKE_EVENTS_LOG_FILE: sb.eventsFile };
    expect(up(extra).status).toBe(0);
    await new Promise((r) => setTimeout(r, 800)); // let the recorder drain the replayed stream
    const down = spawnSync("bash", [TEST_DOWN], { cwd: sb.ws, env: { ...sb.env, ...extra, PI_HARNESS_DESTROY_WAIT_SECS: "2" }, encoding: "utf8" });
    expect(down.status).toBe(0);
    rmSync(sb.ws, { recursive: true, force: true }); // ship-it removes the worktree right after teardown
    const body = readFileSync(sb.eventsFile, "utf8");
    expect(body).toMatch(/^teardown-begin \S+ \S+ cid-aaa111$/m);
    expect(body).toMatch(/ destroy n project=\S+ id=cid-aaa111$/m);
  });
});
