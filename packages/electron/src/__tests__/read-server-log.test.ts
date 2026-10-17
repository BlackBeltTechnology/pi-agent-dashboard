/**
 * `dashboard:read-server-log` backing routine reads at most 8 KiB from the tail of
 * `server.log`, whatever its size, and returns at most `lines` lines.
 *
 * See change: fix-pairing-approval-credential (test-plan #P1; task 5.11).
 */
import { closeSync, mkdirSync, openSync, rmSync, truncateSync, writeSync } from "node:fs";
import path from "node:path";
import { getDashboardServerLogPath } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reads: number[] = [];
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const fd = await actual.open(...args);
      const read = fd.read.bind(fd) as (...a: unknown[]) => Promise<{ bytesRead: number }>;
      (fd as { read: unknown }).read = async (...a: unknown[]) => {
        const r = await read(...a);
        reads.push(r.bytesRead);
        return r;
      };
      return fd;
    },
  };
});

import { readServerLogTail } from "../lib/server-lifecycle.js";

const logPath = getDashboardServerLogPath();
const FIFTY_MB = 50 * 1024 * 1024;

describe("readServerLogTail bound (P1)", () => {
  beforeEach(() => {
    reads.length = 0;
    mkdirSync(path.dirname(logPath), { recursive: true });
    // 50 MB sparse-ish file whose tail holds 100 numbered lines.
    const fd = openSync(logPath, "w");
    closeSync(fd);
    truncateSync(logPath, FIFTY_MB);
    const w = openSync(logPath, "a");
    for (let i = 0; i < 100; i++) writeSync(w, `line-${i}\n`);
    closeSync(w);
  });
  afterEach(() => rmSync(logPath, { force: true }));

  it("a 50 MB log: one read of ≤ 8192 bytes, ≤ 20 lines returned", async () => {
    const out = await readServerLogTail(20);
    expect(reads).toHaveLength(1);
    expect(reads[0]).toBeLessThanOrEqual(8192);
    const lines = out.split("\n");
    expect(lines.length).toBeLessThanOrEqual(20);
    expect(lines.at(-1)).toBe("");
    expect(lines.at(-2)).toBe("line-99");
  });

  it("a missing log returns an empty string without reading", async () => {
    rmSync(logPath, { force: true });
    expect(await readServerLogTail(20)).toBe("");
    expect(reads).toEqual([]);
  });
});
