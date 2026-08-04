/**
 * Atomic-write hardening (#X10 / #X11 + the security pass findings).
 * Exercises the REAL filesystem writer from env.ts in a temp dir.
 *
 * See change: add-apple-tools-imcp-plugin.
 */

import { mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInstallerEnv } from "../env.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "apple-tools-atomic-"));
}

/** The real ConfigIO from the env factory. */
function realIO() {
  return createInstallerEnv({ piAgentHome: tmp() }).configIO;
}

describe("writeFileAtomic (real fs)", () => {
  it("#X10: replaces content completely \u2014 never a truncated file", () => {
    const dir = tmp();
    const target = join(dir, "mcp.json");
    const io = realIO();
    writeFileSync(target, JSON.stringify({ old: true }));
    io.writeFileAtomic(target, JSON.stringify({ new: true }));
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ new: true });
  });

  it("creates the parent directory when absent", () => {
    const dir = tmp();
    const target = join(dir, "nested", "deep", "mcp.json");
    realIO().writeFileAtomic(target, "{}\n");
    expect(readFileSync(target, "utf8")).toBe("{}\n");
  });

  it("writes the destination as 0600 (never widens a private config)", () => {
    const dir = tmp();
    const target = join(dir, "mcp.json");
    realIO().writeFileAtomic(target, "{}\n");
    // rename carries the temp file's mode onto the destination.
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it("leaves no temp files behind on success", () => {
    const dir = tmp();
    realIO().writeFileAtomic(join(dir, "mcp.json"), "{}\n");
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("does not follow a pre-planted symlink at the destination path's dir", () => {
    // The temp name is random + opened with `wx`, so a symlink planted under a
    // guessed name cannot be followed. Assert the destination is a real file
    // and the outside target was never written through.
    const dir = tmp();
    const outside = join(tmp(), "victim.txt");
    writeFileSync(outside, "untouched");
    const link = join(dir, "link.json");
    symlinkSync(outside, link);

    // Writing "through" the symlink path replaces the LINK with a real file
    // (rename is not symlink-following), leaving the victim intact.
    realIO().writeFileAtomic(link, "{}\n");
    expect(readFileSync(outside, "utf8")).toBe("untouched");
    expect(statSync(link).isSymbolicLink()).toBe(false);
  });
});
