/**
 * Stack detection: marker files → best-guess stack; bare dir → null.
 * See change: project-init-skill-and-profiles.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectStack, stackSubstitutions, STACKS } from "../project-init/detect-stack.js";

describe("project-init detect-stack", () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stack-")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const touch = (name: string, body = "") => fs.writeFileSync(path.join(dir, name), body);

  it("returns null for a bare directory", () => {
    expect(detectStack(dir)).toBeNull();
  });

  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
    ["Cargo.toml", "cargo"],
    ["go.mod", "go"],
    ["poetry.lock", "poetry"],
    ["requirements.txt", "pip"],
    ["pom.xml", "maven"],
    ["build.gradle", "gradle"],
  ])("detects %s → %s", (marker, id) => {
    touch(marker);
    expect(detectStack(dir)?.id).toBe(id);
  });

  it("prefers a JS lockfile over a plain package.json", () => {
    touch("package.json", "{}");
    touch("pnpm-lock.yaml");
    expect(detectStack(dir)?.id).toBe("pnpm");
  });

  it("classifies pyproject.toml with [tool.poetry] as poetry, else pip", () => {
    touch("pyproject.toml", "[tool.poetry]\nname='x'\n");
    expect(detectStack(dir)?.id).toBe("poetry");
    fs.rmSync(path.join(dir, "pyproject.toml"));
    touch("pyproject.toml", "[build-system]\n");
    expect(detectStack(dir)?.id).toBe("pip");
  });

  it("every stack fills all template substitution keys", () => {
    for (const stack of Object.values(STACKS)) {
      const subs = stackSubstitutions(stack);
      expect(Object.keys(subs).sort()).toEqual(
        ["BUILD_CMD", "INIT_COMMAND", "INIT_GATE", "INSTALL_CMD", "TEST_CMD"].sort(),
      );
      expect(Object.values(subs).every((v) => v.length > 0)).toBe(true);
    }
  });
});
