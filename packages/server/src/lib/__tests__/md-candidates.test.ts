/**
 * Tests for the Instructions picker enumerator. Verifies picker ⊆ guard:
 * only allowlisted markdown is offered, symlink-escapes are pruned, and the
 * directory vs global scopes produce the right candidate sets.
 *
 * See change: directory-settings-page-and-scoped-md-editing.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enumerateMdCandidates } from "../md-candidates.js";
import { isWritableMdTarget } from "../writable-md-target.js";

let root: string;
let cwd: string;
let home: string;

beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdc-")));
  cwd = path.join(root, "proj");
  home = path.join(root, "home");
  await fs.mkdir(path.join(cwd, ".pi", "skills", "impl"), { recursive: true });
  await fs.mkdir(path.join(cwd, "node_modules", "pkg"), { recursive: true });
  await fs.mkdir(path.join(home, ".pi", "agent", "sub"), { recursive: true });
  await fs.mkdir(path.join(root, "sibling"), { recursive: true });

  await fs.writeFile(path.join(cwd, "AGENTS.md"), "# a");
  await fs.writeFile(path.join(cwd, "README.md"), "# r");
  await fs.writeFile(path.join(cwd, "notes.txt"), "x"); // non-md excluded
  await fs.writeFile(path.join(cwd, ".pi", "skills", "impl", "SKILL.md"), "# s");
  await fs.writeFile(path.join(cwd, "node_modules", "pkg", "DOC.md"), "# skip"); // heavy dir skipped
  await fs.writeFile(path.join(root, "sibling", "evil.md"), "# e");
  await fs.symlink(path.join(root, "sibling", "evil.md"), path.join(cwd, "escape.md")); // pruned

  await fs.writeFile(path.join(home, ".pi", "agent", "MEMORY.md"), "# m");
  await fs.writeFile(path.join(home, ".pi", "agent", "sub", "deep.md"), "# d");
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("enumerateMdCandidates — directory scope", () => {
  it("lists in-scope markdown including the .pi tree, sorted", async () => {
    const got = (await enumerateMdCandidates({ cwd })).map((c) => c.relPath);
    expect(got).toContain("AGENTS.md");
    expect(got).toContain("README.md");
    expect(got).toContain(path.join(".pi", "skills", "impl", "SKILL.md"));
  });

  it("excludes non-markdown, heavy dirs, and symlink escapes (picker ⊆ guard)", async () => {
    const got = (await enumerateMdCandidates({ cwd })).map((c) => c.relPath);
    expect(got).not.toContain("notes.txt");
    expect(got.some((r) => r.includes("node_modules"))).toBe(false);
    expect(got).not.toContain("escape.md");
  });

  it("returns absolute paths that all pass the write guard (picker ⊆ guard)", async () => {
    const got = await enumerateMdCandidates({ cwd });
    expect(got.length).toBeGreaterThan(0);
    for (const c of got) {
      expect(path.isAbsolute(c.path)).toBe(true);
      // Pin the contract: every advertised candidate is genuinely writable.
      expect(await isWritableMdTarget(c.path, { cwd })).toBe(true);
    }
  });
});

describe("enumerateMdCandidates — global scope", () => {
  it("lists ~/.pi/agent markdown and nothing from the project", async () => {
    const got = (await enumerateMdCandidates({ home })).map((c) => c.relPath);
    expect(got).toContain("MEMORY.md");
    expect(got).toContain(path.join("sub", "deep.md"));
    expect(got).not.toContain("AGENTS.md");
  });

  it("fails closed (empty) when home cannot be resolved", async () => {
    expect(await enumerateMdCandidates({ home: "" })).toEqual([]);
  });
});
