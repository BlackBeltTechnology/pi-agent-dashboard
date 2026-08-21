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
    await expect(bind({ probe: async () => "indeterminate" })).rejects.toBeInstanceOf(
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

    // A dead socket file refuses connections, which is INDETERMINATE on its
    // own (a saturated live listener refuses identically) — so the real probe
    // correctly declines to authorise the unlink…
    await expect(probeSocket(sockPath)).resolves.toBe("indeterminate");
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
