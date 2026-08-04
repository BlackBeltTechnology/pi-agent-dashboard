import { describe, expect, it } from "vitest";
import { Jimp, JimpMime } from "jimp";
import {
  DISPLAY_MAX_EDGE,
  fitImageBlockForDisplay,
  isAnimatedGif,
} from "../display-fit.js";

/** Build a base64 PNG of the given pixel dimensions. */
async function pngBase64(width: number, height: number): Promise<string> {
  const img = new Jimp({ width, height, color: 0x336699ff });
  const buf = await img.getBuffer(JimpMime.png);
  return buf.toString("base64");
}

/** Decode a base64 image back to its pixel dimensions. */
async function dimsOf(base64: string): Promise<{ width: number; height: number }> {
  const img = await Jimp.read(Buffer.from(base64, "base64"));
  return { width: img.bitmap.width, height: img.bitmap.height };
}

describe("display-fit", () => {
  // --- E4/E5/E6: no-upscale + the fit boundary (test-plan) ---

  it("E4: an already-small image is returned byte-identical and undecoded", async () => {
    const data = await pngBase64(40, 40);
    const out = await fitImageBlockForDisplay({ data, mimeType: "image/png" });
    expect(out.data).toBe(data); // byte-identical, not re-encoded
    expect(out.fitted).toBe(false);
    expect(await dimsOf(out.data)).toEqual({ width: 40, height: 40 });
  });

  it("E5: an image just under the bound (767 px long edge) is not resized", async () => {
    const data = await pngBase64(767, 400);
    const out = await fitImageBlockForDisplay({ data, mimeType: "image/png" });
    expect(out.fitted).toBe(false);
    expect(out.data).toBe(data);
    expect(await dimsOf(out.data)).toEqual({ width: 767, height: 400 });
  });

  it("E5b: an image exactly at the bound (768 px long edge) is not resized", async () => {
    const data = await pngBase64(DISPLAY_MAX_EDGE, 400);
    const out = await fitImageBlockForDisplay({ data, mimeType: "image/png" });
    expect(out.fitted).toBe(false);
    expect(out.data).toBe(data);
  });

  it("E6: an image just over the bound (769 px) is resized to a 768 px long edge", async () => {
    const data = await pngBase64(769, 400);
    const out = await fitImageBlockForDisplay({ data, mimeType: "image/png" });
    expect(out.fitted).toBe(true);
    const dims = await dimsOf(out.data);
    expect(Math.max(dims.width, dims.height)).toBe(DISPLAY_MAX_EDGE);
  });

  it("E6b: aspect ratio is preserved and portrait fits on its long edge", async () => {
    const data = await pngBase64(400, 1600);
    const out = await fitImageBlockForDisplay({ data, mimeType: "image/png" });
    const dims = await dimsOf(out.data);
    expect(dims.height).toBe(DISPLAY_MAX_EDGE);
    expect(dims.width).toBe(Math.round((400 / 1600) * DISPLAY_MAX_EDGE));
  });

  it("E1/E2/E3: a large image fits well inside the per-event ceiling", async () => {
    // A 3000x2000 photo-like source stands in for the measured p99/max inputs.
    const img = new Jimp({ width: 3000, height: 2000, color: 0x11223344 });
    const data = (await img.getBuffer(JimpMime.png)).toString("base64");
    const out = await fitImageBlockForDisplay({ data, mimeType: "image/png" });
    expect(out.fitted).toBe(true);
    expect(Buffer.byteLength(out.data, "utf8")).toBeLessThan(262_144);
    const dims = await dimsOf(out.data);
    expect(Math.max(dims.width, dims.height)).toBe(DISPLAY_MAX_EDGE);
  });

  // --- X10 / D11: animated GIFs are exempt from fitting ---

  it("X10: an animated GIF is detected and passed through untouched", async () => {
    // Minimal animated GIF: header + two graphic-control extension blocks.
    const animated = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQJAAAAACwAAAAAAQABAAACAkQBACH5BAkAAAAALAAAAAABAAEAAAICRAEAOw==",
      "base64",
    );
    expect(isAnimatedGif(animated)).toBe(true);
    const data = animated.toString("base64");
    const out = await fitImageBlockForDisplay({ data, mimeType: "image/gif" });
    expect(out.data).toBe(data); // never re-encoded into a corrupt still
    expect(out.fitted).toBe(false);
    expect(out.exempt).toBe(true);
  });

  it("X10b: a single-frame GIF is not treated as animated", async () => {
    const still = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    );
    expect(isAnimatedGif(still)).toBe(false);
  });

  // --- X9: undecodable input fails honestly, never throws into the caller ---

  it("X9: undecodable bytes resolve to an explicit failure, not a throw", async () => {
    const out = await fitImageBlockForDisplay({
      data: Buffer.from("not an image at all").toString("base64"),
      mimeType: "image/png",
    });
    expect(out.failed).toBe(true);
    expect(out.fitted).toBe(false);
  });
});
