/**
 * L1 workspace path guard (ported from the Gmail attachment guard; design D11). See change: add-google-connect.
 *
 * Task 12.61 / test-plan #C62 (Drive downloads stay in the workspace, shared with Gmail): Gmail must not import google-plugin,
 * so there is no extracted helper; instead the SAME scenarios run here against this package's guard. Mapping — the six tests
 * of `describe("workspace path guard")` below are 1:1 the six tests of gmail-plugin `bridge/__tests__/attachments.test.ts`
 * (`describe("E27 — attachment confinement")`, same bodies; only the module under test differs):
 *   plain relative target · traversal · symlink final component / symlinked parent · never overwrites · Windows device/UNC/drive forms · reads outside the cwd.
 * Gmail's own suite is run unchanged alongside this one (regression of the refactor decision, task 1.2).
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planSave, readInsideCwd, saveInsideCwd } from "../workspace-path.js";

let cwd: string;
let outside: string;
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "google-cwd-"));
  outside = mkdtempSync(path.join(tmpdir(), "google-out-"));
  mkdirSync(path.join(cwd, "sub"));
  symlinkSync(outside, path.join(cwd, "sub", "link"));
  writeFileSync(path.join(cwd, "existing.txt"), "keep");
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const data = Buffer.from("PDF");

describe("workspace path guard", () => {
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
  it("reads refuse files outside the cwd (incl. via symlink)", async () => {
    writeFileSync(path.join(outside, "secret"), "s");
    await expect(readInsideCwd(cwd, "sub/link/secret")).rejects.toMatchObject({ code: "path_refused" });
    await expect(readInsideCwd(cwd, "existing.txt")).resolves.toEqual(Buffer.from("keep"));
  });
});

describe("size limit", () => {
  it("refuses a file above the caller's limit", async () => {
    await expect(readInsideCwd(cwd, "existing.txt", 2)).rejects.toMatchObject({ code: "too_large" });
  });
});

describe("save plan, parent dirs, temp + link (scenario-gate C11 / #GC11; tasks 12.56–12.60)", () => {
  it("creates missing parent directories inside the cwd and leaves no temp file", async () => {
    const p = await saveInsideCwd(cwd, "out/deep/report.docx", data);
    expect(readFileSync(p, "utf8")).toBe("PDF");
    expect(readdirSync(path.dirname(p))).toEqual(["report.docx"]);
  });
  it("planSave refuses before anything is created (no dirs on refusal)", async () => {
    await expect(planSave(cwd, "out/../../x")).rejects.toMatchObject({ code: "path_refused" });
    await expect(planSave(cwd, "existing.txt")).rejects.toMatchObject({ code: "exists" });
    await expect(planSave(cwd, "sub/link/new/x")).rejects.toMatchObject({ code: "path_refused" });
    expect(existsSync(path.join(outside, "new"))).toBe(false);
    expect(existsSync(path.join(cwd, "out"))).toBe(false);
  });
  it("refuses a directory target, an existing symlink target, '.', '..', a trailing slash, NUL and a 300-char name", async () => {
    writeFileSync(path.join(outside, "f"), "o");
    symlinkSync(path.join(outside, "f"), path.join(cwd, "lnk"));
    for (const t of ["sub", "lnk", ".", "..", "out/", "a\0b", `${"n".repeat(300)}.bin`]) {
      await expect(saveInsideCwd(cwd, t, data), t).rejects.toBeInstanceOf(Error);
    }
    expect(readFileSync(path.join(outside, "f"), "utf8")).toBe("o");
    expect(existsSync(path.join(cwd, "out"))).toBe(false);
    expect(readdirSync(cwd).sort()).toEqual(["existing.txt", "lnk", "sub"]);
  });
  it("two concurrent saves to one new path: exactly one wins and the file holds the winner's bytes", async () => {
    const r = await Promise.allSettled([saveInsideCwd(cwd, "race.bin", Buffer.from("AAAA")), saveInsideCwd(cwd, "race.bin", Buffer.from("BBBB"))]);
    const won = r.filter((x) => x.status === "fulfilled");
    expect(won).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    const winner = r[0]?.status === "fulfilled" ? "AAAA" : "BBBB";
    expect(readFileSync(path.join(cwd, "race.bin"), "utf8")).toBe(winner);
    expect(readdirSync(cwd).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
  it("a cwd that is itself a symlink still works", async () => {
    const holder = mkdtempSync(path.join(tmpdir(), "google-hold-"));
    const linked = path.join(holder, "ws");
    symlinkSync(cwd, linked);
    try {
      await saveInsideCwd(linked, "out/x.bin", data);
      expect(readFileSync(path.join(cwd, "out", "x.bin"), "utf8")).toBe("PDF");
    } finally {
      rmSync(holder, { recursive: true, force: true });
    }
  });
});
