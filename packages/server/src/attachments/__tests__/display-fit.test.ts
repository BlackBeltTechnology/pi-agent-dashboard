import { Jimp, JimpMime } from "jimp";
import { describe, expect, it } from "vitest";
import {
  DISPLAY_MAX_BYTES,
  DISPLAY_MAX_DECODE_PIXELS,
  DISPLAY_MAX_EDGE,
  DISPLAY_MAX_INPUT_BYTES,
  fitImageBlockForDisplay,
  isAnimatedGif,
  readImageDimensions,
} from "../display-fit.js";

/**
 * A PNG that DECLARES `width`x`height` in its IHDR but carries no pixel data.
 * This is the shape of a decompression bomb: a few bytes on the wire, a
 * `width*height*4` byte bitmap once decoded.
 */
function forgedPngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

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

// A fitted derivative MUST fit the per-event ceiling. The measured 212 KB max
// came from real screenshots (n=40); high-entropy images blow past it, and an
// over-budget derivative made its OWN resolution event exceed the ceiling ->
// {__truncated} -> attachmentId destroyed -> placeholder stuck "loading"
// forever, violating "SHALL NOT leave an indefinite placeholder".
// See change: fit-attachments-for-display (E1/E2/E3 budget guarantee).
describe("display-fit — output byte budget", () => {
  /** High-entropy noise: PNG cannot compress it, so a naive fit blows the budget. */
  async function noisePng(w: number, h: number): Promise<string> {
    const img = new Jimp({ width: w, height: h, color: 0x000000ff });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = ((x * 2654435761) ^ (y * 40503)) >>> 0;
        // Keep the RGBA word inside uint32 range.
        img.setPixelColor((((v & 0xffffff) << 8) >>> 0) + 0xff, x, y);
      }
    }
    return (await img.getBuffer(JimpMime.png)).toString("base64");
  }

  it("keeps a high-entropy image within the display byte budget", async () => {
    const data = await noisePng(2000, 1400);
    const out = await fitImageBlockForDisplay({ data, mimeType: "image/png" });

    expect(out.failed).toBeFalsy();
    expect(out.fitted).toBe(true);
    expect(Buffer.byteLength(out.data, "utf8")).toBeLessThanOrEqual(DISPLAY_MAX_BYTES);
    // Still a decodable image, not a corrupt truncation.
    const img = await Jimp.read(Buffer.from(out.data, "base64"));
    expect(Math.max(img.bitmap.width, img.bitmap.height)).toBeLessThanOrEqual(DISPLAY_MAX_EDGE);
  }, 30_000);

  it("the budget is measured in BASE64 bytes, matching what the store stores", async () => {
    // Regression: the fit once budgeted RAW buffer bytes while the resolver
    // budgeted the base64 payload (~4/3 larger), so derivatives the fit
    // accepted were rejected downstream and resolved "failed" for no reason.
    const data = await noisePng(2000, 1400);
    const out = await fitImageBlockForDisplay({ data, mimeType: "image/png" });
    expect(out.failed).toBeFalsy();
    const base64Bytes = Buffer.byteLength(out.data, "utf8");
    const rawBytes = Buffer.from(out.data, "base64").length;
    expect(base64Bytes).toBeGreaterThan(rawBytes); // proves the units differ
    expect(base64Bytes).toBeLessThanOrEqual(DISPLAY_MAX_BYTES);
  }, 30_000);

  it("the budget leaves headroom under the per-event ceiling", () => {
    // The derivative rides its own event, whose envelope also costs bytes.
    expect(DISPLAY_MAX_BYTES).toBeLessThan(262_144);
  });

  // --- pre-decode guards (CodeRabbit round 2) ---

  describe("pre-decode size guard", () => {
    it("reads declared dimensions from a PNG header without decoding it", () => {
      expect(readImageDimensions(forgedPngHeader(20_000, 20_000))).toEqual({
        width: 20_000,
        height: 20_000,
      });
    });

    it("rejects a declared-oversize image BEFORE Jimp allocates its bitmap", async () => {
      // 20000x20000 = 400 MP = ~1.6 GB of RGBA bitmap. The byte budget is
      // checked on OUTPUT, so without this guard the allocation happens first
      // and the process can OOM before any budget applies.
      const data = forgedPngHeader(20_000, 20_000).toString("base64");
      const out = await fitImageBlockForDisplay({ data, mimeType: "image/png" });
      expect(out.failed).toBe(true);
      expect(out.data).toBe(data); // input echoed back, never decoded
    });

    it("rejects an input whose declared pixel count exceeds the ceiling by one", async () => {
      const side = Math.ceil(Math.sqrt(DISPLAY_MAX_DECODE_PIXELS)) + 1;
      const data = forgedPngHeader(side, side).toString("base64");
      const out = await fitImageBlockForDisplay({ data, mimeType: "image/png" });
      expect(out.failed).toBe(true);
    });

    it("rejects an input over the raw byte cap without decoding it", async () => {
      const data = Buffer.alloc(DISPLAY_MAX_INPUT_BYTES + 1).toString("base64");
      const out = await fitImageBlockForDisplay({ data, mimeType: "image/png" });
      expect(out.failed).toBe(true);
    });

    it("a real screenshot-sized image is NOT caught by the guard", async () => {
      // The guard must bound bombs, not reject legitimate 5K screenshots.
      const data = await pngBase64(2560, 1440);
      const out = await fitImageBlockForDisplay({ data, mimeType: "image/png" });
      expect(out.failed).toBeFalsy();
      expect(out.fitted).toBe(true);
    }, 30_000);

    it("a supported mime whose header cannot be parsed is failed, not decoded", async () => {
      // Fail CLOSED: if we cannot bound the allocation, we do not attempt it.
      const data = Buffer.from("not actually a png at all").toString("base64");
      const out = await fitImageBlockForDisplay({ data, mimeType: "image/png" });
      expect(out.failed).toBe(true);
    });
  });

  it("a low-entropy image is untouched by the budget ladder (still PNG)", async () => {
    const img = new Jimp({ width: 1200, height: 800, color: 0x3366ccff });
    const data = (await img.getBuffer(JimpMime.png)).toString("base64");
    const out = await fitImageBlockForDisplay({ data, mimeType: "image/png" });
    expect(out.fitted).toBe(true);
    expect(out.mimeType).toBe("image/png"); // no needless lossy downgrade
    expect(Buffer.byteLength(out.data, "utf8")).toBeLessThanOrEqual(DISPLAY_MAX_BYTES);
  }, 30_000);
});

