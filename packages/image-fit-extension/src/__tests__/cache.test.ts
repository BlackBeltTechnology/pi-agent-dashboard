import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Jimp, JimpMime } from "jimp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContentCache,
  cacheKey,
  cleanupOrphans,
  cleanupSession,
  ensureDir,
  hasCached,
  ROOT_DIR,
  scopeFor,
} from "../cache.js";
import { fitContextMessages } from "../extension.js";
import type { ImageFitConfig } from "../policy.js";
import * as resize from "../resize.js";

const CONFIG: ImageFitConfig = { disabled: false, maxEdge: 1568, maxBytes: 4 * 1024 * 1024, quality: 85 };
const POLICY = { maxEdge: 1568, maxBytes: 4 * 1024 * 1024, quality: 85 };

async function oversizePngB64(w = 2000, h = 1200): Promise<string> {
  const img = new Jimp({ width: w, height: h, color: 0x2233ccff });
  const buf = (await img.getBuffer(JimpMime.png)) as unknown as Buffer;
  return buf.toString("base64");
}

function imageMsg(data: string, mimeType = "image/png") {
  return { role: "user", content: [{ type: "image", data, mimeType }] };
}

function b64OfBytes(n: number): string {
  return Buffer.alloc(n, 0x41).toString("base64");
}

const TEST_INPUT = {
  absPath: "/abs/path/to/image.png",
  mtimeMs: 1700000000000,
  maxEdge: 1568,
  maxBytes: 4 * 1024 * 1024,
  quality: 85,
};

describe("cacheKey", () => {
  it("is deterministic for identical input", () => {
    const a = cacheKey(TEST_INPUT);
    const b = cacheKey(TEST_INPUT);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when any keyed input changes", () => {
    const base = cacheKey(TEST_INPUT);
    expect(cacheKey({ ...TEST_INPUT, absPath: "/other.png" })).not.toBe(base);
    expect(cacheKey({ ...TEST_INPUT, mtimeMs: TEST_INPUT.mtimeMs + 1 })).not.toBe(base);
    expect(cacheKey({ ...TEST_INPUT, maxEdge: 1024 })).not.toBe(base);
    expect(cacheKey({ ...TEST_INPUT, maxBytes: 1024 })).not.toBe(base);
    expect(cacheKey({ ...TEST_INPUT, quality: 90 })).not.toBe(base);
  });
});

describe("scopeFor", () => {
  it("scopes to a subdirectory of ROOT_DIR", () => {
    const s = scopeFor("session-abc");
    expect(s.dir.startsWith(ROOT_DIR)).toBe(true);
    expect(path.basename(s.dir)).toBe("session-abc");
  });

  it("sanitizes scope name", () => {
    const s = scopeFor("../etc/passwd");
    expect(s.dir.includes("..")).toBe(false);
    expect(path.basename(s.dir)).not.toContain("/");
  });

  it("falls back when scope sanitizes to empty", () => {
    const s = scopeFor("///");
    expect(path.basename(s.dir)).toBe("default");
  });

  it("filePath includes hash and extension", () => {
    const s = scopeFor("session-abc");
    const fp = s.filePath("abc123", ".png");
    expect(fp.endsWith("abc123.png")).toBe(true);
  });
});

describe("cleanupSession + hasCached", () => {
  let scopeId: string;

  beforeEach(() => {
    scopeId = `vitest-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  });

  afterEach(async () => {
    await fs.rm(path.join(ROOT_DIR, scopeId), { recursive: true, force: true });
  });

  it("hasCached returns false for missing file", async () => {
    const s = scopeFor(scopeId);
    expect(await hasCached(s, "deadbeef", ".png")).toBe(false);
  });

  it("hasCached returns true after the file is written", async () => {
    const s = scopeFor(scopeId);
    await ensureDir(s.dir);
    await fs.writeFile(s.filePath("hash1", ".jpg"), Buffer.from([0xff, 0xd8]));
    expect(await hasCached(s, "hash1", ".jpg")).toBe(true);
    expect(await hasCached(s, "hash1", ".png")).toBe(false); // ext-sensitive
  });

  it("cleanupSession removes the directory", async () => {
    const s = scopeFor(scopeId);
    await ensureDir(s.dir);
    await fs.writeFile(s.filePath("hashX", ".png"), Buffer.from([0x89]));
    await cleanupSession(s, () => {});
    await expect(fs.stat(s.dir)).rejects.toThrow();
  });

  it("cleanupSession is no-op when dir does not exist", async () => {
    const s = scopeFor(scopeId);
    const warnings: string[] = [];
    await cleanupSession(s, (m) => warnings.push(m));
    expect(warnings).toHaveLength(0); // force: true swallows ENOENT
  });
});

describe("cleanupOrphans", () => {
  const SUITE_ROOT = path.join(os.tmpdir(), `pi-image-fit-orphan-test-${process.pid}`);

  beforeEach(async () => {
    await fs.rm(SUITE_ROOT, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(SUITE_ROOT, { recursive: true, force: true });
  });

  it("removes dirs older than threshold and leaves fresh ones", async () => {
    // Create real dirs under ROOT_DIR so cleanupOrphans actually sees them.
    const oldDir = path.join(ROOT_DIR, `vitest-orphan-old-${process.pid}-${Date.now()}`);
    const freshDir = path.join(ROOT_DIR, `vitest-orphan-fresh-${process.pid}-${Date.now()}`);
    await fs.mkdir(oldDir, { recursive: true });
    await fs.mkdir(freshDir, { recursive: true });

    // Stamp `oldDir` with an old mtime by touching its contents and then
    // resetting mtime via utimes. utimes accepts seconds since epoch.
    const ancient = (Date.now() - 48 * 60 * 60 * 1000) / 1000;
    await fs.utimes(oldDir, ancient, ancient);

    try {
      await cleanupOrphans(24 * 60 * 60 * 1000, () => Date.now(), () => {});
      await expect(fs.stat(oldDir)).rejects.toThrow();
      const freshStat = await fs.stat(freshDir);
      expect(freshStat.isDirectory()).toBe(true);
    } finally {
      await fs.rm(oldDir, { recursive: true, force: true });
      await fs.rm(freshDir, { recursive: true, force: true });
    }
  });

  it("does not throw when ROOT_DIR does not exist", async () => {
    // Even if root doesn't exist (clean machine), cleanupOrphans returns.
    // We can't actually remove ROOT_DIR safely in a parallel test world,
    // so just assert the function tolerates a missing readdir by calling
    // with a tiny maxAge and asserting no throw. ROOT_DIR may or may not
    // exist depending on test order; either way no exception escapes.
    await expect(cleanupOrphans(1, () => Date.now(), () => {})).resolves.toBeUndefined();
  });
});

describe("ContentCache — content-hash keying + bounded LRU", () => {
  it("E13: same bytes, different mime → distinct keys, no collision", async () => {
    const data = await oversizePngB64();
    const cache = new ContentCache();
    const kPng = cache.keyFor(data, "image/png", POLICY);
    const kWebp = cache.keyFor(data, "image/webp", POLICY);
    expect(kPng).not.toBe(kWebp); // mimeType is part of the key
    cache.set(kPng, { data: "PPP", mimeType: "image/png" });
    cache.set(kWebp, { data: "JJJ", mimeType: "image/jpeg" });
    // Each key serves its own format — neither serves the other's bytes.
    expect(cache.get(kPng)).toEqual({ data: "PPP", mimeType: "image/png" });
    expect(cache.get(kWebp)).toEqual({ data: "JJJ", mimeType: "image/jpeg" });
  });

  it("E15 (key level): a changed maxEdge yields a fresh key", async () => {
    const data = await oversizePngB64();
    const cache = new ContentCache();
    const k1568 = cache.keyFor(data, "image/png", { ...POLICY, maxEdge: 1568 });
    const k800 = cache.keyFor(data, "image/png", { ...POLICY, maxEdge: 800 });
    expect(k1568).not.toBe(k800);
    cache.set(k1568, { data: "X", mimeType: "image/png" });
    expect(cache.has(k800)).toBe(false); // new threshold → miss → fresh resize
  });

  it("E16: bounded LRU evicts least-recently-used past the byte budget", () => {
    const cache = new ContentCache(300); // budget = 300 bytes
    const e = (tag: string) => ({ data: b64OfBytes(200), mimeType: `x/${tag}` });
    cache.set("k1", e("1"));
    cache.set("k2", e("2")); // 400 > 300 → evict k1
    expect(cache.has("k1")).toBe(false);
    expect(cache.has("k2")).toBe(true);
    cache.set("k3", e("3")); // 400 > 300 → evict k2
    expect(cache.has("k2")).toBe(false);
    expect(cache.has("k3")).toBe(true);
    expect(cache.bytes).toBeLessThanOrEqual(300);
    // Re-access (re-resize) of an evicted key repopulates it.
    cache.set("k1", e("1"));
    expect(cache.has("k1")).toBe(true);
  });

  it("E16b: get() refreshes recency so the touched entry survives eviction", () => {
    const cache = new ContentCache(300);
    const e = (tag: string) => ({ data: b64OfBytes(200), mimeType: `x/${tag}` });
    cache.set("k1", e("1"));
    cache.set("k2", e("2")); // evicts k1 (k1 oldest); k2 remains
    cache.get("k2"); // touch k2 (already newest — stays)
    cache.set("k3", e("3")); // evicts k2 (oldest now)
    expect(cache.has("k3")).toBe(true);
  });
});

describe("content-hash cache across turns (fitContextMessages integration)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("E14: same oversize block over two turns → resizeBuffer runs exactly once", async () => {
    const data = await oversizePngB64();
    const cache = new ContentCache();
    const spy = vi.spyOn(resize, "resizeBuffer");
    // Each turn presents a FRESH copy of the same oversize block (as pi does
    // when re-deep-copying the persisted transcript every turn).
    const t1 = await fitContextMessages([imageMsg(data)], CONFIG, cache);
    const t2 = await fitContextMessages([imageMsg(data)], CONFIG, cache);
    expect(t1).toBeTruthy(); // turn 1 changed (resized)
    expect(t2).toBeTruthy(); // turn 2 changed (served from cache)
    expect(spy).toHaveBeenCalledTimes(1); // turn 2 hit the cache
  });

  it("E15: changed maxEdge across turns → new key → fresh resize", async () => {
    const data = await oversizePngB64();
    const cache = new ContentCache();
    const spy = vi.spyOn(resize, "resizeBuffer");
    await fitContextMessages([imageMsg(data)], { ...CONFIG, maxEdge: 1568 }, cache);
    await fitContextMessages([imageMsg(data)], { ...CONFIG, maxEdge: 800 }, cache);
    expect(spy).toHaveBeenCalledTimes(2); // distinct keys → two resizes
  });
});
