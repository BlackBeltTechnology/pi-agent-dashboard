/**
 * `docker/harness-audit.sh` project-scoped self-termination (change:
 * add-missing-ci-legs, #451 part 1; test-plan E31/E32). Poll interval and maximum
 * lifetime are injected (PI_HARNESS_AUDIT_POLL_SECS / _MAX_SECS). `docker` is a
 * stub: `events` replays + follows $FAKE_EVENTS_FILE, `ps -q` prints $FAKE_PS_FILE.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AUDIT, isAlive, makeSandbox, sleep, waitDead } from "./harness-recorder-helpers.mjs";

let sb;
let child;
afterEach(() => {
  if (child?.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* gone */
    }
  }
  child = undefined;
  sb?.cleanup();
});

/** Start the recorder in its own process group (like a Ctrl-C'd foreground job). */
function start(args, env = {}) {
  const stream = path.join(sb.tmpdir, "stream.txt");
  const ps = path.join(sb.tmpdir, "ps.txt");
  writeFileSync(stream, "");
  writeFileSync(ps, "");
  const out = path.join(sb.tmpdir, "audit.log");
  child = spawn("bash", [AUDIT, out, ...args], {
    cwd: sb.ws,
    detached: true,
    stdio: "ignore",
    env: { ...sb.env, FAKE_EVENTS_FILE: stream, FAKE_PS_FILE: ps, ...env },
  });
  return { stream, ps, out, pid: child.pid, exited: new Promise((r) => child.on("exit", () => r(Date.now()))) };
}
const line = (action, project, id) => `1700000000 ${action} harness project=${project} id=${id}\n`;

describe("armed rule (E31)", () => {
  it("unarmed survives empty polls; a create event arms; armed + empty poll exits within one interval", async () => {
    sb = makeSandbox();
    const r = start([sb.project], { PI_HARNESS_AUDIT_POLL_SECS: "1", PI_HARNESS_AUDIT_MAX_SECS: "60" });
    await sleep(3500); // >3 empty polls, never armed
    expect(isAlive(r.pid)).toBe(true);

    appendFileSync(r.stream, line("create", sb.project, "cid-1"));
    writeFileSync(r.ps, "cid-1\n"); // container visible
    await sleep(1800); // armed by the event and by the non-empty poll
    expect(isAlive(r.pid)).toBe(true);
    expect(readFileSync(r.out, "utf8")).toMatch(new RegExp(`^boot \\S+ ${sb.project} cid-1$`, "m"));

    writeFileSync(r.ps, ""); // container gone
    const t0 = Date.now();
    const exitedAt = await Promise.race([r.exited, sleep(4000).then(() => null)]);
    expect(exitedAt, "armed recorder did not exit after the container vanished").not.toBeNull();
    expect(exitedAt - t0).toBeLessThan(2500); // <= one 1 s interval (+ slack)
  }, 20_000);

  it("a non-empty poll alone also arms (a missed create event)", async () => {
    sb = makeSandbox();
    const r = start([sb.project], { PI_HARNESS_AUDIT_POLL_SECS: "1", PI_HARNESS_AUDIT_MAX_SECS: "60" });
    writeFileSync(r.ps, "cid-9\n");
    await sleep(1800);
    writeFileSync(r.ps, "");
    expect(await Promise.race([r.exited, sleep(3500).then(() => null)])).not.toBeNull();
  }, 15_000);

  it("never armed: exits at the maximum lifetime (±1 s)", async () => {
    sb = makeSandbox();
    const t0 = Date.now();
    const r = start([sb.project], { PI_HARNESS_AUDIT_POLL_SECS: "1", PI_HARNESS_AUDIT_MAX_SECS: "4" });
    const exitedAt = await Promise.race([r.exited, sleep(8000).then(() => null)]);
    expect(exitedAt).not.toBeNull();
    expect(exitedAt - t0).toBeGreaterThanOrEqual(3500);
    expect(exitedAt - t0).toBeLessThan(5600);
  }, 15_000);

  it("another project's events neither arm nor get recorded", async () => {
    sb = makeSandbox();
    const r = start([sb.project], { PI_HARNESS_AUDIT_POLL_SECS: "1", PI_HARNESS_AUDIT_MAX_SECS: "60" });
    appendFileSync(r.stream, line("create", "pi-dash-test-1111111111", "cid-foreign"));
    appendFileSync(r.stream, line("destroy", "pi-dash-test-1111111111", "cid-foreign"));
    await sleep(3000); // unarmed + empty polls: it must still be alive (a foreign create did not arm it)
    expect(isAlive(r.pid)).toBe(true);
    const body = existsSync(r.out) ? readFileSync(r.out, "utf8") : "";
    expect(body).not.toContain("cid-foreign");
  }, 15_000);

  it("an events stream that cannot be opened ends the recorder at once (no linger)", async () => {
    sb = makeSandbox();
    const r = start([sb.project], { FAKE_EVENTS_FAIL: "1", PI_HARNESS_AUDIT_POLL_SECS: "30", PI_HARNESS_AUDIT_MAX_SECS: "60" });
    expect(await Promise.race([r.exited, sleep(3000).then(() => null)])).not.toBeNull();
  }, 10_000);
});

describe("unscoped manual mode is unchanged (E32)", () => {
  it("keeps running with no harness containers, records nothing, exits on SIGINT", async () => {
    sb = makeSandbox();
    const r = start([], { PI_HARNESS_AUDIT_POLL_SECS: "1", PI_HARNESS_AUDIT_MAX_SECS: "1" });
    await sleep(3200); // three 1 s intervals — a scoped recorder would already be gone
    expect(isAlive(r.pid)).toBe(true);
    expect(existsSync(r.out) ? readFileSync(r.out, "utf8") : "").toBe("");
    process.kill(-r.pid, "SIGINT"); // Ctrl-C reaches the whole foreground group
    expect(await waitDead(r.pid, 4000)).toBe(true);
  }, 15_000);
});
