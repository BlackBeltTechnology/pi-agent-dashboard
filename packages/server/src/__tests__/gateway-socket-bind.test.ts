/**
 * A live gateway socket is NEVER unlinked (D9, defect B3).
 *
 * (test-plan #X1, #X2, #X3, #E18)
 * See change: add-pi-gateway-transport-identity.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import type http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { processStartedAt } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindGatewaySocket,
  GatewaySocketConflictError,
  probeSocket,
  unbindGatewaySocket,
} from "../pi/gateway-socket-bind.js";

let tmp: string;
let sockPath: string;
const opened: http.Server[] = [];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-gw-sock-"));
  sockPath = path.join(tmp, "gateway-9999.sock");
});

afterEach(async () => {
  for (const s of opened.splice(0)) {
    await new Promise<void>((r) => s.close(() => r()));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * A REAL crash leftover: a child binds the path, then is SIGKILLed so libuv's
 * close-time unlink never runs. Leaves a socket inode with no listener.
 */
async function makeStaleSocket(p = sockPath): Promise<void> {
  const child = spawn(process.execPath, [
    "-e",
    `require('net').createServer().listen(${JSON.stringify(p)},()=>console.log('up'))`,
  ]);
  await new Promise<void>((resolve, reject) => {
    child.stdout.once("data", () => resolve());
    child.once("error", reject);
  });
  child.kill("SIGKILL");
  await new Promise<void>((r) => child.once("exit", () => r()));
  expect(fs.lstatSync(p).isSocket()).toBe(true);
}

/** A live unrelated process, started AFTER the call. Caller kills it. */
function liveSleeper(): { pid: number; kill: () => void } {
  const c = spawn("sleep", ["60"], { stdio: "ignore" });
  return { pid: c.pid as number, kill: () => c.kill("SIGKILL") };
}

const bind = async (over: Partial<Parameters<typeof bindGatewaySocket>[0]> = {}) => {
  const s = await bindGatewaySocket({ socketPath: sockPath, ...over });
  opened.push(s);
  return s;
};

describe("bindGatewaySocket", () => {
  it("binds a fresh path and serves on it", async () => {
    const server = await bind();
    expect(server.listening).toBe(true);
    expect(fs.statSync(sockPath).isSocket()).toBe(true);
  });

  // (test-plan #E18) Local authorisation IS the file mode (D5).
  it("leaves the socket 0600 in a 0700 dir", async () => {
    await bind();
    expect(fs.statSync(sockPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(sockPath)).mode & 0o777).toBe(0o700);
  });

  // (test-plan #X1) The headline invariant: an incumbent keeps serving.
  it("aborts with a conflict when a live listener holds the path, leaving it bound", async () => {
    const incumbent = await bind();
    const before = fs.statSync(sockPath).ino;

    await expect(bind()).rejects.toBeInstanceOf(GatewaySocketConflictError);

    // The incumbent is undisturbed: same inode, still listening, still serving.
    expect(fs.statSync(sockPath).ino).toBe(before);
    expect(incumbent.listening).toBe(true);
    await expect(probeSocket(sockPath)).resolves.toBe("live");
  });

  it("names the conflicting path in the error", async () => {
    await bind();
    await expect(bind()).rejects.toThrow(sockPath);
  });

  // (test-plan #X3) ECONNREFUSED is ambiguous — a saturated backlog answers the
  // same way a leftover file does, so "refused" alone may NOT authorise an
  // unlink. Fail closed.
  it("fails closed on an indeterminate probe and does NOT remove the path", async () => {
    fs.writeFileSync(sockPath, ""); // a path that exists but is not a live socket
    const before = fs.statSync(sockPath).ino;
    await expect(bind({ probe: async () => "refused" })).rejects.toBeInstanceOf(
      GatewaySocketConflictError,
    );
    expect(fs.existsSync(sockPath)).toBe(true);
    expect(fs.statSync(sockPath).ino).toBe(before);
  });

  it("unlinks and rebinds a leftover socket proven to have no listener", async () => {
    // A real crash leftover: a child binds the path, then is SIGKILLed, so
    // Node's own close-time unlink never runs and the file survives.
    const child = spawn(process.execPath, [
      "-e",
      `require('net').createServer().listen(${JSON.stringify(sockPath)},()=>console.log('up'))`,
    ]);
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", () => resolve());
      child.once("error", reject);
    });
    child.kill("SIGKILL");
    await new Promise<void>((r) => child.once("exit", () => r()));
    expect(fs.existsSync(sockPath)).toBe(true);
    const staleIno = fs.statSync(sockPath).ino;

    // A dead socket file REFUSES connections — which a saturated live listener
    // also does, so a refusal alone still does not authorise the unlink; only
    // a refusal plus a provably-dead recorded owner does.
    await expect(probeSocket(sockPath)).resolves.toBe("refused");
    await expect(bind()).rejects.toBeInstanceOf(GatewaySocketConflictError);
    expect(fs.statSync(sockPath).ino).toBe(staleIno);

    // …and only a probe that positively proves "no listener" unlinks it.
    const server = await bind({ probe: async () => "no-listener" });
    expect(server.listening).toBe(true);
    // Asserted on BEHAVIOUR, not on the inode: Linux tmpfs happily reuses the
    // inode number it just freed, so `ino !== staleIno` failed on CI even
    // though the reclaim had worked. What matters is that the path now SERVES
    // where a moment ago it refused.
    await expect(probeSocket(sockPath)).resolves.toBe("live");
  });

  // (test-plan #X2) Concurrency: exactly one binds, and no live socket dies.
  it("serializes a race so exactly one binds and the other gets a conflict", async () => {
    const results = await Promise.allSettled([bind(), bind()]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(GatewaySocketConflictError);
    // The winner is still the one bound at the path.
    await expect(probeSocket(sockPath)).resolves.toBe("live");
  });
});

describe("probeSocket", () => {
  it("reports no-listener for a path that does not exist", async () => {
    await expect(probeSocket(path.join(tmp, "absent.sock"))).resolves.toBe("no-listener");
  });
  it("reports live for a bound socket", async () => {
    await bind();
    await expect(probeSocket(sockPath)).resolves.toBe("live");
  });
});

describe("unbindGatewaySocket", () => {
  it("closes the listener and removes the path", async () => {
    const server = await bind();
    opened.pop();
    await unbindGatewaySocket(server, sockPath);
    expect(fs.existsSync(sockPath)).toBe(false);
  });

  // Task 2.5: stop() must be idempotent w.r.t. a missing file.
  it("is idempotent when the path is already gone", async () => {
    const server = await bind();
    opened.pop();
    await unbindGatewaySocket(server, sockPath);
    await expect(unbindGatewaySocket(null, sockPath)).resolves.toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Stale-socket reclamation via the pidfile liveness discriminator.
//
// Without it, a SIGKILLed dashboard leaves a socket file that can NEVER be
// reclaimed: `probeSocket` answers `no-listener` only on ENOENT, but the
// unlink branch runs only when the file EXISTS — mutually exclusive, so with
// the real probe the unlink is unreachable and startup fails forever until a
// human removes the path. (@review finding 1; D9 amendment.)
// ──────────────────────────────────────────────────────────────────────────
describe("stale-socket reclamation (pidfile discriminator)", () => {
  it("records our own pid alongside the socket after a successful bind", async () => {
    await bind();
    expect(fs.readFileSync(`${sockPath}.pid`, "utf8").trim().split(" ")[0]).toBe(String(process.pid));
  });

  it("reclaims a leftover socket whose recorded pid is provably dead", async () => {
    // A real SIGKILL leaves exactly this on disk: a socket file, a pidfile,
    // and no listener. The probe alone cannot tell it from a saturated one.
    await makeStaleSocket();
    fs.writeFileSync(`${sockPath}.pid`, "2147483646\n"); // never a live pid
    const server = await bind({ probe: async () => "refused" });
    expect(server.listening).toBe(true);
    expect(fs.statSync(sockPath).isSocket()).toBe(true);
  });

  // Rewritten for D1.4: the old fixture recorded `process.pid`, which is now
  // (correctly) reclaimed when nothing in this process serves the path.
  it("still refuses when the recorded pid is an alive, older, unrelated process", async () => {
    await makeStaleSocket();
    // A live process that predates the pidfile (legacy bare pid, D1.3).
    const c = liveSleeper();
    try {
      fs.writeFileSync(`${sockPath}.pid`, `${c.pid}\n`);
      await expect(bind({ probe: async () => "refused" })).rejects.toBeInstanceOf(
        GatewaySocketConflictError,
      );
      expect(fs.existsSync(sockPath)).toBe(true);
    } finally {
      c.kill();
    }
  });

  it("still refuses when there is no pidfile to prove death", async () => {
    await makeStaleSocket();
    await expect(bind({ probe: async () => "refused" })).rejects.toBeInstanceOf(
      GatewaySocketConflictError,
    );
    expect(fs.existsSync(sockPath)).toBe(true);
  });

  it("never reclaims on a LIVE probe, even with a dead pid recorded", async () => {
    // The probe is authoritative when it is unambiguous; the pidfile only
    // resolves the ambiguous case. A recycled/incorrect pidfile must not be
    // able to authorise unlinking a socket something is answering on.
    await makeStaleSocket();
    fs.writeFileSync(`${sockPath}.pid`, "2147483646\n");
    await expect(bind({ probe: async () => "live" })).rejects.toBeInstanceOf(
      GatewaySocketConflictError,
    );
    expect(fs.existsSync(sockPath)).toBe(true);
  });

  it("removes the pidfile on unbind", async () => {
    const server = await bind();
    opened.length = 0;
    await unbindGatewaySocket(server, sockPath);
    expect(fs.existsSync(`${sockPath}.pid`)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// (@review Audit, major) The pidfile must not become a live-socket takeover
// primitive. `indeterminate` covered BOTH "refused, so probably stale" and
// "timed out, so possibly a live listener with a saturated backlog". A
// same-uid process (every pi session shares the uid and the 0700 dir) could
// plant a dead pid, load the incumbent's backlog until the probe times out,
// and legitimately unlink a LIVE socket.
//
// A timeout is therefore its own verdict and NEVER authorises an unlink,
// whatever the pidfile says.
// ──────────────────────────────────────────────────────────────────────────
describe("a saturated live listener is not a stale socket", () => {
  it("refuses to unlink on a probe TIMEOUT even with a dead pid recorded", async () => {
    await makeStaleSocket();
    fs.writeFileSync(`${sockPath}.pid`, "2147483646\n");
    await expect(bind({ probe: async () => "timeout" })).rejects.toBeInstanceOf(
      GatewaySocketConflictError,
    );
    expect(fs.existsSync(sockPath)).toBe(true);
  });

  it("still reclaims on a REFUSED probe with a dead pid recorded", async () => {
    await makeStaleSocket();
    fs.writeFileSync(`${sockPath}.pid`, "2147483646\n");
    const server = await bind({ probe: async () => "refused" });
    expect(server.listening).toBe(true);
  });

  it("never treats a non-socket path as proof of staleness", async () => {
    // The errno here is PLATFORM-DEPENDENT and this test originally encoded
    // macOS: darwin answers ENOTSOCK (indeterminate), Linux answers
    // ECONNREFUSED (refused). Pinning one spelling made CI red on the other.
    fs.writeFileSync(sockPath, "");
    const verdict = await probeSocket(sockPath);
    expect(["indeterminate", "refused"]).toContain(verdict);
    expect(verdict).not.toBe("no-listener");

    // The invariant that actually matters is identical on both platforms: a
    // non-socket is never reclaimed without a provably-dead recorded owner.
    await expect(bind()).rejects.toBeInstanceOf(GatewaySocketConflictError);
    expect(fs.existsSync(sockPath)).toBe(true);
  });

  it("does not follow a symlink when recording the owner pid", async () => {
    const elsewhere = path.join(tmp, "victim");
    fs.writeFileSync(elsewhere, "do-not-clobber");
    fs.symlinkSync(elsewhere, `${sockPath}.pid`);
    await bind();
    expect(fs.readFileSync(elsewhere, "utf8")).toBe("do-not-clobber");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// fix-gateway-socket-stale-owner: a recycled pid must not wedge the path
// (#744), and a refusal alone / a non-socket / a live own listener never
// authorise an unlink. (test-plan #E1–#E8, #X10–#X13)
// ──────────────────────────────────────────────────────────────────────────
describe("owner start time (D1) and socket-inode gate (D2)", () => {
  const sleepers: Array<{ kill: () => void }> = [];
  afterEach(() => {
    for (const c of sleepers.splice(0)) c.kill();
  });
  const sleeper = () => {
    const c = liveSleeper();
    sleepers.push(c);
    return c;
  };
  const refused = { probe: async () => "refused" as const };
  const startOf = (pid: number) => {
    const t = processStartedAt(pid);
    expect(t).not.toBeNull();
    return t as number;
  };

  // E1
  it("reclaims when the recorded pid is alive but started at a different time", async () => {
    await makeStaleSocket();
    const c = sleeper();
    fs.writeFileSync(`${sockPath}.pid`, `${c.pid} ${startOf(c.pid) - 60_000}\n`);
    const server = await bind(refused);
    expect(server.listening).toBe(true);
    expect(fs.readFileSync(`${sockPath}.pid`, "utf8")).toMatch(new RegExp(`^${process.pid} \\d+\\n$`));
  });

  // E2 / E3 — the 2 s slack boundary
  it("fails closed when the start time differs by less than the slack (+1500 ms)", async () => {
    await makeStaleSocket();
    const ino = fs.lstatSync(sockPath).ino;
    const c = sleeper();
    fs.writeFileSync(`${sockPath}.pid`, `${c.pid} ${startOf(c.pid) + 1500}\n`);
    await expect(bind(refused)).rejects.toBeInstanceOf(GatewaySocketConflictError);
    expect(fs.lstatSync(sockPath).ino).toBe(ino);
  });
  it("reclaims when the start time differs by more than the slack (+2500 ms)", async () => {
    await makeStaleSocket();
    const c = sleeper();
    fs.writeFileSync(`${sockPath}.pid`, `${c.pid} ${startOf(c.pid) + 2500}\n`);
    const server = await bind(refused);
    expect(server.listening).toBe(true);
  });

  // E4 — legacy bare pid, decided against the pidfile mtime
  it("legacy bare pid: reclaims a pid started after the pidfile, refuses one started before", async () => {
    await makeStaleSocket();
    const c = sleeper();
    fs.writeFileSync(`${sockPath}.pid`, `${c.pid}\n`);
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(`${sockPath}.pid`, past, past);
    const server = await bind(refused); // (a) pid started after mtime + 2 s
    expect(server.listening).toBe(true);
    await unbindGatewaySocket(server, sockPath);
    opened.length = 0;

    await makeStaleSocket();
    const d = sleeper();
    fs.writeFileSync(`${sockPath}.pid`, `${d.pid}\n`);
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(`${sockPath}.pid`, future, future);
    await expect(bind(refused)).rejects.toBeInstanceOf(GatewaySocketConflictError); // (b)
    expect(fs.lstatSync(sockPath).isSocket()).toBe(true);
  });

  // E5 — #744's own-pid collision
  it("reclaims when the pidfile names this very process and nothing here serves the path", async () => {
    await makeStaleSocket();
    fs.writeFileSync(`${sockPath}.pid`, `${process.pid}\n`);
    const server = await bind(refused);
    expect(server.listening).toBe(true);
  });
  it("refuses when the pidfile names this process and this process serves the path", async () => {
    const incumbent = await bind();
    await expect(bind(refused)).rejects.toBeInstanceOf(GatewaySocketConflictError);
    await expect(probeSocket(sockPath)).resolves.toBe("live");
    expect(incumbent.listening).toBe(true);
  });

  // E6 — unprovable inputs fail closed
  it.each([
    ["missing pidfile", null],
    ["empty pidfile", ""],
    ["unparseable pid", "abc\n"],
  ])("fails closed on %s", async (_n, content) => {
    await makeStaleSocket();
    if (content !== null) fs.writeFileSync(`${sockPath}.pid`, content);
    await expect(bind(refused)).rejects.toBeInstanceOf(GatewaySocketConflictError);
    expect(fs.lstatSync(sockPath).isSocket()).toBe(true);
  });
  it("fails closed on a malformed second field and on an unavailable start time", async () => {
    await makeStaleSocket();
    const c = sleeper();
    fs.writeFileSync(`${sockPath}.pid`, `${c.pid} abc\n`);
    await expect(bind(refused)).rejects.toBeInstanceOf(GatewaySocketConflictError);
    fs.writeFileSync(`${sockPath}.pid`, `${c.pid} 1\n`);
    await expect(bind({ ...refused, startedAt: () => null })).rejects.toBeInstanceOf(
      GatewaySocketConflictError,
    );
    expect(fs.lstatSync(sockPath).isSocket()).toBe(true);
  });

  // Review B1/B2: malformed or unrepresentable records never authorise an unlink.
  it.each([
    ["own pid with a malformed start field", () => `${process.pid} abc\n`],
    ["own pid with three fields", () => `${process.pid} 1 2\n`],
    ["dead pid with a malformed start field", () => "2147483646 abc\n"],
    ["oversized pid", () => `${"9".repeat(400)}\n`],
    ["unsafe-integer pid", () => `${Number.MAX_SAFE_INTEGER + 2}\n`],
    ["oversized start time", () => `${sleeper().pid} ${"9".repeat(400)}\n`],
    ["unsafe-integer start time", () => `${sleeper().pid} ${Number.MAX_SAFE_INTEGER + 2}\n`],
  ])("fails closed on %s", async (_n, content) => {
    await makeStaleSocket();
    fs.writeFileSync(`${sockPath}.pid`, content());
    await expect(bind(refused)).rejects.toBeInstanceOf(GatewaySocketConflictError);
    expect(fs.lstatSync(sockPath).isSocket()).toBe(true);
  });

  // E7 — a non-socket is never removed, even with a dead owner recorded
  it("never removes a regular file, a symlink, or a dangling symlink", async () => {
    const cases: Array<[string, () => Promise<void> | void]> = [
      ["file", () => fs.writeFileSync(sockPath, "")],
      [
        "symlink-to-stale-socket",
        async () => {
          const real = path.join(tmp, "real.sock");
          await makeStaleSocket(real);
          fs.symlinkSync(real, sockPath);
        },
      ],
      ["dangling", () => fs.symlinkSync(path.join(tmp, "nowhere"), sockPath)],
    ];
    for (const [, setup] of cases) {
      fs.rmSync(sockPath, { force: true });
      await setup();
      fs.writeFileSync(`${sockPath}.pid`, "2147483646\n");
      const before = fs.lstatSync(sockPath);
      await expect(bind()).rejects.toBeInstanceOf(GatewaySocketConflictError);
      const after = fs.lstatSync(sockPath);
      expect(after.isSocket()).toBe(before.isSocket());
      expect(after.isSymbolicLink()).toBe(before.isSymbolicLink());
    }
  });

  // E8 — record format
  it("records '<pid> <startMs>' when the start time is known, bare pid otherwise", async () => {
    const s1 = await bind({ startedAt: () => 1234567 });
    expect(fs.readFileSync(`${sockPath}.pid`, "utf8")).toBe(`${process.pid} 1234567\n`);
    expect(fs.statSync(`${sockPath}.pid`).mode & 0o777).toBe(0o600);
    await unbindGatewaySocket(s1, sockPath);
    opened.length = 0;
    await bind({ startedAt: () => null });
    expect(fs.readFileSync(`${sockPath}.pid`, "utf8")).toBe(`${process.pid}\n`);
  });
});

describe("ownership-checked unbind and pidfile failures (D4)", () => {
  // X10
  it("a stopping dashboard does not remove its successor's socket", async () => {
    const a = await bind();
    opened.length = 0;
    await new Promise<void>((r) => a.close(() => r())); // libuv unlinks P
    const b = await bind(); // successor binds in the window, writes its pidfile
    await unbindGatewaySocket(a, sockPath);
    await expect(probeSocket(sockPath)).resolves.toBe("live");
    expect(fs.readFileSync(`${sockPath}.pid`, "utf8")).toMatch(new RegExp(`^${process.pid}\\b`));
    expect(fs.existsSync(`${sockPath}.lock`)).toBe(true);
    expect(b.listening).toBe(true);
  });

  // Review r2 B1: owned-only removal also means socket-only removal.
  it("unbind never removes a non-socket that replaced the path after close", async () => {
    const a = await bind();
    opened.length = 0;
    await new Promise<void>((r) => a.close(() => r())); // libuv unlinks P; pidfile still names us
    fs.writeFileSync(sockPath, "not a socket");
    const link = path.join(tmp, "elsewhere");
    await unbindGatewaySocket(a, sockPath);
    expect(fs.readFileSync(sockPath, "utf8")).toBe("not a socket");

    fs.rmSync(sockPath);
    fs.writeFileSync(link, "target");
    fs.symlinkSync(link, sockPath);
    fs.writeFileSync(`${sockPath}.pid`, `${process.pid}\n`);
    await unbindGatewaySocket(null, sockPath);
    expect(fs.lstatSync(sockPath).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(link, "utf8")).toBe("target");
  });

  // Review r3 B1: a replacement SOCKET with our stale pidfile still in place.
  it("unbind never removes a different socket that replaced the path after close", async () => {
    const a = await bind();
    opened.length = 0;
    await new Promise<void>((r) => a.close(() => r())); // libuv unlinks P; pidfile still names us
    const rogue = net.createServer().listen(sockPath);
    await new Promise<void>((r) => rogue.once("listening", () => r()));
    try {
      await unbindGatewaySocket(a, sockPath);
      await expect(probeSocket(sockPath)).resolves.toBe("live");
    } finally {
      await new Promise<void>((r) => rogue.close(() => r()));
    }
  });

  // X11
  it("rebinding the same path in one process works (restart)", async () => {
    const first = await bind();
    opened.length = 0;
    await unbindGatewaySocket(first, sockPath);
    const second = await bind();
    expect(second.listening).toBe(true);
  });

  // X12
  it("logs a warning naming the pidfile when it cannot be written", async () => {
    fs.mkdirSync(`${sockPath}.pid`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const server = await bind();
      expect(server.listening).toBe(true);
      expect(warn.mock.calls.some((c) => String(c[0]).includes(`${sockPath}.pid`))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  // X13
  it("a saturated-looking live own listener is never reclaimed (macOS refusal)", async () => {
    const incumbent = await bind();
    expect(fs.readFileSync(`${sockPath}.pid`, "utf8")).toMatch(/^\d+ \d+\n$/);
    await expect(bind({ probe: async () => "refused" })).rejects.toBeInstanceOf(
      GatewaySocketConflictError,
    );
    expect(incumbent.listening).toBe(true);
    await expect(probeSocket(sockPath)).resolves.toBe("live");
  });
});
