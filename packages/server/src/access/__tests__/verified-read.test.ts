/**
 * Unit tests for `openVerifiedRegularFile` / `assertRegularFile` (task 2.8).
 *
 * These cover the four refusal mechanisms directly, which the route-level suite
 * (`__tests__/granted-read-verification.test.ts`) cannot isolate:
 *   - `not-regular` for a directory, a FIFO and a symlink — each refused BEFORE
 *     any `open`, so a granted FIFO cannot block a request;
 *   - `handle-mismatch` for a path whose `lstat` and `open` disagree — the
 *     inode bind that actually closes the check→open window (X5).
 *
 * See change: add-access-grants-and-review.
 */

import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertRegularFile,
  openVerifiedRegularFile,
  readFileVerified,
  readFileVerifiedUtf8,
  VerifiedReadRefused,
} from "../verified-read.js";

const posix = process.platform !== "win32";
const mkfifo = (p: string): void => {
  execFileSync("mkfifo", [p]);
};

let dir: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "vr-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("openVerifiedRegularFile", () => {
  it("opens a regular file and hands back a usable handle", async () => {
    const file = path.join(dir, "a.txt");
    await fsp.writeFile(file, "payload");
    const handle = await openVerifiedRegularFile(file);
    try {
      expect(await handle.readFile("utf-8")).toBe("payload");
    } finally {
      await handle.close();
    }
  });

  it("refuses a directory as not-regular", async () => {
    await expect(openVerifiedRegularFile(dir)).rejects.toBeInstanceOf(VerifiedReadRefused);
    await expect(openVerifiedRegularFile(dir)).rejects.toMatchObject({ reason: "not-regular" });
  });

  it.skipIf(!posix)("refuses a FIFO as not-regular, without opening it", async () => {
    const fifo = path.join(dir, "pipe");
    mkfifo(fifo);
    // Opening the FIFO would block this worker forever; the assertion settling
    // at all is the proof that the `lstat` ran first.
    await expect(openVerifiedRegularFile(fifo)).rejects.toMatchObject({ reason: "not-regular" });
  });

  it("refuses a symlink even when its target is a regular file", async () => {
    const target = path.join(dir, "target.txt");
    await fsp.writeFile(target, "x");
    const link = path.join(dir, "link.txt");
    await fsp.symlink(target, link);
    await expect(openVerifiedRegularFile(link)).rejects.toMatchObject({ reason: "not-regular" });
  });

  it("refuses when the opened handle is not the file lstat described (X5)", async () => {
    const real = path.join(dir, "real.txt");
    const decoy = path.join(dir, "decoy.txt");
    await fsp.writeFile(real, "real-bytes");
    await fsp.writeFile(decoy, "decoy-bytes");

    // Simulate the swap the check→open window permits: containment resolved
    // `real`, but by open time the descriptor belongs to a different inode.
    const decoyStat = await fsp.lstat(decoy);
    vi.spyOn(fsp, "lstat").mockResolvedValue(decoyStat);

    await expect(openVerifiedRegularFile(real)).rejects.toMatchObject({
      reason: "handle-mismatch",
    });
  });

  it("propagates ENOENT unchanged rather than misreporting it as a refusal", async () => {
    const missing = path.join(dir, "nope.txt");
    const err = await openVerifiedRegularFile(missing).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(VerifiedReadRefused);
    expect((err as NodeJS.ErrnoException).code).toBe("ENOENT");
  });
});

describe("readFileVerified / readFileVerifiedUtf8", () => {
  it("reads a regular file whole, and as UTF-8", async () => {
    const file = path.join(dir, "b.txt");
    await fsp.writeFile(file, "héllo");
    expect(await readFileVerified(file)).toEqual(Buffer.from("héllo"));
    expect(await readFileVerifiedUtf8(file)).toBe("héllo");
  });

  it("refuses a non-regular file", async () => {
    await expect(readFileVerified(dir)).rejects.toBeInstanceOf(VerifiedReadRefused);
  });
});

describe("assertRegularFile", () => {
  it("accepts a regular file", async () => {
    const file = path.join(dir, "c.txt");
    await fsp.writeFile(file, "x");
    await expect(assertRegularFile(file)).resolves.toBeUndefined();
  });

  it("refuses a directory and a symlink", async () => {
    const target = path.join(dir, "t.txt");
    await fsp.writeFile(target, "x");
    const link = path.join(dir, "l.txt");
    await fsp.symlink(target, link);
    await expect(assertRegularFile(dir)).rejects.toBeInstanceOf(VerifiedReadRefused);
    await expect(assertRegularFile(link)).rejects.toBeInstanceOf(VerifiedReadRefused);
  });

  it.skipIf(!posix)("refuses a FIFO, which is the blocking hazard it exists for", async () => {
    const fifo = path.join(dir, "pipe");
    mkfifo(fifo);
    await expect(assertRegularFile(fifo)).rejects.toMatchObject({ reason: "not-regular" });
  });
});
