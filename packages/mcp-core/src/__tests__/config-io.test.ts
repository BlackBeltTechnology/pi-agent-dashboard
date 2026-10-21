/**
 * Hardened atomic write (change extract-mcp-client-plugin, task 2.1): a write
 * always lands mode 0600 and leaves no temp file behind.
 */

import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRealConfigIO, writeFileAtomic } from "../config-io.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "mcp-io-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("creates the file with mode 0600 and writes the content", () => {
    const dir = tmp();
    const p = join(dir, "mcp.json");
    writeFileAtomic(p, "hello\n");
    expect(readFileSync(p, "utf8")).toBe("hello\n");
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });

  it("hardens an existing 0644 file on overwrite", () => {
    const dir = tmp();
    const p = join(dir, "mcp.json");
    writeFileSync(p, "old\n", { mode: 0o644 });
    chmodSync(p, 0o644);
    writeFileAtomic(p, "new\n");
    expect(readFileSync(p, "utf8")).toBe("new\n");
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });

  it("creates missing parent directories and leaves no temp file", () => {
    const dir = tmp();
    const p = join(dir, "nested", "deeper", "mcp.json");
    writeFileAtomic(p, "{}\n");
    expect(readFileSync(p, "utf8")).toBe("{}\n");
    const leftovers = readdirSync(join(dir, "nested", "deeper")).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("createRealConfigIO reads absent files as null and writes atomically", () => {
    const dir = tmp();
    const io = createRealConfigIO();
    expect(io.readFile(join(dir, "absent.json"))).toBeNull();
    io.writeFileAtomic(join(dir, "x.json"), "{}\n");
    expect(io.readFile(join(dir, "x.json"))).toBe("{}\n");
  });
});
