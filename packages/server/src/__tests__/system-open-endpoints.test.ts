/**
 * System-open endpoints (D9/D10): `POST /api/open-in-system` +
 * `POST /api/reveal-in-file-manager`, plus the `computeSystemOpen` capability.
 *
 * Security invariants (test-plan X9/X10/X11):
 *   - path escaping the session cwd → 403, no spawn (containment).
 *   - non-loopback OR absent Origin → 403, no spawn (absent = deny).
 *   - `systemOpen:false` → 403, no spawn.
 *   - argv is an array; a path containing a comma is one un-interpolated
 *     element (no shell).
 */
import Fastify, { type FastifyInstance } from "fastify";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerFileRoutes } from "../routes/file-routes.js";
import { computeSystemOpen } from "../system-open-capability.js";

const run = vi.fn();

function makeApp(cwd: string, opts: { capable?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => [{ cwd }] } as any,
    preferencesStore: { getPinnedDirectories: () => [] } as any,
    networkGuard: async () => undefined,
    systemOpen: {
      capable: () => opts.capable ?? true,
      run,
      platform: "darwin",
    },
  });
  return app;
}

const LOOPBACK = { origin: "http://localhost:8000" };

describe("POST /api/open-in-system + /api/reveal-in-file-manager (D10)", () => {
  let app: FastifyInstance;
  let tmp: string;

  beforeEach(async () => {
    run.mockReset();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "sysopen-"));
    await fsp.writeFile(path.join(tmp, "doc.txt"), "hi");
    app = makeApp(tmp);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("valid {cwd,path} + loopback origin → spawns opener with an argv ARRAY", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/open-in-system",
      headers: LOOPBACK,
      payload: { cwd: tmp, path: "doc.txt" },
    });
    expect(res.statusCode).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    const [cmd, args] = run.mock.calls[0];
    expect(cmd).toBe("open");
    expect(Array.isArray(args)).toBe(true);
    expect(args).toEqual([path.join(tmp, "doc.txt")]);
  });

  it("X9 path escaping cwd → 403, no spawn", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/reveal-in-file-manager",
      headers: LOOPBACK,
      payload: { cwd: tmp, path: "../../../etc/passwd" },
    });
    expect(res.statusCode).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("X10 non-loopback origin → 403, no spawn", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/open-in-system",
      headers: { origin: "http://evil.example.com" },
      payload: { cwd: tmp, path: "doc.txt" },
    });
    expect(res.statusCode).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("X10 absent origin → 403, no spawn (absent = deny)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/open-in-system",
      payload: { cwd: tmp, path: "doc.txt" },
    });
    expect(res.statusCode).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("X11 systemOpen:false → 403, no spawn", async () => {
    const incapable = makeApp(tmp, { capable: false });
    await incapable.ready();
    const res = await incapable.inject({
      method: "POST",
      url: "/api/open-in-system",
      headers: LOOPBACK,
      payload: { cwd: tmp, path: "doc.txt" },
    });
    expect(res.statusCode).toBe(403);
    expect(run).not.toHaveBeenCalled();
    await incapable.close();
  });

  it("X11 a path containing a comma is one un-interpolated argv element (no shell)", async () => {
    await fsp.writeFile(path.join(tmp, "a,b.txt"), "x");
    const res = await app.inject({
      method: "POST",
      url: "/api/reveal-in-file-manager",
      headers: LOOPBACK,
      payload: { cwd: tmp, path: "a,b.txt" },
    });
    expect(res.statusCode).toBe(200);
    const [cmd, args] = run.mock.calls[0];
    expect(cmd).toBe("open");
    // macOS reveal: ["-R", "<abs path with comma>"] — the path is ONE element.
    expect(args[0]).toBe("-R");
    expect(args[1]).toBe(path.join(tmp, "a,b.txt"));
    expect(args).toHaveLength(2);
  });
});

describe("computeSystemOpen capability (D9 / 6b.0)", () => {
  it("explicit override wins (Docker sets 0)", () => {
    expect(computeSystemOpen({ PI_DASHBOARD_SYSTEM_OPEN: "0" }, "darwin", () => false)).toBe(false);
    expect(computeSystemOpen({ PI_DASHBOARD_SYSTEM_OPEN: "1" }, "linux", () => true)).toBe(true);
  });

  it("desktop OSes default true", () => {
    expect(computeSystemOpen({}, "darwin", () => false)).toBe(true);
    expect(computeSystemOpen({}, "win32", () => false)).toBe(true);
  });

  it("Linux is false when headless (no DISPLAY) or a container", () => {
    expect(computeSystemOpen({}, "linux", () => false)).toBe(false); // no DISPLAY
    expect(computeSystemOpen({ DISPLAY: ":0" }, "linux", () => true)).toBe(false); // container
    expect(computeSystemOpen({ DISPLAY: ":0" }, "linux", () => false)).toBe(true); // desktop
  });
});
