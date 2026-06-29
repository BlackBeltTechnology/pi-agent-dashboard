import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Jimp } from "jimp";
import {
  isImagePath,
  needsResize,
  outputFormatFor,
  probeDims,
  resizeToFile,
} from "../resize.js";

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
