/**
 * Opens are bound to the real path a containment decision was made on: a link swapped in after the
 * decision is refused, and an out-of-process conversion that outlives a swap leaves no output.
 * See change: close-local-listener-and-egress-gaps (D2).
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openVerifiedRegularFile } from "../access/verified-read.js";
import { ContainmentBindingRefused, DashboardStateRefused, openStateChecked, readFileStateChecked } from "../lib/dashboard-state-guard.js";
import { convertBound } from "../lib/office-preview.js";
import { isAllowedReal } from "../lib/path-containment.js";

describe("decided-real binding", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "binding-")));
    await fsp.writeFile(path.join(dir, "a.txt"), "A");
    await fsp.writeFile(path.join(dir, "b.txt"), "B");
  });
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("isAllowedReal returns the real path of an in-anchor link and refuses an escaping one", async () => {
    await fsp.symlink(path.join(dir, "a.txt"), path.join(dir, "in"));
    await fsp.symlink("/etc/hosts", path.join(dir, "out"));
    expect(await isAllowedReal(path.join(dir, "in"), { anchors: [dir] })).toEqual({ allowed: true, real: path.join(dir, "a.txt") });
    expect((await isAllowedReal(path.join(dir, "out"), { anchors: [dir] })).allowed).toBe(false);
  });

  it("a path that now resolves elsewhere is refused (ContainmentBindingRefused is a DashboardStateRefused)", async () => {
    const link = path.join(dir, "swap");
    await fsp.symlink(path.join(dir, "a.txt"), link);
    // decision was made on a.txt; the link is retargeted before the open
    await fsp.rm(link);
    await fsp.symlink(path.join(dir, "b.txt"), link);
    const err = await readFileStateChecked(link, "utf-8", { decidedReal: path.join(dir, "a.txt") }).catch((e) => e);
    expect(err).toBeInstanceOf(ContainmentBindingRefused);
    expect(err).toBeInstanceOf(DashboardStateRefused);
    await expect(readFileStateChecked(path.join(dir, "a.txt"), "utf-8", { decidedReal: path.join(dir, "a.txt") })).resolves.toBe("A");
  });

  it("openStateChecked / openVerifiedRegularFile refuse a mismatched decided real", async () => {
    await expect(openStateChecked(path.join(dir, "a.txt"), "r", { decidedReal: path.join(dir, "b.txt") })).rejects.toBeInstanceOf(
      ContainmentBindingRefused,
    );
    await expect(openVerifiedRegularFile(path.join(dir, "a.txt"), { decidedReal: path.join(dir, "b.txt") })).rejects.toMatchObject({
      name: "VerifiedReadRefused",
    });
  });

  it("convertBound deletes the output and refuses when the file was swapped during conversion", async () => {
    const target = path.join(dir, "doc.docx");
    const out = path.join(dir, "out.pdf");
    await fsp.writeFile(target, "orig");
    const engine = {
      available: async () => true,
      toPdf: async (_p: string, o: string) => {
        await fsp.writeFile(o, "%PDF");
        // new inode allocated while the old one still exists (an rm+write can reuse the inode on ext4)
        await fsp.writeFile(`${target}.new`, "swapped-in-different-inode");
        await fsp.rename(`${target}.new`, target);
      },
    };
    await expect(convertBound(engine, target, out)).rejects.toBeInstanceOf(ContainmentBindingRefused);
    await expect(fsp.access(out)).rejects.toThrow();
  });

  it("convertBound keeps the output when nothing changed", async () => {
    const target = path.join(dir, "doc.docx");
    const out = path.join(dir, "out.pdf");
    await fsp.writeFile(target, "orig");
    await convertBound({ available: async () => true, toPdf: async (_p, o) => fsp.writeFile(o, "%PDF") }, target, out);
    await expect(fsp.readFile(out, "utf-8")).resolves.toBe("%PDF");
  });

  it("convertBound leaves no temp file when publishing (rename) fails", async () => {
    const target = path.join(dir, "doc.docx");
    const out = path.join(dir, "out.pdf");
    await fsp.writeFile(target, "orig");
    // a non-empty directory at `out` makes the final rename fail
    await fsp.mkdir(out);
    await fsp.writeFile(path.join(out, "keep"), "x");
    await expect(
      convertBound({ available: async () => true, toPdf: async (_p, o) => fsp.writeFile(o, "%PDF") }, target, out),
    ).rejects.toThrow();
    expect((await fsp.readdir(dir)).filter((n) => n.endsWith(".tmp.pdf"))).toEqual([]);
  });

  it("a swap during conversion leaves a pre-existing cache entry untouched", async () => {
    const target = path.join(dir, "doc.docx");
    const out = path.join(dir, "out.pdf");
    await fsp.writeFile(target, "orig");
    await fsp.writeFile(out, "GOOD");
    const engine = {
      available: async () => true,
      toPdf: async (_p: string, o: string) => {
        await fsp.writeFile(o, "POISONED");
        await fsp.writeFile(`${target}.new`, "swapped");
        await fsp.rename(`${target}.new`, target);
      },
    };
    await expect(convertBound(engine, target, out)).rejects.toBeInstanceOf(ContainmentBindingRefused);
    await expect(fsp.readFile(out, "utf-8")).resolves.toBe("GOOD");
  });
});
