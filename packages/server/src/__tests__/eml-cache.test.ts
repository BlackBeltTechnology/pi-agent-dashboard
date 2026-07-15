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
});
