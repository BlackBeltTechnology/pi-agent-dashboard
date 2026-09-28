/**
 * Parse-cache tests for the EML lib (change: add-eml-preview).
 * Mocks `mailparser` so `simpleParser` invocations are countable: verifies one
 * parse is reused across repeated loads (test-plan #19), that an mtime change
 * invalidates the entry (test-plan #20), and that the LRU is bounded at 8.
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const simpleParser = vi.fn(async (_buf: Buffer) => ({ subject: "x", attachments: [] }));
vi.mock("mailparser", () => ({ simpleParser: (buf: Buffer) => simpleParser(buf) }));

import { clearEmlCache, loadParsedEml } from "../lib/eml.js";

describe("EML parse cache", () => {
  let tmp: string;
  let file: string;

  beforeEach(async () => {
    clearEmlCache();
    simpleParser.mockClear();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "eml-cache-"));
    file = path.join(tmp, "mail.eml");
    await fsp.writeFile(file, "raw");
  });
  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("parses once across repeated loads with the same stat (test-plan #19)", async () => {
    const stat = await fsp.stat(file);
    await loadParsedEml(file, stat);
    await loadParsedEml(file, stat);
    await loadParsedEml(file, stat);
    expect(simpleParser).toHaveBeenCalledTimes(1);
  });

  it("re-parses when the mtime changes (test-plan #20)", async () => {
    const stat1 = await fsp.stat(file);
    await loadParsedEml(file, stat1);
    // Simulate an on-disk change: a new mtime yields a new cache key.
    const stat2 = { ...stat1, mtimeMs: stat1.mtimeMs + 1000 } as typeof stat1;
    await loadParsedEml(file, stat2);
    expect(simpleParser).toHaveBeenCalledTimes(2);
  });

  it("bounds the LRU at 8 entries (test-plan #20 cont.)", async () => {
    const base = await fsp.stat(file);
    // 9 distinct keys → the first (oldest) is evicted.
    for (let i = 0; i < 9; i++) {
      await loadParsedEml(file, { ...base, size: base.size + i } as typeof base);
    }
    expect(simpleParser).toHaveBeenCalledTimes(9);
    // Re-loading the oldest key (i=0) must re-parse (it was evicted).
    await loadParsedEml(file, { ...base, size: base.size + 0 } as typeof base);
    expect(simpleParser).toHaveBeenCalledTimes(10);
  });

  // Task 4.5 round 2, B2. A grant-admitted EML read hands `loadParsedEml` the
  // bytes it read from its VERIFIED handle (design D14). Those bytes are
  // authoritative — but the cache used to be consulted first and returned
  // immediately, so on a warm entry the verified bytes were silently DISCARDED.
  // These two tests pin the contract; both fail against the pre-fix code.
  describe("a prefetched (handle-verified) buffer overrides the cache", () => {
    const echoSubject = async (buf: Buffer) => ({
      subject: buf.toString("utf8"),
      attachments: [],
    });

    it("is parsed even when a pathname-derived entry is already cached", async () => {
      const stat = await fsp.stat(file);
      // Warm the cache through the PATHNAME branch (on-disk content is "raw").
      simpleParser.mockImplementationOnce(echoSubject);
      const cached = await loadParsedEml(file, stat);
      expect(cached.subject).toBe("raw");
      expect(simpleParser).toHaveBeenCalledTimes(1);

      // A verified buffer must NOT be superseded by that warm entry.
      simpleParser.mockImplementationOnce(echoSubject);
      const parsed = await loadParsedEml(file, stat, Buffer.from("verified-bytes"));
      expect(parsed).not.toBe(cached);
      expect(parsed.subject).toBe("verified-bytes");
      expect(simpleParser).toHaveBeenCalledTimes(2);
    });

    it("refreshes the cached entry, so a later pathname read serves the verified parse", async () => {
      const stat = await fsp.stat(file);
      simpleParser.mockImplementationOnce(echoSubject);
      await loadParsedEml(file, stat, Buffer.from("verified-bytes"));
      // No extra parse: the refreshed entry is reused, and it holds the
      // VERIFIED content rather than the on-disk "raw".
      const again = await loadParsedEml(file, stat);
      expect(again.subject).toBe("verified-bytes");
      expect(simpleParser).toHaveBeenCalledTimes(1);
    });
  });
});
