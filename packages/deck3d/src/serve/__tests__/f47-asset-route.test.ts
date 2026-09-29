/**
 * F47 — `deck3d serve` serves media beside the deck, same-origin.
 *
 * This route exists for one hard browser reason: a `file://` clip TAINTS the
 * canvas, and a tainted video cannot be uploaded with `texImage2D` — the
 * `video-screen` card would throw instead of painting. Serving the clip from
 * the deck's own origin is what makes a video layer possible at all.
 *
 * The confinement assertions are requirements, not conveniences: this server
 * already refuses to leave loopback, and its asset route must not become a
 * way to read files outside the deck directory.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../../cli.js";
import { type ServeHandle, startServe } from "../index.js";

/**
 * Send a RAW request path, unnormalised.
 *
 * `fetch`/WHATWG `URL` collapse `..` and decode `%2e%2e` before the request
 * leaves the process, so a traversal assertion written with `fetch` passes
 * even with the server's confinement check deleted — it never transmits an
 * escaping path. This sends exactly the bytes given.
 */
function rawGet(url: string, path: string): Promise<number> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path, method: "GET" }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

const open: ServeHandle[] = [];
afterEach(async () => {
  while (open.length) await open.pop()?.close();
});

async function serveDeck(): Promise<{ h: ServeHandle; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "deck3d-assets-"));
  writeFileSync(join(dir, "deck.md"), "# Opening\n\n- one\n");
  mkdirSync(join(dir, "video"), { recursive: true });
  writeFileSync(join(dir, "video", "clip.mp4"), Buffer.from("fake-mp4-bytes"));
  // The file the route must never hand out.
  writeFileSync(join(dir, "..", "outside-secret.png"), Buffer.from("secret"));
  const h = await startServe(join(dir, "deck.md"), { run });
  open.push(h);
  return { h, dir };
}

describe("F47 serve asset route", () => {
  it("serves a clip beside the deck with a video content-type", async () => {
    const { h } = await serveDeck();
    const res = await fetch(new URL("/video/clip.mp4", h.url));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(await res.text()).toBe("fake-mp4-bytes");
  }, 30000);

  it("404s a missing asset rather than failing the page", async () => {
    const { h } = await serveDeck();
    expect((await fetch(new URL("/video/nope.mp4", h.url))).status).toBe(404);
  }, 30000);

  it("refuses to escape the deck directory", async () => {
    const { h } = await serveDeck();
    for (const attempt of [
      // Plain dot-segments are already collapsed by the server's `new URL()`
      // parse, so these are regression cover, not the live threat.
      "/../outside-secret.png",
      "/video/../../outside-secret.png",
      // The live threat: `URL` does NOT decode `%2f`, so the pathname still
      // looks like a single segment to the router while `decodeURIComponent`
      // later expands it into a real traversal. Only the confinement check
      // stops this one.
      "/video%2f..%2f..%2foutside-secret.png",
      "/%2e%2e%2foutside-secret.png",
    ]) {
      const status = await rawGet(h.url, attempt);
      expect(status, `${attempt} must not be served`).not.toBe(200);
    }
  }, 30000);

  it("ignores non-media paths so the deck page still wins", async () => {
    const { h } = await serveDeck();
    const res = await fetch(h.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
  }, 30000);
});
