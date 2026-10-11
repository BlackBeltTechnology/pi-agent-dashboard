/**
 * Sandboxed image decoding (design D2, spec deck3d-art-tooling "Sandboxed
 * image decoding"). Images decode in a headless chromium page with page
 * scripts disabled and every request other than the one serving the input
 * aborted; the decoded RGBA returns to Node through Playwright's evaluate
 * (which runs outside the page's own script engine). SVG is rasterised as an
 * `<img>`, where scripts never run and external references never load.
 */
import type { Browser, BrowserContext } from "playwright";
import type { RgbaImage } from "./png.js";

export const DECODE_MAX_BYTES = 20 * 1024 * 1024;
/**
 * Decoded size is bounded separately from the input size: a few KB of PNG can
 * claim 30000×30000 pixels, and decoding it allocates a canvas, an RGBA buffer
 * and a base64 string of that size. 4096×4096 = 64 MiB of RGBA.
 */
export const DECODE_MAX_PIXELS = 4096 * 4096;

const ORIGIN = "https://deck3d-sandbox.invalid";

export class DecodeUnavailableError extends Error {
  constructor() {
    super("chromium missing (npx playwright install chromium)");
    this.name = "DecodeUnavailableError";
  }
}

export interface Sandbox {
  decode(bytes: Uint8Array, mime: string, opts?: { size?: number }): Promise<RgbaImage>;
  /** URLs the page tried to fetch other than the input (for tests/audits). */
  blocked: string[];
  close(): Promise<void>;
}

export function sniffMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  return "application/octet-stream";
}

/** Pixel dimensions from the container header alone (no decoding); undefined when unknown. */
export function peekDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) return { width: v.getUint32(16), height: v.getUint32(20) };
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return { width: v.getUint16(6, true), height: v.getUint16(8, true) };
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // Walk JPEG segments to the first start-of-frame marker.
    let p = 2;
    while (p + 9 < bytes.length) {
      if (bytes[p] !== 0xff) return undefined;
      const marker = bytes[p + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: v.getUint16(p + 5), width: v.getUint16(p + 7) };
      p += 2 + v.getUint16(p + 2);
    }
    return undefined;
  }
  if (bytes.length >= 30 && bytes[0] === 0x52 && bytes[8] === 0x57) {
    const kind = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (kind === "VP8X") return { width: 1 + (v.getUint8(24) | (v.getUint8(25) << 8) | (v.getUint8(26) << 16)), height: 1 + (v.getUint8(27) | (v.getUint8(28) << 8) | (v.getUint8(29) << 16)) };
    if (kind === "VP8 ") return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
    if (kind === "VP8L") {
      const bits = v.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return undefined;
}

/**
 * Refuse an image that would decode past the pixel cap, from its header alone
 * (raster) or its requested `--size` (SVG, rasterised at size × size at most).
 */
export function assertDecodable(bytes: Uint8Array, mime: string, svgSize = 1024): void {
  if (bytes.length > DECODE_MAX_BYTES) throw new Error(`input is ${bytes.length} bytes (limit ${DECODE_MAX_BYTES / 1024 / 1024} MB)`);
  const dims = mime === "image/svg+xml" ? { width: svgSize, height: svgSize } : peekDimensions(bytes);
  if (!dims) return;
  if (dims.width * dims.height > DECODE_MAX_PIXELS) {
    const mp = ((dims.width * dims.height) / 1e6).toFixed(1);
    throw new Error(`image is ${dims.width}×${dims.height} (${mp} megapixels; limit ${(DECODE_MAX_PIXELS / 1e6).toFixed(1)} megapixels)`);
  }
}

/** Launch one sandbox browser; reuse it for many decodes, then `close()`. */
export async function openSandbox(): Promise<Sandbox> {
  let browser: Browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ channel: "chromium" });
  } catch {
    throw new DecodeUnavailableError();
  }
  const blocked: string[] = [];
  const context: BrowserContext = await browser.newContext({ javaScriptEnabled: false, offline: false });
  return {
    blocked,
    async decode(bytes, mime, opts = {}) {
      assertDecodable(bytes, mime, opts.size);
      const page = await context.newPage();
      try {
        await page.route("**/*", (route) => {
          const url = route.request().url();
          if (url === `${ORIGIN}/`) {
            return route.fulfill({ status: 200, contentType: "text/html", body: '<!doctype html><html><body><img id="i" src="/input"></body></html>' });
          }
          if (url === `${ORIGIN}/input`) return route.fulfill({ status: 200, contentType: mime, body: Buffer.from(bytes) });
          blocked.push(url);
          return route.abort();
        });
        await page.goto(`${ORIGIN}/`);
        const size = opts.size ?? 1024;
        const result = await page.evaluate(async (longest: number) => {
          const img = document.getElementById("i") as HTMLImageElement;
          if (!img.complete) await new Promise((res) => img.addEventListener("load", res, { once: true }));
          await img.decode().catch(() => undefined);
          if (!img.naturalWidth && !img.naturalHeight && !img.width) return { error: "image failed to decode" };
          return { w: img.naturalWidth || longest, h: img.naturalHeight || longest };
        }, size);
        if ("error" in result) throw new Error(String(result.error));
        let { w, h } = result as { w: number; h: number };
        // Backstop for a header `peekDimensions` could not read: check what the page decoded
        // BEFORE the canvas, the RGBA buffer and the base64 string are allocated.
        if (w * h > DECODE_MAX_PIXELS && mime !== "image/svg+xml") throw new Error(`image is ${w}×${h} (${((w * h) / 1e6).toFixed(1)} megapixels; limit ${(DECODE_MAX_PIXELS / 1e6).toFixed(1)} megapixels)`);
        if (mime === "image/svg+xml") {
          const k = size / Math.max(w, h);
          w = Math.max(1, Math.round(w * k));
          h = Math.max(1, Math.round(h * k));
        }
        const b64 = await page.evaluate(
          ([W, H]) => {
            const img = document.getElementById("i") as HTMLImageElement;
            const canvas = document.createElement("canvas");
            canvas.width = W;
            canvas.height = H;
            const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
            ctx.drawImage(img, 0, 0, W, H);
            const data = ctx.getImageData(0, 0, W, H).data;
            let s = "";
            for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
            return btoa(s);
          },
          [w, h] as [number, number],
        );
        return { width: w, height: h, data: new Uint8Array(Buffer.from(b64, "base64")) };
      } finally {
        await page.close();
      }
    },
    async close() {
      await browser.close();
    },
  };
}
