/**
 * A live gateway socket is NEVER unlinked (D9, defect B3).
 *
 * (test-plan #X1, #X2, #X3, #E18)
 * See change: add-pi-gateway-transport-identity.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    expect(fs.statSync(sockPath).ino).not.toBe(staleIno);
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
    expect(fs.readFileSync(`${sockPath}.pid`, "utf8").trim()).toBe(String(process.pid));
  });

  it("reclaims a leftover socket whose recorded pid is provably dead", async () => {
    // A real SIGKILL leaves exactly this on disk: a socket file, a pidfile,
    // and no listener. The probe alone cannot tell it from a saturated one.
    fs.writeFileSync(sockPath, "");
    fs.writeFileSync(`${sockPath}.pid`, "2147483646\n"); // never a live pid
    const server = await bind({ probe: async () => "refused" });
    expect(server.listening).toBe(true);
    expect(fs.statSync(sockPath).isSocket()).toBe(true);
  });

  it("still refuses when the recorded pid is alive", async () => {
    fs.writeFileSync(sockPath, "");
    fs.writeFileSync(`${sockPath}.pid`, `${process.pid}\n`);
    await expect(bind({ probe: async () => "refused" })).rejects.toBeInstanceOf(
      GatewaySocketConflictError,
    );
    expect(fs.existsSync(sockPath)).toBe(true);
  });

  it("still refuses when there is no pidfile to prove death", async () => {
    fs.writeFileSync(sockPath, "");
    await expect(bind({ probe: async () => "refused" })).rejects.toBeInstanceOf(
      GatewaySocketConflictError,
    );
    expect(fs.existsSync(sockPath)).toBe(true);
  });

  it("never reclaims on a LIVE probe, even with a dead pid recorded", async () => {
    // The probe is authoritative when it is unambiguous; the pidfile only
    // resolves the ambiguous case. A recycled/incorrect pidfile must not be
    // able to authorise unlinking a socket something is answering on.
    fs.writeFileSync(sockPath, "");
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
    fs.writeFileSync(sockPath, "");
    fs.writeFileSync(`${sockPath}.pid`, "2147483646\n");
    await expect(bind({ probe: async () => "timeout" })).rejects.toBeInstanceOf(
      GatewaySocketConflictError,
    );
    expect(fs.existsSync(sockPath)).toBe(true);
  });

  it("still reclaims on a REFUSED probe with a dead pid recorded", async () => {
    fs.writeFileSync(sockPath, "");
    fs.writeFileSync(`${sockPath}.pid`, "2147483646\n");
    const server = await bind({ probe: async () => "refused" });
    expect(server.listening).toBe(true);
  });

  it("reports a non-socket path as indeterminate, not as a refusal", async () => {
    // A plain file is not a socket (ENOTSOCK): unknown, so fail closed. Only
    // a genuine leftover SOCKET answers ECONNREFUSED — asserted above against
    // a real SIGKILLed listener.
    fs.writeFileSync(sockPath, "");
    await expect(probeSocket(sockPath)).resolves.toBe("indeterminate");
  });

  it("does not follow a symlink when recording the owner pid", async () => {
    const elsewhere = path.join(tmp, "victim");
    fs.writeFileSync(elsewhere, "do-not-clobber");
    fs.symlinkSync(elsewhere, `${sockPath}.pid`);
    await bind();
    expect(fs.readFileSync(elsewhere, "utf8")).toBe("do-not-clobber");
  });
});
