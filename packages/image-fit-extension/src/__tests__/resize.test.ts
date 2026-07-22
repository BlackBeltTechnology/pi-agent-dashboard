import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Jimp, JimpMime } from "jimp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  estimateBytesFromBase64,
  isImagePath,
  needsResize,
  outputFormatFor,
  outputFormatForMime,
  probeDims,
  probeDimsFromBuffer,
  probeDimsFromHeader,
  resizeBuffer,
  resizeToFile,
} from "../resize.js";

// --- shared buffer helpers for the context-seam (buffer-path) tests ---

async function encode(
  w: number,
  h: number,
  mime: (typeof JimpMime)[keyof typeof JimpMime],
  noisy = false,
): Promise<Buffer> {
  const img = new Jimp({ width: w, height: h, color: 0xff0000ff });
  if (noisy) {
    img.scan(0, 0, w, h, (x, y, idx) => {
      img.bitmap.data[idx] = (x * 7) & 0xff;
      img.bitmap.data[idx + 1] = (y * 13) & 0xff;
      img.bitmap.data[idx + 2] = ((x + y) * 5) & 0xff;
      img.bitmap.data[idx + 3] = 255;
    });
  }
  return (await img.getBuffer(mime)) as unknown as Buffer;
}

describe("isImagePath", () => {
  it.each([
    ["foo.png", true],
    ["foo.PNG", true],
    ["foo.jpg", true],
    ["foo.jpeg", true],
    ["foo.JPEG", true],
    ["foo.webp", true],
    ["foo.gif", true],
    ["foo.txt", false],
    ["foo.md", false],
    ["foo", false],
    ["foo.png.bak", false],
    ["", false],
  ])("isImagePath(%s) -> %s", (p, expected) => {
    expect(isImagePath(p)).toBe(expected);
  });
});

describe("needsResize", () => {
  const base = { maxBytes: 4 * 1024 * 1024, maxEdge: 1568 };
  it("returns false when both bytes and edge are under threshold", () => {
    expect(needsResize({ ...base, bytes: 100_000, dims: { width: 800, height: 600 } })).toBe(false);
  });
  it("returns true when bytes exceed threshold", () => {
    expect(needsResize({ ...base, bytes: 5 * 1024 * 1024, dims: { width: 800, height: 600 } })).toBe(true);
  });
  it("returns true when long edge exceeds threshold (landscape)", () => {
    expect(needsResize({ ...base, bytes: 100_000, dims: { width: 2000, height: 1000 } })).toBe(true);
  });
  it("returns true when long edge exceeds threshold (portrait)", () => {
    expect(needsResize({ ...base, bytes: 100_000, dims: { width: 1000, height: 2000 } })).toBe(true);
  });
  it("returns true when both exceed", () => {
    expect(needsResize({ ...base, bytes: 5 * 1024 * 1024, dims: { width: 4000, height: 3000 } })).toBe(true);
  });
});

describe("outputFormatFor", () => {
  it("PNG-in → PNG-out", () => {
    expect(outputFormatFor("/tmp/foo.png").ext).toBe(".png");
    expect(outputFormatFor("/tmp/FOO.PNG").ext).toBe(".png");
  });
  it.each(["foo.jpg", "foo.jpeg", "foo.webp", "foo.gif"])(
    "%s → JPEG out",
    (p) => {
      expect(outputFormatFor(p).ext).toBe(".jpg");
    },
  );
});

describe("probeDims + resizeToFile (real jimp)", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = path.join(os.tmpdir(), `pi-image-fit-resize-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(workDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  async function makeTestPng(w: number, h: number): Promise<string> {
    const img = new Jimp({ width: w, height: h, color: 0xff0000ff });
    const p = path.join(workDir, `${w}x${h}.png`);
    await img.write(p as `${string}.png`);
    return p;
  }

  it("probeDims returns dimensions for a real image", async () => {
    const src = await makeTestPng(800, 600);
    const dims = await probeDims(src);
    expect(dims).toEqual({ width: 800, height: 600 });
  });

  it("probeDims returns null for a non-image", async () => {
    const p = path.join(workDir, "not-an-image.png");
    await fs.writeFile(p, "this is not an image");
    const dims = await probeDims(p);
    expect(dims).toBeNull();
  });

  it("resizes landscape preserving aspect ratio (long edge ≤ maxEdge)", async () => {
    const src = await makeTestPng(1600, 1200);
    const dst = path.join(workDir, "out.png");
    const result = await resizeToFile(src, dst, { maxEdge: 1568, quality: 85 });
    expect(result.srcDims).toEqual({ width: 1600, height: 1200 });
    // Long edge ≤ 1568, aspect preserved to within ±1 px.
    expect(Math.max(result.dstDims.width, result.dstDims.height)).toBeLessThanOrEqual(1568);
    const expectedShort = Math.round((1200 / 1600) * 1568);
    expect(Math.abs(result.dstDims.height - expectedShort)).toBeLessThanOrEqual(1);
    expect(result.dstBytes).toBeGreaterThan(0);
    const stat = await fs.stat(dst);
    expect(stat.size).toBe(result.dstBytes);
  });

  it("resizes portrait preserving aspect ratio", async () => {
    const src = await makeTestPng(1200, 1600);
    const dst = path.join(workDir, "out.png");
    const result = await resizeToFile(src, dst, { maxEdge: 1568, quality: 85 });
    expect(Math.max(result.dstDims.width, result.dstDims.height)).toBeLessThanOrEqual(1568);
    const expectedShort = Math.round((1200 / 1600) * 1568);
    expect(Math.abs(result.dstDims.width - expectedShort)).toBeLessThanOrEqual(1);
    expect(result.dstDims.height).toBe(1568);
  });

  it("writes PNG when output extension is .png", async () => {
    const src = await makeTestPng(1600, 1200);
    const dst = path.join(workDir, "out.png");
    await resizeToFile(src, dst, { maxEdge: 1568, quality: 85 });
    const head = await fs.readFile(dst);
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    expect(head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  });

  it("writes JPEG when output extension is .jpg", async () => {
    const src = await makeTestPng(1600, 1200);
    const dst = path.join(workDir, "out.jpg");
    await resizeToFile(src, dst, { maxEdge: 1568, quality: 85 });
    const head = await fs.readFile(dst);
    // JPEG magic: FF D8 FF
    expect(head[0]).toBe(0xff);
    expect(head[1]).toBe(0xd8);
    expect(head[2]).toBe(0xff);
  });

  it("does not upscale when source is smaller than maxEdge", async () => {
    // resizeToFile is called only when needsResize() returns true (the
    // hook's policy gate). But if it IS called with a small image
    // (degenerate case), it must not upscale.
    const src = await makeTestPng(800, 600);
    const dst = path.join(workDir, "out.png");
    const result = await resizeToFile(src, dst, { maxEdge: 1568, quality: 85 });
    expect(result.dstDims).toEqual({ width: 800, height: 600 });
  });
});

describe("estimateBytesFromBase64", () => {
  it.each([
    [Buffer.from([1, 2, 3]), 3], // "AQID", no padding
    [Buffer.from([1, 2]), 2], // "AQI=", one pad
    [Buffer.from([1]), 1], // "AQ==", two pads
    [Buffer.alloc(0), 0], // empty
  ])("estimates %o bytes as %i", (buf, expected) => {
    expect(estimateBytesFromBase64(buf.toString("base64"))).toBe(expected);
  });

  it("approximates a real image's byte length within one group", async () => {
    const buf = await encode(64, 64, JimpMime.png);
    const est = estimateBytesFromBase64(buf.toString("base64"));
    expect(Math.abs(est - buf.length)).toBeLessThanOrEqual(2);
  });
});

describe("outputFormatForMime (E5 decision table)", () => {
  it("image/png → png output (lossless)", () => {
    expect(outputFormatForMime("image/png")).toEqual({ format: "png", mime: "image/png" });
  });
  it.each(["image/webp", "image/gif", "image/jpeg", "IMAGE/WEBP"])(
    "%s → jpeg output",
    (mime) => {
      expect(outputFormatForMime(mime)).toEqual({ format: "jpeg", mime: "image/jpeg" });
    },
  );
});

describe("probeDimsFromHeader (cheap gate, no pixel decode)", () => {
  it("reads PNG IHDR dimensions", async () => {
    const buf = await encode(1569, 800, JimpMime.png);
    expect(probeDimsFromHeader(buf)).toEqual({ width: 1569, height: 800 });
  });

  it("reads GIF logical-screen dimensions", async () => {
    const buf = await encode(320, 240, JimpMime.gif);
    expect(probeDimsFromHeader(buf)).toEqual({ width: 320, height: 240 });
  });

  it("reads JPEG SOF dimensions", async () => {
    const buf = await encode(800, 456, JimpMime.jpeg);
    expect(probeDimsFromHeader(buf)).toEqual({ width: 800, height: 456 });
  });

  it("reads the incident-scale PNG header cheaply", async () => {
    // 8956×5080 solid PNG — header parse must not decode 45 MP of pixels.
    const buf = await encode(8956, 5080, JimpMime.png);
    expect(probeDimsFromHeader(buf)).toEqual({ width: 8956, height: 5080 });
  });

  it("reads a hand-crafted WEBP VP8X canvas size", () => {
    // jimp cannot encode webp, so craft a minimal VP8X header: canvas 2000×1000.
    const buf = Buffer.alloc(30);
    buf.write("RIFF", 0, "ascii");
    buf.write("WEBP", 8, "ascii");
    buf.write("VP8X", 12, "ascii");
    buf.writeUIntLE(2000 - 1, 24, 3); // canvas width - 1
    buf.writeUIntLE(1000 - 1, 27, 3); // canvas height - 1
    expect(probeDimsFromHeader(buf)).toEqual({ width: 2000, height: 1000 });
  });

  it("returns null for a non-header-parseable format (BMP)", async () => {
    const bmp = await encode(64, 48, JimpMime.bmp);
    expect(probeDimsFromHeader(bmp)).toBeNull();
  });

  it("returns null for garbage bytes", () => {
    expect(probeDimsFromHeader(Buffer.from("not an image at all"))).toBeNull();
  });
});

describe("probeDimsFromBuffer (jimp decode)", () => {
  it("returns dimensions for real image bytes", async () => {
    const buf = await encode(300, 200, JimpMime.png);
    expect(await probeDimsFromBuffer(buf)).toEqual({ width: 300, height: 200 });
  });

  it("returns null for undecodable bytes", async () => {
    expect(await probeDimsFromBuffer(Buffer.alloc(4096, 0))).toBeNull();
  });
});

describe("resizeBuffer", () => {
  it("E6: 4032×3024 png → 1568×1176 (±1 px), aspect preserved", async () => {
    const buf = await encode(4032, 3024, JimpMime.png);
    const { dims, data } = await resizeBuffer(buf, { maxEdge: 1568, quality: 85 }, "png");
    expect(dims.width).toBe(1568);
    expect(Math.abs(dims.height - 1176)).toBeLessThanOrEqual(1);
    expect(data.length).toBeGreaterThan(0);
  });

  it("E5: png output carries PNG magic bytes", async () => {
    const buf = await encode(2000, 1200, JimpMime.png, true);
    const { data } = await resizeBuffer(buf, { maxEdge: 1568, quality: 85 }, "png");
    expect(data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  });

  it("E5: jpeg output carries JPEG magic bytes (webp/gif → jpeg branch)", async () => {
    // webp can't be decoded by jimp; the jpeg branch is exercised via a
    // decodable input. gif is separately verified below with real bytes.
    const buf = await encode(2000, 1200, JimpMime.png, true);
    const { data } = await resizeBuffer(buf, { maxEdge: 1568, quality: 85 }, "jpeg");
    expect(data[0]).toBe(0xff);
    expect(data[1]).toBe(0xd8);
    expect(data[2]).toBe(0xff);
  });

  it("E5: real oversize gif input → jpeg output (first frame)", async () => {
    // Thin strip: edge > 1568 (triggers resize) but tiny area so jimp's slow
    // gif palette-quantization stays well under the test timeout.
    const gif = await encode(1600, 40, JimpMime.gif);
    const { data, dims } = await resizeBuffer(gif, { maxEdge: 1568, quality: 85 }, "jpeg");
    expect(data[0]).toBe(0xff);
    expect(data[1]).toBe(0xd8);
    expect(Math.max(dims.width, dims.height)).toBeLessThanOrEqual(1568);
  });

  it("does not upscale a small buffer", async () => {
    const buf = await encode(400, 300, JimpMime.png);
    const { dims } = await resizeBuffer(buf, { maxEdge: 1568, quality: 85 }, "png");
    expect(dims).toEqual({ width: 400, height: 300 });
  });
});

describe("X4: unparseable-header fallback primitives", () => {
  it("a valid oversize BMP: header probe null, jimp decode + resize still fit it", async () => {
    const bmp = await encode(1800, 1200, JimpMime.bmp);
    // Cheap header probe cannot parse BMP → null (triggers the fallback).
    expect(probeDimsFromHeader(bmp)).toBeNull();
    // Bounded jimp decode recovers dimensions...
    expect(await probeDimsFromBuffer(bmp)).toEqual({ width: 1800, height: 1200 });
    // ...and the resize still fits it.
    const { dims } = await resizeBuffer(bmp, { maxEdge: 1568, quality: 85 }, "jpeg");
    expect(Math.max(dims.width, dims.height)).toBeLessThanOrEqual(1568);
  });
});
