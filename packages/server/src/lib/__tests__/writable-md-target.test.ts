/**
 * Exhaustive tests for the markdown write-authorization guard — the security
 * boundary for `POST /api/file/write`. Uses real tmp dirs + symlinks so the
 * realpath-normalization path is genuinely exercised.
 *
 * See change: directory-settings-page-and-scoped-md-editing.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isWritableMdTarget } from "../writable-md-target.js";

let root: string; // realpath'd tmp root
let cwd: string; // a project cwd
let home: string; // a fake home for global-scope tests

beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "wmt-")));
  cwd = path.join(root, "proj");
  home = path.join(root, "home");
  await fs.mkdir(path.join(cwd, ".pi", "skills"), { recursive: true });
  await fs.mkdir(path.join(home, ".pi", "agent", "sub"), { recursive: true });
  await fs.mkdir(path.join(root, "sibling"), { recursive: true });
  await fs.mkdir(path.join(home, "Documents"), { recursive: true });

  // Real files so realpath resolves them.
  await fs.writeFile(path.join(cwd, "AGENTS.md"), "# a");
  await fs.writeFile(path.join(cwd, ".pi", "skills", "SKILL.md"), "# s");
  await fs.writeFile(path.join(cwd, "notes.txt"), "x");
  await fs.writeFile(path.join(root, "sibling", "evil.md"), "# e");
  await fs.writeFile(path.join(home, ".pi", "agent", "MEMORY.md"), "# m");
  await fs.writeFile(path.join(home, ".pi", "agent", "sub", "deep.md"), "# d");
  await fs.writeFile(path.join(home, "Documents", "secret.md"), "# x");

  // Symlink inside cwd that escapes to a sibling outside the allowlist.
  await fs.symlink(path.join(root, "sibling", "evil.md"), path.join(cwd, "escape.md"));
  // Symlink inside cwd to a same-dir non-markdown file.
  await fs.symlink(path.join(cwd, "notes.txt"), path.join(cwd, "alias.md"));
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("isWritableMdTarget — directory scope", () => {
  it("allows an in-scope .md at the cwd root", async () => {
    expect(await isWritableMdTarget(path.join(cwd, "AGENTS.md"), { cwd })).toBe(true);
  });

  it("allows an in-scope .md under .pi/**", async () => {
    expect(await isWritableMdTarget(path.join(cwd, ".pi", "skills", "SKILL.md"), { cwd })).toBe(true);
  });

  it("rejects a non-markdown file in scope", async () => {
    expect(await isWritableMdTarget(path.join(cwd, "notes.txt"), { cwd })).toBe(false);
  });

  it("rejects a .. traversal escaping cwd", async () => {
    const target = path.join(cwd, "..", "sibling", "evil.md");
    expect(await isWritableMdTarget(target, { cwd })).toBe(false);
  });

  it("rejects a symlink whose realpath escapes the allowlist", async () => {
    // escape.md lives under cwd but resolves to root/sibling/evil.md.
    expect(await isWritableMdTarget(path.join(cwd, "escape.md"), { cwd })).toBe(false);
  });

  it("rejects a .md symlink resolving to a same-dir non-markdown file", async () => {
    expect(await isWritableMdTarget(path.join(cwd, "alias.md"), { cwd })).toBe(false);
  });

  it("rejects a sibling-dir bypass with a cwd-prefix string", async () => {
    // `${cwd}-evil` shares the cwd string prefix but is not contained.
    const sibling = `${cwd}-evil`;
    await fs.mkdir(sibling, { recursive: true });
    await fs.writeFile(path.join(sibling, "x.md"), "# x");
    expect(await isWritableMdTarget(path.join(sibling, "x.md"), { cwd })).toBe(false);
  });

  it("rejects a relative path", async () => {
    expect(await isWritableMdTarget("AGENTS.md", { cwd })).toBe(false);
  });
});

describe("isWritableMdTarget — global scope", () => {
  it("allows a .md directly under ~/.pi/agent", async () => {
    expect(await isWritableMdTarget(path.join(home, ".pi", "agent", "MEMORY.md"), { home })).toBe(true);
  });

  it("allows a nested .md under ~/.pi/agent/**", async () => {
    expect(await isWritableMdTarget(path.join(home, ".pi", "agent", "sub", "deep.md"), { home })).toBe(true);
  });

  it("rejects a path outside ~/.pi/agent", async () => {
    expect(await isWritableMdTarget(path.join(home, "Documents", "secret.md"), { home })).toBe(false);
  });

  it("rejects an absolute system path", async () => {
    expect(await isWritableMdTarget("/etc/passwd", { home })).toBe(false);
  });

  it("rejects a non-markdown file under ~/.pi/agent", async () => {
    const p = path.join(home, ".pi", "agent", "config.json");
    await fs.writeFile(p, "{}");
    expect(await isWritableMdTarget(p, { home })).toBe(false);
  });

  it("fails closed when home cannot be resolved", async () => {
    expect(await isWritableMdTarget(path.join(home, ".pi", "agent", "MEMORY.md"), { home: "" })).toBe(false);
  });
});
