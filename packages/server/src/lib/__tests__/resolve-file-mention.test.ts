/**
 * Unit tests for `resolveFileMention` — the lazy server-side mention resolver.
 *
 * Fake-HOME harness: `$HOME` is repointed at a tmp dir so `~/.pi/…` mentions
 * resolve under a controlled home without touching the developer's real home.
 * Containment + tilde-expansion + containment-before-stat are the load-bearing
 * behaviors (design D2/D7). See change: server-side-file-mention-resolution.
 */

import fsp from "node:fs/promises";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveFileMention } from "../resolve-file-mention.js";

describe("resolveFileMention", () => {
  let home: string;
  let cwd: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    // Real path (macOS /tmp is a symlink to /private/tmp) so containment's
    // realpath layer does not spuriously reject.
    home = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rfm-home-")));
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rfm-cwd-")));
    origHome = process.env.HOME;
    process.env.HOME = home; // os.homedir() reads $HOME on POSIX
    await fsp.mkdir(path.join(home, ".pi", "dashboard"), { recursive: true });
    await fsp.writeFile(path.join(home, ".pi", "dashboard", "worktree-init-trust.json"), "{}\n");
  });

  afterEach(async () => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    vi.restoreAllMocks();
    await fsp.rm(home, { recursive: true, force: true });
    await fsp.rm(cwd, { recursive: true, force: true });
  });

  it("resolves a `~/.pi` home file under home with kind tilde (S2)", async () => {
    const res = await resolveFileMention("~/.pi/dashboard/worktree-init-trust.json", { cwd });
    expect(res).toEqual({
      resolved: path.join(home, ".pi", "dashboard", "worktree-init-trust.json"),
      kind: "tilde",
    });
  });

  it("rejects a home file outside `~/.pi` → null (S3)", async () => {
    // Create ~/.ssh/id_rsa to prove rejection is by containment, not absence.
    await fsp.mkdir(path.join(home, ".ssh"), { recursive: true });
    await fsp.writeFile(path.join(home, ".ssh", "id_rsa"), "PRIVATE\n");
    const res = await resolveFileMention("~/.ssh/id_rsa", { cwd });
    expect(res).toBeNull();
  });

  it("rejects a tilde traversal escape after expand+containment (S4)", async () => {
    const res = await resolveFileMention("~/../../etc/passwd", { cwd });
    expect(res).toBeNull();
  });

  it("resolves a relative mention rooted at cwd with kind relative (S5)", async () => {
    await fsp.mkdir(path.join(cwd, "sub"), { recursive: true });
    await fsp.writeFile(path.join(cwd, "sub", "file.ts"), "x\n");
    const res = await resolveFileMention("sub/file.ts", { cwd });
    expect(res).toEqual({ resolved: path.join(cwd, "sub", "file.ts"), kind: "relative" });
  });

  it("returns null for a nonexistent mention (S6)", async () => {
    const res = await resolveFileMention("foo.ts", { cwd });
    expect(res).toBeNull();
  });

  it("does not expand `~user/` to another user home (S7)", async () => {
    const res = await resolveFileMention("~alice/x.ts", { cwd });
    expect(res).toBeNull();
  });

  it("runs fs.stat only AFTER containment passes, never before (S8)", async () => {
    const statSpy = vi.spyOn(fs, "stat");
    // Fails containment (outside cwd / git-root / ~/.pi) → must not stat.
    const res = await resolveFileMention("~/../../etc/passwd", { cwd });
    expect(res).toBeNull();
    expect(statSpy).not.toHaveBeenCalled();
  });
});
