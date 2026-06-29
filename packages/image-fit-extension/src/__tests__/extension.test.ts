/**
 * Integration tests for the tool_call hook.
 *
 * Pattern: build a fake ExtensionAPI that captures registered handlers,
 * then drive synthetic events. Mirrors
 * packages/extension/src/__tests__/provider-register-reload.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Jimp } from "jimp";
import imageFitExtension from "../extension.js";
import { ROOT_DIR } from "../cache.js";

type Handler = (event: any, ctx: any) => unknown;

interface FakePi {
  handlers: Map<string, Handler>;
  on: (event: string, handler: Handler) => void;
  fire(event: string, ev: any, ctx?: any): Promise<unknown>;
}

function makeFakePi(): FakePi {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    on(event, handler) {
      handlers.set(event, handler);
    },
    async fire(event, ev, ctx = {}) {
      const h = handlers.get(event);
      if (!h) throw new Error(`no handler for ${event}`);
      return await h(ev, ctx);
    },
  };
}

function makeReadEvent(p: string) {
  // Matches the documented shape of ReadToolCallEvent.
  return { toolName: "read", toolCallId: "tc-1", input: { path: p } };
}

function makeBashEvent(cmd: string) {
  return { toolName: "bash", toolCallId: "tc-2", input: { command: cmd } };
}

function makeCtx(sessionId = `vitest-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`) {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
    },
    _sessionId: sessionId,
  };
}

describe("imageFitExtension", () => {
  let workDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const trackedScopes: string[] = [];

  beforeEach(async () => {
    workDir = path.join(os.tmpdir(), `pi-image-fit-ext-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(workDir, { recursive: true });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    trackedScopes.length = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    await fs.rm(workDir, { recursive: true, force: true });
    for (const s of trackedScopes) {
      await fs.rm(path.join(ROOT_DIR, s), { recursive: true, force: true });
    }
    delete process.env.PI_IMAGE_FIT_DISABLE;
    delete process.env.PI_IMAGE_FIT_MAX_EDGE;
    delete process.env.PI_IMAGE_FIT_MAX_BYTES;
    delete process.env.PI_IMAGE_FIT_QUALITY;
  });

  async function makeOversizePng(w = 1600, h = 1200): Promise<string> {
    // Use a noisy pattern so PNG encoding doesn't trivially collapse it.
    const img = new Jimp({ width: w, height: h, color: 0xffffffff });
    img.scan(0, 0, w, h, (x, y, idx) => {
      img.bitmap.data[idx] = (x * 7) & 0xff;
      img.bitmap.data[idx + 1] = (y * 13) & 0xff;
      img.bitmap.data[idx + 2] = ((x + y) * 5) & 0xff;
      img.bitmap.data[idx + 3] = 255;
    });
    const p = path.join(workDir, `oversize-${w}x${h}.png`);
    await img.write(p as `${string}.png`);
    return p;
  }

  async function makeSmallPng(): Promise<string> {
    const img = new Jimp({ width: 200, height: 100, color: 0xff0000ff });
    const p = path.join(workDir, "small.png");
    await img.write(p as `${string}.png`);
    return p;
  }

  describe("gate predicates", () => {
    it("non-read tool call passes through without I/O", async () => {
      const pi = makeFakePi();
      imageFitExtension(pi as any);
      const ev = makeBashEvent("ls");
      const ctx = makeCtx();
      trackedScopes.push(ctx._sessionId);
      await pi.fire("tool_call", ev, ctx);
      expect(ev.input).toEqual({ command: "ls" });
      expect(warnSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("non-image read passes through untouched", async () => {
      const pi = makeFakePi();
      imageFitExtension(pi as any);
      const ev = makeReadEvent("/tmp/some.txt");
      const ctx = makeCtx();
      trackedScopes.push(ctx._sessionId);
      await pi.fire("tool_call", ev, ctx);
      expect(ev.input.path).toBe("/tmp/some.txt");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("missing/empty path passes through untouched", async () => {
      const pi = makeFakePi();
      imageFitExtension(pi as any);
      const ev: any = { toolName: "read", toolCallId: "tc-3", input: {} };
      const ctx = makeCtx();
      trackedScopes.push(ctx._sessionId);
      await pi.fire("tool_call", ev, ctx);
      expect(ev.input.path).toBeUndefined();
    });
  });

  describe("happy path", () => {
    it("oversize image gets resized and event.input.path is rewritten", async () => {
      const pi = makeFakePi();
      imageFitExtension(pi as any);
      const src = await makeOversizePng();
      const ev = makeReadEvent(src);
      const ctx = makeCtx();
      trackedScopes.push(ctx._sessionId);

      await pi.fire("tool_call", ev, ctx);

      expect(ev.input.path).not.toBe(src);
      expect(ev.input.path.endsWith(".png")).toBe(true); // PNG-in → PNG-out
      const dstStat = await fs.stat(ev.input.path);
      expect(dstStat.isFile()).toBe(true);
      // Telemetry: one log line with the documented prefix.
      expect(logSpy).toHaveBeenCalledTimes(1);
      const logLine = String(logSpy.mock.calls[0][0]);
      expect(logLine).toMatch(/^\[pi-image-fit\]/);
      expect(logLine).toContain(src);
      expect(logLine).toContain("→");
    });

    it("already-small image passes through with no log line", async () => {
      const pi = makeFakePi();
      imageFitExtension(pi as any);
      const src = await makeSmallPng();
      const ev = makeReadEvent(src);
      const ctx = makeCtx();
      trackedScopes.push(ctx._sessionId);

      await pi.fire("tool_call", ev, ctx);
      expect(ev.input.path).toBe(src); // untouched
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("cache hit on second read: no second resize, same temp path", async () => {
      const pi = makeFakePi();
      imageFitExtension(pi as any);
      const src = await makeOversizePng();
      const ctx = makeCtx();
      trackedScopes.push(ctx._sessionId);

      const ev1 = makeReadEvent(src);
      await pi.fire("tool_call", ev1, ctx);
      const firstPath = ev1.input.path;
      const firstStat = await fs.stat(firstPath);

      // Reset spies to count only the second invocation.
      logSpy.mockClear();

      const ev2 = makeReadEvent(src);
      await pi.fire("tool_call", ev2, ctx);

      expect(ev2.input.path).toBe(firstPath);
      // No new log line on cache hit (no resize occurred).
      expect(logSpy).not.toHaveBeenCalled();
      // File mtime unchanged → no re-encode happened.
      const secondStat = await fs.stat(firstPath);
      expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
    });
  });

  describe("format-adaptive output (D3)", () => {
    it("JPEG input → JPEG output extension", async () => {
      const pi = makeFakePi();
      imageFitExtension(pi as any);
      // Make an oversize JPEG.
      const img = new Jimp({ width: 1600, height: 1200, color: 0x808080ff });
      const src = path.join(workDir, "big.jpg");
      await img.write(src as `${string}.jpg`);
      const ev = makeReadEvent(src);
      const ctx = makeCtx();
      trackedScopes.push(ctx._sessionId);

      await pi.fire("tool_call", ev, ctx);
      expect(ev.input.path.endsWith(".jpg")).toBe(true);
    });
  });

  describe("defensive fall-through (D9)", () => {
    it("ENOENT source: path unchanged, no warn (let built-in Read produce ENOENT)", async () => {
      const pi = makeFakePi();
      imageFitExtension(pi as any);
      const ev = makeReadEvent("/nonexistent/path/to/image.png");
      const ctx = makeCtx();
      trackedScopes.push(ctx._sessionId);
      await pi.fire("tool_call", ev, ctx);
      expect(ev.input.path).toBe("/nonexistent/path/to/image.png");
      // Source-missing case is silent (pi's normal Read error path).
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("undecodable image: path unchanged, one warn", async () => {
      const pi = makeFakePi();
      imageFitExtension(pi as any);
      const badPng = path.join(workDir, "fake.png");
      // 6 MB of garbage with a .png extension → fails the byte threshold,
      // so probeDims gets called, and jimp fails to decode.
      await fs.writeFile(badPng, Buffer.alloc(6 * 1024 * 1024, 0));
      const ev = makeReadEvent(badPng);
      const ctx = makeCtx();
      trackedScopes.push(ctx._sessionId);

      await pi.fire("tool_call", ev, ctx);
      expect(ev.input.path).toBe(badPng);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0][0])).toContain("could not decode");
    });

    it("handler never re-throws", async () => {
      const pi = makeFakePi();
      imageFitExtension(pi as any);
      const ev = makeReadEvent("/this/path/will/fail.png");
      const ctx = makeCtx();
      trackedScopes.push(ctx._sessionId);
      await expect(pi.fire("tool_call", ev, ctx)).resolves.not.toThrow();
    });
  });

  describe("disable kill switch", () => {
    it("PI_IMAGE_FIT_DISABLE=1 prevents tool_call registration", () => {
      process.env.PI_IMAGE_FIT_DISABLE = "1";
      const pi = makeFakePi();
      imageFitExtension(pi as any);
      expect(pi.handlers.has("tool_call")).toBe(false);
      expect(pi.handlers.has("session_shutdown")).toBe(false);
      // Logs the disabled message exactly once.
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(String(logSpy.mock.calls[0][0])).toContain("disabled");
    });
  });

  describe("session_shutdown cleanup", () => {
    it("removes the session cache dir on shutdown", async () => {
      const pi = makeFakePi();
      imageFitExtension(pi as any);
      const src = await makeOversizePng();
      const ctx = makeCtx();
      trackedScopes.push(ctx._sessionId);

      const ev = makeReadEvent(src);
      await pi.fire("tool_call", ev, ctx);
      const cacheDir = path.dirname(ev.input.path);
      const beforeStat = await fs.stat(cacheDir);
      expect(beforeStat.isDirectory()).toBe(true);

      await pi.fire("session_shutdown", {}, ctx);
      await expect(fs.stat(cacheDir)).rejects.toThrow();
    });
  });

  describe("config overrides", () => {
    it("PI_IMAGE_FIT_MAX_EDGE=400 resizes a 1200×800 image", async () => {
      process.env.PI_IMAGE_FIT_MAX_EDGE = "400";
      const pi = makeFakePi();
      imageFitExtension(pi as any);
      const img = new Jimp({ width: 1200, height: 800, color: 0xff0000ff });
      const src = path.join(workDir, "medium.png");
      await img.write(src as `${string}.png`);
      const ev = makeReadEvent(src);
      const ctx = makeCtx();
      trackedScopes.push(ctx._sessionId);
      await pi.fire("tool_call", ev, ctx);
      expect(ev.input.path).not.toBe(src);
      // Verify the output is actually downscaled.
      const decoded = await Jimp.read(ev.input.path);
      expect(Math.max(decoded.width, decoded.height)).toBeLessThanOrEqual(400);
    });
  });
});
