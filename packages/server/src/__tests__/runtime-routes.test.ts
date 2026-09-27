/**
 * /api/runtime/* routes. test-plan E16 (Electron-only mutations), E17 (no
 * HTTP path enables local), E18 (HTTP may turn local off), plus update /
 * activate / rollback behaviour. See change: electron-runtime-overlay-updates (D7, D10).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeRuntimeManifest } from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/manifest.mjs";
import {
  deriveEffectiveSource,
  patchRuntimeState,
  readRuntimeRequest,
  readRuntimeState,
  selectRuntimeSource,
} from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/state.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RuntimeRouteDeps, registerRuntimeRoutes } from "../routes/runtime-routes.js";

type Starter = "electron" | "standalone" | "bridge";

let dir: string;
let app: FastifyInstance;
let stage: ReturnType<typeof vi.fn>;
let checkerMock: { check: ReturnType<typeof vi.fn>; peek: ReturnType<typeof vi.fn>; invalidate: ReturnType<typeof vi.fn> };

async function build(starter: Starter, over: Partial<RuntimeRouteDeps> = {}): Promise<void> {
  stage = vi.fn(async () => ({ root: path.join(dir, "versions", "0.9.1") }));
  checkerMock = {
    check: vi.fn(async () => ({ state: "available", target: "0.9.1", active: "0.9.0", checkedAt: 1 })),
    peek: vi.fn(() => null),
    invalidate: vi.fn(),
  };
  app = Fastify({ logger: false });
  registerRuntimeRoutes(app, {
    dir,
    launchSource: () => starter,
    networkGuard: async () => {},
    checker: checkerMock as unknown as RuntimeRouteDeps["checker"],
    stage: stage as unknown as RuntimeRouteDeps["stage"],
    runtimeHealth: () => ({ origin: "bundled", id: "bundled", version: "0.9.0", updatable: starter === "electron" }),
    ...over,
  });
  await app.ready();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rt-routes-"));
});
afterEach(async () => {
  await app?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const post = (url: string, payload: unknown = {}) =>
  app.inject({ method: "POST", url, payload: payload as Record<string, unknown>, remoteAddress: "127.0.0.1" });

const MUTATIONS: Array<[string, unknown]> = [
  ["/api/runtime/source", { source: "npm" }],
  ["/api/runtime/update", { version: "0.9.1" }],
  ["/api/runtime/activate", {}],
  ["/api/runtime/rollback", { to: "bundled" }],
];

describe("Electron-only mutations (E16)", () => {
  it.each(["standalone", "bridge"] as const)("%s: every mutation is 403 and request.json untouched", async (starter) => {
    await build(starter);
    selectRuntimeSource(dir, { source: "bundled" });
    const before = fs.readFileSync(path.join(dir, "request.json"), "utf8");
    for (const [url, body] of MUTATIONS) {
      const res = await post(url, body);
      expect(res.statusCode, url).toBe(403);
      expect(res.json()).toMatchObject({ error: "runtime_electron_only" });
    }
    expect(fs.readFileSync(path.join(dir, "request.json"), "utf8")).toBe(before);
    expect(stage).not.toHaveBeenCalled();
  });

  it("electron: every mutation is accepted", async () => {
    await build("electron");
    selectRuntimeSource(dir, { source: "npm" });
    patchRuntimeState(dir, { previous: "0.9.0", current: "0.9.1" });
    for (const [url, body] of MUTATIONS) {
      const res = await post(url, body);
      expect(res.statusCode, `${url} ${res.body}`).toBeLessThan(300);
    }
  });

  it("GET status is readable on every starter", async () => {
    await build("standalone");
    const res = await app.inject({ method: "GET", url: "/api/runtime/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.runtime).toMatchObject({ updatable: false });
  });
});

describe("no HTTP path enables local (E17)", () => {
  it.each([
    [{ source: "local" }],
    [{ localPath: "/x" }],
    [{ source: "npm", localPath: "/x" }],
    [{ source: "npm", localBinding: { epoch: "e", seq: 1 } }],
  ])("POST /api/runtime/source %j → 400; state.json never written", async (body) => {
    await build("electron");
    selectRuntimeSource(dir, { source: "bundled" });
    const reqBefore = fs.readFileSync(path.join(dir, "request.json"), "utf8");
    const res = await post("/api/runtime/source", body);
    expect(res.statusCode).toBe(400);
    expect(fs.existsSync(path.join(dir, "state.json"))).toBe(false);
    expect(fs.readFileSync(path.join(dir, "request.json"), "utf8")).toBe(reqBefore);
  });

  it("rejects an invalid channel / pin", async () => {
    await build("electron");
    expect((await post("/api/runtime/source", { source: "npm", channel: "nightly" })).statusCode).toBe(400);
    expect((await post("/api/runtime/source", { source: "npm", pin: "latest" })).statusCode).toBe(400);
  });
});

describe("HTTP may turn local off (E18)", () => {
  it("local bound {E,3} → POST source bundled → seq 4, derived bundled", async () => {
    await build("electron");
    selectRuntimeSource(dir, { source: "npm" });
    selectRuntimeSource(dir, { source: "npm" });
    const req = selectRuntimeSource(dir, { source: "npm" }); // seq 3
    patchRuntimeState(dir, { localPath: "/r/co", localBinding: { epoch: req.sourceEpoch as string, seq: 3 } });
    expect(deriveEffectiveSource(readRuntimeRequest(dir), readRuntimeState(dir))).toBe("local");

    const res = await post("/api/runtime/source", { source: "bundled" });
    expect(res.statusCode).toBe(200);
    expect(readRuntimeRequest(dir)?.sourceSeq).toBe(4);
    expect(deriveEffectiveSource(readRuntimeRequest(dir), readRuntimeState(dir))).toBe("bundled");
  });
});

describe("update / activate / rollback", () => {
  it("update: only {version} accepted — any package spec is rejected (allowlist)", async () => {
    await build("electron");
    selectRuntimeSource(dir, { source: "npm" });
    expect((await post("/api/runtime/update", { packages: ["evil-pkg"] })).statusCode).toBe(400);
    expect((await post("/api/runtime/update", { version: "0.9.1 && rm -rf /" })).statusCode).toBe(400);
    expect(stage).not.toHaveBeenCalled();
  });

  it("update: needs an npm/github source; stages the checker target when no version given", async () => {
    await build("electron");
    selectRuntimeSource(dir, { source: "bundled" });
    expect((await post("/api/runtime/update", {})).statusCode).toBe(409);
    selectRuntimeSource(dir, { source: "github" });
    const res = await post("/api/runtime/update", {});
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toMatchObject({ version: "0.9.1" });
    await vi.waitFor(() => expect(stage).toHaveBeenCalledWith("0.9.1", "github", expect.any(Function)));
  });

  it("update: a second update while staging is 409", async () => {
    let release!: () => void;
    await build("electron", {
      stage: (async () => {
        await new Promise<void>((r) => {
          release = r;
        });
        return { root: "" };
      }) as unknown as RuntimeRouteDeps["stage"],
    });
    selectRuntimeSource(dir, { source: "npm" });
    expect((await post("/api/runtime/update", { version: "0.9.1" })).statusCode).toBe(202);
    expect((await post("/api/runtime/update", { version: "0.9.2" })).statusCode).toBe(409);
    release();
  });

  it("two concurrent updates (target resolution in flight) → exactly one stages, the other 409", async () => {
    let releaseCheck!: () => void;
    const slowCheck = vi.fn(
      () =>
        new Promise((r) => {
          releaseCheck = () => r({ state: "available", target: "0.9.1", active: "0.9.0", checkedAt: 1 });
        }),
    );
    await build("electron", {
      checker: { check: slowCheck, peek: vi.fn(() => null), invalidate: vi.fn() } as unknown as RuntimeRouteDeps["checker"],
    });
    selectRuntimeSource(dir, { source: "npm" });
    const a = post("/api/runtime/update", {});
    const b = post("/api/runtime/update", {});
    await vi.waitFor(() => expect(slowCheck).toHaveBeenCalled());
    releaseCheck();
    const codes = [(await a).statusCode, (await b).statusCode].sort();
    expect(codes).toEqual([202, 409]);
    await vi.waitFor(() => expect(stage).toHaveBeenCalledTimes(1));
  });

  it("staging runs under the shared exclusive lock", async () => {
    const exclusive = vi.fn(<T,>(fn: () => Promise<T>) => fn());
    await build("electron", { exclusive: exclusive as unknown as RuntimeRouteDeps["exclusive"] });
    selectRuntimeSource(dir, { source: "npm" });
    await post("/api/runtime/update", { version: "0.9.1" });
    await vi.waitFor(() => expect(exclusive).toHaveBeenCalledTimes(1));
  });

  it.each([
    ["/api/runtime/source", { source: "bundled" }],
    ["/api/runtime/rollback", { to: "bundled" }],
    ["/api/runtime/rollback", { to: "previous" }],
    ["/api/runtime/activate", {}],
  ])("%s %j while staging → 409, request.json untouched", async (url, body) => {
    let release!: () => void;
    await build("electron", {
      stage: (async () => {
        await new Promise<void>((r) => {
          release = r;
        });
        return { root: "" };
      }) as unknown as RuntimeRouteDeps["stage"],
    });
    selectRuntimeSource(dir, { source: "npm" });
    patchRuntimeState(dir, { current: "0.9.1", previous: "0.9.0" });
    expect((await post("/api/runtime/update", { version: "0.9.2" })).statusCode).toBe(202);
    const before = fs.readFileSync(path.join(dir, "request.json"), "utf8");
    const res = await post(url, body);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "staging_busy" });
    expect(fs.readFileSync(path.join(dir, "request.json"), "utf8")).toBe(before);
    release();
  });

  it("activate writes a fresh activateNonce (never state.json)", async () => {
    await build("electron");
    selectRuntimeSource(dir, { source: "npm" });
    await post("/api/runtime/activate");
    const n1 = readRuntimeRequest(dir)?.activateNonce;
    await post("/api/runtime/activate");
    const n2 = readRuntimeRequest(dir)?.activateNonce;
    expect(n1).toMatch(/^[0-9a-f-]{36}$/);
    expect(n2).not.toBe(n1);
    expect(fs.existsSync(path.join(dir, "state.json"))).toBe(false);
  });

  function installPrevious(version: string, origin: "npm" | "github"): void {
    writeRuntimeManifest(path.join(dir, "versions", version), {
      version,
      minShellVersion: "0.9.0",
      nodeEngines: ">=22",
      origin,
    });
  }

  it("rollback to an overlay previous while the source is bundled restores its origin, so Electron considers it", async () => {
    await build("electron");
    selectRuntimeSource(dir, { source: "bundled" });
    patchRuntimeState(dir, { current: "bundled", previous: "0.9.0" });
    installPrevious("0.9.0", "github");
    expect((await post("/api/runtime/rollback", { to: "previous" })).statusCode).toBe(202);
    expect(readRuntimeRequest(dir)).toMatchObject({ source: "github", pending: "0.9.0" });
    expect(deriveEffectiveSource(readRuntimeRequest(dir), readRuntimeState(dir))).toBe("github");
  });

  it("rollback to a previous that is no longer installed → 409", async () => {
    await build("electron");
    selectRuntimeSource(dir, { source: "npm" });
    patchRuntimeState(dir, { current: "0.9.1", previous: "0.9.0" });
    expect((await post("/api/runtime/rollback", { to: "previous" })).statusCode).toBe(409);
  });

  it("status uses the cached check; refresh=true forces it", async () => {
    await build("electron");
    await app.inject({ method: "GET", url: "/api/runtime/status" });
    await app.inject({ method: "GET", url: "/api/runtime/status?refresh=true" });
    expect(checkerMock.check).toHaveBeenNthCalledWith(1, { force: false });
    expect(checkerMock.check).toHaveBeenNthCalledWith(2, { force: true });
  });

  it("rollback to previous: pending = previous + nonce; to bundled: source bundled (local off) + nonce", async () => {
    await build("electron");
    selectRuntimeSource(dir, { source: "npm" });
    patchRuntimeState(dir, { current: "0.9.1", previous: "0.9.0" });
    installPrevious("0.9.0", "npm");
    expect((await post("/api/runtime/rollback", { to: "previous" })).statusCode).toBe(202);
    expect(readRuntimeRequest(dir)).toMatchObject({ pending: "0.9.0", activateNonce: expect.any(String) });

    const seq = readRuntimeRequest(dir)?.sourceSeq as number;
    expect((await post("/api/runtime/rollback", { to: "bundled" })).statusCode).toBe(202);
    expect(readRuntimeRequest(dir)).toMatchObject({ source: "bundled", sourceSeq: seq + 1 });
  });

  it("rollback to previous is refused when previous is a local checkout (HTTP cannot enable local)", async () => {
    await build("electron");
    selectRuntimeSource(dir, { source: "npm" });
    patchRuntimeState(dir, { current: "0.9.1", previous: "local:/r/co" });
    expect((await post("/api/runtime/rollback", { to: "previous" })).statusCode).toBe(409);
  });
});
