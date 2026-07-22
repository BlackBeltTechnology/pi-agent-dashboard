/**
 * Integration tests for the tool_call hook.
 *
 * Pattern: build a fake ExtensionAPI that captures registered handlers,
 * then drive synthetic events. Mirrors
 * packages/extension/src/__tests__/provider-register-reload.test.ts.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Jimp, JimpMime } from "jimp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentCache, ROOT_DIR } from "../cache.js";
import imageFitExtension, { fitContextMessages } from "../extension.js";
import type { ImageFitConfig } from "../policy.js";
import * as resize from "../resize.js";
import { estimateBytesFromBase64 } from "../resize.js";

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

// ---------------------------------------------------------------------------
// Second interception seam: the `context` event handler.
// ---------------------------------------------------------------------------

const CONFIG: ImageFitConfig = { disabled: false, maxEdge: 1568, maxBytes: 4 * 1024 * 1024, quality: 85 };

async function encodeB64(
  w: number,
  h: number,
  mime: (typeof JimpMime)[keyof typeof JimpMime],
  noisy = false,
): Promise<string> {
  const img = new Jimp({ width: w, height: h, color: 0x3366ccff });
  if (noisy) {
    img.scan(0, 0, w, h, (x, y, idx) => {
      img.bitmap.data[idx] = Math.floor(Math.random() * 256);
      img.bitmap.data[idx + 1] = Math.floor(Math.random() * 256);
      img.bitmap.data[idx + 2] = Math.floor(Math.random() * 256);
      img.bitmap.data[idx + 3] = 255;
    });
  }
  const buf = (await img.getBuffer(mime)) as unknown as Buffer;
  return buf.toString("base64");
}

function imgBlock(data: string, mimeType = "image/png") {
  return { type: "image", data, mimeType };
}

function msg(content: unknown, role = "user") {
  return { role, content };
}

async function decodedMaxEdge(data: string): Promise<number> {
  const img = await Jimp.fromBuffer(Buffer.from(data, "base64"));
  return Math.max(img.width, img.height);
}

describe("imageFitExtension context seam", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    delete process.env.PI_IMAGE_FIT_DISABLE;
  });

  // --- resize policy through the seam ---

  it("E1: 1569×800 png (edge over) → resized, {messages} returned", async () => {
    const data = await encodeB64(1569, 800, JimpMime.png);
    const messages = [msg([imgBlock(data)])];
    const out = await fitContextMessages(messages, CONFIG, new ContentCache());
    expect(out).toBe(messages); // same reference returned on change
    expect(await decodedMaxEdge((messages[0].content as any)[0].data)).toBeLessThanOrEqual(1568);
  });

  it("E2: exactly 1568×800 png (<4 MiB) → not resized, returns undefined", async () => {
    const data = await encodeB64(1568, 800, JimpMime.png);
    const messages = [msg([imgBlock(data)])];
    const out = await fitContextMessages(messages, CONFIG, new ContentCache());
    expect(out).toBeUndefined();
    expect((messages[0].content as any)[0].data).toBe(data); // untouched
  });

  it("E3 (incident): 8956×5080 png ~<4 MiB → resized (dims checked, not byte-only)", async () => {
    const data = await encodeB64(8956, 5080, JimpMime.png);
    expect(estimateBytesFromBase64(data)).toBeLessThan(4 * 1024 * 1024); // bytes under
    const messages = [msg([imgBlock(data)])];
    const out = await fitContextMessages(messages, CONFIG, new ContentCache());
    expect(out).toBe(messages);
    expect(await decodedMaxEdge((messages[0].content as any)[0].data)).toBeLessThanOrEqual(1568);
  }, 60000);

  it("E4: ≤1568 px but >4 MiB decoded bytes → re-encoded smaller", async () => {
    // A 1250×1250 BMP is uncompressed (~4.7 MiB) yet within the edge limit,
    // so it must resize on the BYTE threshold; jpeg output shrinks it.
    const data = await encodeB64(1250, 1250, JimpMime.bmp);
    expect(estimateBytesFromBase64(data)).toBeGreaterThan(4 * 1024 * 1024);
    const messages = [msg([imgBlock(data, "image/bmp")])];
    const out = await fitContextMessages(messages, CONFIG, new ContentCache());
    expect(out).toBe(messages);
    const newData = (messages[0].content as any)[0].data;
    expect(estimateBytesFromBase64(newData)).toBeLessThan(4 * 1024 * 1024);
  });

  // --- seam behaviour ---

  it("E7: oversize image in a non-user/non-tool role → resized (role-agnostic)", async () => {
    const data = await encodeB64(2000, 1200, JimpMime.png);
    const messages = [msg([imgBlock(data)], "some-custom-role")];
    const out = await fitContextMessages(messages, CONFIG, new ContentCache());
    expect(out).toBe(messages);
    expect(await decodedMaxEdge((messages[0].content as any)[0].data)).toBeLessThanOrEqual(1568);
  });

  it("E8: string content → skipped, no throw, no WARN", async () => {
    const messages = [msg("just a plain string prompt")];
    const out = await fitContextMessages(messages, CONFIG, new ContentCache());
    expect(out).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("E9: multi-image turn → both oversize resized, small untouched, single result", async () => {
    const over1 = await encodeB64(2000, 1200, JimpMime.png);
    const over2 = await encodeB64(1800, 1600, JimpMime.png);
    const small = await encodeB64(200, 100, JimpMime.png);
    const messages = [msg([imgBlock(over1), imgBlock(over2), imgBlock(small)])];
    const out = await fitContextMessages(messages, CONFIG, new ContentCache());
    expect(out).toBe(messages);
    const blocks = (messages[0].content as any) as { data: string }[];
    expect(blocks[0].data).not.toBe(over1);
    expect(blocks[1].data).not.toBe(over2);
    expect(blocks[2].data).toBe(small); // within-limit untouched
  });

  it("E10: all image blocks within limits → returns undefined", async () => {
    const small = await encodeB64(200, 100, JimpMime.png);
    const messages = [msg([imgBlock(small)])];
    const out = await fitContextMessages(messages, CONFIG, new ContentCache());
    expect(out).toBeUndefined();
  });

  it("E11: text + tool-call blocks, no image → untouched, returns undefined", async () => {
    const messages = [
      msg([
        { type: "text", text: "hello" },
        { type: "toolCall", id: "tc1", name: "bash", arguments: { command: "ls" } },
      ]),
    ];
    const before = structuredClone(messages);
    const out = await fitContextMessages(messages, CONFIG, new ContentCache());
    expect(out).toBeUndefined();
    expect(messages).toEqual(before); // byte-identical
  });

  it("E12: PI_IMAGE_FIT_DISABLE=1 → context handler not registered", () => {
    process.env.PI_IMAGE_FIT_DISABLE = "1";
    const pi = makeFakePi();
    imageFitExtension(pi as any);
    expect(pi.handlers.has("context")).toBe(false);
  });

  it("E17: within-limit block → hash + cache-put spies NOT invoked", async () => {
    const keyForSpy = vi.spyOn(ContentCache.prototype, "keyFor");
    const setSpy = vi.spyOn(ContentCache.prototype, "set");
    const resizeSpy = vi.spyOn(resize, "resizeBuffer");
    const pi = makeFakePi();
    imageFitExtension(pi as any);
    const small = await encodeB64(200, 100, JimpMime.png);
    const out = await pi.fire("context", { type: "context", messages: [msg([imgBlock(small)])] });
    expect(out).toBeUndefined();
    expect(keyForSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(resizeSpy).not.toHaveBeenCalled();
  });

  it("E18: loading from a transcript file → returned block fitted, file bytes unchanged", async () => {
    const dir = path.join(os.tmpdir(), `pi-image-fit-e18-${process.pid}-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "transcript.json");
    try {
      const data = await encodeB64(2000, 1200, JimpMime.png);
      await fs.writeFile(file, JSON.stringify([msg([imgBlock(data)])]));
      const bytesBefore = await fs.readFile(file);
      const messages = JSON.parse(bytesBefore.toString("utf8"));
      const out = await fitContextMessages(messages, CONFIG, new ContentCache());
      expect(out).toBeTruthy();
      expect(await decodedMaxEdge(messages[0].content[0].data)).toBeLessThanOrEqual(1568);
      const bytesAfter = await fs.readFile(file);
      expect(bytesAfter.equals(bytesBefore)).toBe(true); // on-disk transcript untouched
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  // --- performance invariants ---

  it("P1: within-limit block → zero jimp pixel decodes (header probe only)", async () => {
    const probeSpy = vi.spyOn(resize, "probeDimsFromBuffer");
    const resizeSpy = vi.spyOn(resize, "resizeBuffer");
    const pi = makeFakePi();
    imageFitExtension(pi as any);
    const small = await encodeB64(200, 100, JimpMime.png);
    const out = await pi.fire("context", { type: "context", messages: [msg([imgBlock(small)])] });
    expect(out).toBeUndefined();
    expect(probeSpy).not.toHaveBeenCalled();
    expect(resizeSpy).not.toHaveBeenCalled();
  });

  it("P2: same oversize block across 3 turns → resizeBuffer runs once total", async () => {
    const resizeSpy = vi.spyOn(resize, "resizeBuffer");
    const pi = makeFakePi();
    imageFitExtension(pi as any); // one extension instance → one shared cache
    const data = await encodeB64(2000, 1200, JimpMime.png);
    for (let turn = 0; turn < 3; turn++) {
      // fresh block copy each turn (as pi re-copies the transcript)
      await pi.fire("context", { type: "context", messages: [msg([imgBlock(data)])] });
    }
    expect(resizeSpy).toHaveBeenCalledTimes(1);
  });

  // --- fail-open (error handling) ---

  it("X1: undecodable oversize block → unchanged, exactly one WARN, no throw", async () => {
    const garbage = "A".repeat(6 * 1024 * 1024); // decodes to ~4.7 MiB of zeros
    expect(estimateBytesFromBase64(garbage)).toBeGreaterThan(4 * 1024 * 1024);
    const messages = [msg([imgBlock(garbage)])];
    const out = await fitContextMessages(messages, CONFIG, new ContentCache());
    expect(out).toBeUndefined(); // nothing changed
    expect((messages[0].content as any)[0].data).toBe(garbage); // untouched
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("X2: one undecodable + one valid oversize → valid resized, bad passes through", async () => {
    const garbage = "A".repeat(6 * 1024 * 1024);
    const valid = await encodeB64(2000, 1200, JimpMime.png);
    const messages = [msg([imgBlock(garbage), imgBlock(valid)])];
    const out = await fitContextMessages(messages, CONFIG, new ContentCache());
    expect(out).toBe(messages);
    const blocks = (messages[0].content as any) as { data: string }[];
    expect(blocks[0].data).toBe(garbage); // bad untouched
    expect(blocks[1].data).not.toBe(valid); // valid resized
    expect(await decodedMaxEdge(blocks[1].data)).toBeLessThanOrEqual(1568);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("X3: resizeBuffer throws for one block → that block unchanged + one WARN, sibling processed", async () => {
    const a = await encodeB64(2000, 1200, JimpMime.png);
    const b = await encodeB64(1800, 1600, JimpMime.png);
    // First resize throws; subsequent calls fall through to the real impl.
    const spy = vi.spyOn(resize, "resizeBuffer").mockRejectedValueOnce(new Error("encode boom"));
    const messages = [msg([imgBlock(a), imgBlock(b)])];
    const out = await fitContextMessages(messages, CONFIG, new ContentCache());
    expect(out).toBe(messages);
    const blocks = (messages[0].content as any) as { data: string }[];
    expect(blocks[0].data).toBe(a); // resize threw → unchanged
    expect(blocks[1].data).not.toBe(b); // sibling still processed
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
