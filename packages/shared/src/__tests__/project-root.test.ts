import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasProjectRootMarker } from "../project-root.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "project-root-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("hasProjectRootMarker", () => {
  it("is true for a `.git` directory, a `.git` file (worktree) and a `.pi` entry", () => {
    const a = path.join(dir, "a");
    fs.mkdirSync(path.join(a, ".git"), { recursive: true });
    const b = path.join(dir, "b");
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(b, ".git"), "gitdir: /elsewhere");
    const c = path.join(dir, "c");
    fs.mkdirSync(path.join(c, ".pi"), { recursive: true });
    expect([a, b, c].map(hasProjectRootMarker)).toEqual([true, true, true]);
  });

  it("is false for a plain directory and a missing path", () => {
    expect(hasProjectRootMarker(dir)).toBe(false);
    expect(hasProjectRootMarker(path.join(dir, "nope"))).toBe(false);
  });
});
