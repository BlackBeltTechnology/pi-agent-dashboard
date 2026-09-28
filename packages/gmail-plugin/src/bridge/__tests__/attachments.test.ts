/**
 * L1 attachment confinement (test-plan E27). See change: add-gmail-plugin.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readInsideCwd, saveInsideCwd } from "../attachments.js";

let cwd: string;
let outside: string;
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "gmail-cwd-"));
  outside = mkdtempSync(path.join(tmpdir(), "gmail-out-"));
  mkdirSync(path.join(cwd, "sub"));
  symlinkSync(outside, path.join(cwd, "sub", "link"));
  writeFileSync(path.join(cwd, "existing.txt"), "keep");
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const data = Buffer.from("PDF");

describe("E27 — attachment confinement", () => {
  it("writes a plain relative target", async () => {
    const p = await saveInsideCwd(cwd, "a.pdf", data);
    expect(readFileSync(p, "utf8")).toBe("PDF");
  });
  it("refuses traversal", async () => {
    await expect(saveInsideCwd(cwd, "../../.ssh/x", data)).rejects.toMatchObject({ code: "path_refused" });
  });
  it("refuses a symlink (final component) and a symlinked parent escaping the cwd", async () => {
    await expect(saveInsideCwd(cwd, "sub/link", data)).rejects.toBeDefined();
    await expect(saveInsideCwd(cwd, "sub/link/x", data)).rejects.toMatchObject({ code: "path_refused" });
    expect(existsSync(path.join(outside, "x"))).toBe(false);
  });
  it("never overwrites an existing file", async () => {
    await expect(saveInsideCwd(cwd, "existing.txt", data)).rejects.toMatchObject({ code: "exists" });
    expect(readFileSync(path.join(cwd, "existing.txt"), "utf8")).toBe("keep");
  });
  it("refuses Windows device / UNC / drive forms", async () => {
    for (const t of ["\\\\?\\C:\\x", "\\\\server\\share\\x", "C:\\x", "//server/x"]) {
      await expect(saveInsideCwd(cwd, t, data), t).rejects.toMatchObject({ code: "path_refused" });
    }
  });
  it("attach reads refuse files outside the cwd (incl. via symlink)", async () => {
    writeFileSync(path.join(outside, "secret"), "s");
    await expect(readInsideCwd(cwd, "sub/link/secret")).rejects.toMatchObject({ code: "path_refused" });
    await expect(readInsideCwd(cwd, "existing.txt")).resolves.toEqual(Buffer.from("keep"));
  });
});
