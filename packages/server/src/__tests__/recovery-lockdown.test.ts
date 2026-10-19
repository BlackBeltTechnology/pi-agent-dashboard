/**
 * Recovery server lockdown (B9): loopback bind by default + gated mutating
 * actions. `node:child_process.spawn` is mocked so no `npm install` ever runs.
 *
 * See change: harden-server-capability-bounds (test-plan T4).
 */
import { EventEmitter } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: spawnMock };
});

import { isRecoveryActionAllowed, startRecoveryServer } from "../lifecycle/recovery-server.js";

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; unref: () => void };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.unref = () => undefined;
  queueMicrotask(() => child.emit("exit", 0));
  return child;
}

function post(
  port: number,
  urlPath: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method: "POST", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("isRecoveryActionAllowed (pure gate)", () => {
  const ok = { remoteAddress: "127.0.0.1", headers: { host: "localhost:8000" } };

  it("allows a loopback caller with a loopback Host and no Origin", () => {
    expect(isRecoveryActionAllowed(ok, null)).toBe(true);
    expect(isRecoveryActionAllowed({ ...ok, remoteAddress: "::1" }, null)).toBe(true);
    expect(isRecoveryActionAllowed({ ...ok, remoteAddress: "::ffff:127.0.0.1" }, null)).toBe(true);
  });

  it("allows a loopback Origin (the recovery page's own fetch)", () => {
    expect(isRecoveryActionAllowed({ ...ok, headers: { ...ok.headers, origin: "http://localhost:8000" } }, null)).toBe(true);
  });

  it("rejects a non-loopback remote address", () => {
    expect(isRecoveryActionAllowed({ ...ok, remoteAddress: "192.168.1.20" }, null)).toBe(false);
    expect(isRecoveryActionAllowed({ ...ok, remoteAddress: undefined }, null)).toBe(false);
  });

  it("rejects a cross-site Origin (browser CSRF against localhost)", () => {
    expect(isRecoveryActionAllowed({ ...ok, headers: { ...ok.headers, origin: "https://evil.example" } }, null)).toBe(false);
  });

  it("rejects a non-loopback Host (DNS rebinding / tunnel forwarding from loopback)", () => {
    expect(isRecoveryActionAllowed({ remoteAddress: "127.0.0.1", headers: { host: "abc.share.zrok.io" } }, null)).toBe(false);
    expect(isRecoveryActionAllowed({ remoteAddress: "127.0.0.1", headers: {} }, null)).toBe(false);
  });

  it("accepts a remote caller presenting the correct local token, rejects a wrong or absent one", () => {
    const remote = { remoteAddress: "10.0.0.9", headers: { host: "dash.lan:8000" } };
    expect(isRecoveryActionAllowed({ ...remote, headers: { ...remote.headers, "x-pi-local-token": "s3cret" } }, "s3cret")).toBe(true);
    expect(isRecoveryActionAllowed({ ...remote, headers: { ...remote.headers, "x-pi-local-token": "nope" } }, "s3cret")).toBe(false);
    expect(isRecoveryActionAllowed(remote, "s3cret")).toBe(false);
    // no server-side token configured → a presented header can never match
    expect(isRecoveryActionAllowed({ ...remote, headers: { ...remote.headers, "x-pi-local-token": "" } }, null)).toBe(false);
  });
});

describe("recovery server lockdown (integration)", () => {
  let createServerSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeChild());
    createServerSpy = vi.spyOn(http, "createServer");
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(async () => {
    for (const result of createServerSpy.mock.results) {
      const server = result.type === "return" ? (result.value as http.Server) : undefined;
      if (!server?.close) continue;
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    }
    vi.restoreAllMocks();
  });

  const start = (extra: Record<string, unknown> = {}) =>
    startRecoveryServer({ port: 0, error: new Error("Cannot find module 'fastify'"), missingModule: "fastify", ...extra });
  const boundAddress = () =>
    (createServerSpy.mock.results[0].value as http.Server).address() as AddressInfo;

  it("binds loopback only by default — not 0.0.0.0 / ::", async () => {
    await start();
    expect(boundAddress().address).toBe("127.0.0.1");
  });

  it("binds the configured host when one is given", async () => {
    await start({ host: "::1" }).catch(() => undefined);
    // ::1 may be unavailable on some CI hosts; when it binds, it must be the configured one.
    const server = createServerSpy.mock.results[0]?.value as http.Server | undefined;
    const addr = server?.address() as AddressInfo | null;
    if (addr) expect(addr.address).toBe("::1");
  });

  it("refuses reinstall with a cross-origin request and never spawns npm", async () => {
    const port = await start();
    const res = await post(port, "/api/recovery/reinstall", { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("refuses reinstall with a non-loopback Host header and never spawns npm", async () => {
    const port = await start();
    const res = await post(port, "/api/recovery/reinstall", { host: "tunnel.example.com" });
    expect(res.status).toBe(403);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("refuses retry from a non-loopback origin and does not respawn or exit", async () => {
    const port = await start();
    const res = await post(port, "/api/recovery/retry", { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(spawnMock).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 350));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("loopback retry proceeds (respawns the CLI and schedules exit)", async () => {
    const port = await start();
    const res = await post(port, "/api/recovery/retry");
    expect(res.status).toBe(200);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][0]).toBe(process.execPath);
    await new Promise((r) => setTimeout(r, 350));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("loopback reinstall proceeds", async () => {
    const port = await start();
    const res = await post(port, "/api/recovery/reinstall");
    expect(res.status).toBe(200);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("the read-only routes stay open (status page + health)", async () => {
    const port = await start();
    const get = (p: string) =>
      new Promise<number>((resolve, reject) =>
        http.get({ host: "127.0.0.1", port, path: p, headers: { origin: "https://evil.example" } }, (r) => {
          r.resume();
          resolve(r.statusCode ?? 0);
        }).on("error", reject),
      );
    expect(await get("/")).toBe(200);
    expect(await get("/api/health")).toBe(200);
  });
});
