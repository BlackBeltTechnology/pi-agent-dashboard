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
      if (bytes.length > DECODE_MAX_BYTES) throw new Error(`input is ${bytes.length} bytes (limit ${DECODE_MAX_BYTES / 1024 / 1024} MB)`);
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
