/**
 * Tests for `changelog-fs.ts` covering the scenarios in spec
 * `pi-changelog-display#Requirement: Changelog URL derivation`.
 *
 * See change: pi-update-whats-new-panel.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import {
  findChangelogPath,
  readPackageJson,
  deriveChangelogUrl,
} from "../changelog/changelog-fs.js";

describe("findChangelogPath", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cl-fs-"));
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function makeManagedPkg(pkg: string, files: Record<string, string>): string {
    const dir = path.join(tmpRoot, "node_modules", pkg);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    return dir;
  }

  it("finds CHANGELOG.md in the managed install", () => {
    const dir = makeManagedPkg("@scope/foo", { "CHANGELOG.md": "# log" });
    const out = findChangelogPath("@scope/foo", { managedDir: tmpRoot });
    expect(out).not.toBeNull();
    expect(out!.changelogPath).toBe(path.join(dir, "CHANGELOG.md"));
    expect(out!.packageDir).toBe(dir);
  });

  it("falls back to bare-import resolution when managed is missing", () => {
    const fakeDir = path.join(tmpRoot, "fake-resolved");
    fs.mkdirSync(fakeDir, { recursive: true });
    fs.writeFileSync(path.join(fakeDir, "CHANGELOG.md"), "# log");
    fs.writeFileSync(path.join(fakeDir, "package.json"), "{}");
    const resolveBareImport = (spec: string): string => {
      if (spec === "fake-pkg/package.json") return path.join(fakeDir, "package.json");
      throw new Error("not resolvable");
    };
    const out = findChangelogPath("fake-pkg", {
      managedDir: tmpRoot,
      resolveBareImport,
    });
    expect(out).not.toBeNull();
    expect(out!.packageDir).toBe(fakeDir);
  });

  it("prefers managed when both are present", () => {
    const managed = makeManagedPkg("dual", { "CHANGELOG.md": "# managed" });
    const bareDir = path.join(tmpRoot, "bare");
    fs.mkdirSync(bareDir, { recursive: true });
    fs.writeFileSync(path.join(bareDir, "CHANGELOG.md"), "# bare");
    fs.writeFileSync(path.join(bareDir, "package.json"), "{}");
    const resolveBareImport = (): string => path.join(bareDir, "package.json");
    const out = findChangelogPath("dual", {
      managedDir: tmpRoot,
      resolveBareImport,
    });
    expect(out!.packageDir).toBe(managed);
  });

  it("returns null when neither path has a CHANGELOG", () => {
    const out = findChangelogPath("missing", {
      managedDir: tmpRoot,
      resolveBareImport: () => {
        throw new Error("nope");
      },
      moduleUrl: pathToFileURL(path.join(tmpRoot, "empty", "changelog-fs.ts")).href,
    });
    expect(out).toBeNull();
  });
});

/**
 * Regression: real-world failure where the installed pi-coding-agent
 * ships an `exports` field that exposes only `"."` (import-only) and
 * omits `"./package.json"`. CJS `require.resolve("<pkg>/package.json")`
 * THROWS, so Strategy 2 (bare-import) cannot find the CHANGELOG — even
 * though the file sits in `node_modules/<pkg>/CHANGELOG.md`, reachable
 * by walking up from the server module's own location.
 *
 * This block isolates that scenario: managed dir absent + bare-import
 * throws. findChangelogPath must still locate the file via a
 * filesystem walk up node_modules from `moduleUrl`.
 */
describe("findChangelogPath — exports-wall fallback (Strategy 3)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cl-wall-"));
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  /** Mimics the real exports wall: any subpath resolve throws. */
  const exportsWallResolver = (): string => {
    throw new Error('Package subpath "./package.json" is not defined by "exports"');
  };

  it("walks up node_modules from the module location when bare-import throws", () => {
    // Package physically present at repo-root node_modules, with an
    // exports field that blocks subpath resolution (faithful to pi).
    const pkgDir = path.join(tmpRoot, "node_modules", "@earendil-works", "pi-coding-agent");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "CHANGELOG.md"), "# Changelog\n\n## [0.78.1]\n");
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@earendil-works/pi-coding-agent",
        exports: { ".": { import: "./dist/index.js" } },
      }),
    );

    // Server module lives deep under the same root, mirroring
    // packages/server/src/changelog-fs.ts in the monorepo.
    const moduleFile = path.join(tmpRoot, "packages", "server", "src", "changelog-fs.ts");
    fs.mkdirSync(path.dirname(moduleFile), { recursive: true });

    const out = findChangelogPath("@earendil-works/pi-coding-agent", {
      managedDir: path.join(tmpRoot, "no-managed-dir"), // Strategy 1 fails
      resolveBareImport: exportsWallResolver, // Strategy 2 fails
      moduleUrl: pathToFileURL(moduleFile).href, // Strategy 3 start point
    });

    expect(out).not.toBeNull();
    expect(out!.changelogPath).toBe(path.join(pkgDir, "CHANGELOG.md"));
    expect(out!.packageDir).toBe(pkgDir);
  });
});

describe("readPackageJson", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cl-pkg-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads + parses package.json next to the package dir", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
    const out = readPackageJson(tmpDir);
    expect(out).toEqual({ name: "x", version: "1.0.0" });
  });

  it("returns null when missing", () => {
    expect(readPackageJson(tmpDir)).toBeNull();
  });

  it("returns null on invalid JSON", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{ not json");
    expect(readPackageJson(tmpDir)).toBeNull();
  });
});

describe("deriveChangelogUrl", () => {
  it("parses github:org/repo shorthand", () => {
    expect(deriveChangelogUrl("github:org/repo")).toBe(
      "https://github.com/org/repo/blob/main/CHANGELOG.md",
    );
  });

  it("parses https GitHub URL string", () => {
    expect(deriveChangelogUrl("https://github.com/badlogic/pi-mono.git")).toBe(
      "https://github.com/badlogic/pi-mono/blob/main/CHANGELOG.md",
    );
  });

  it("parses object form with git+https URL", () => {
    expect(
      deriveChangelogUrl({
        type: "git",
        url: "git+https://github.com/BlackBeltTechnology/pi-agent-dashboard.git",
      }),
    ).toBe("https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/main/CHANGELOG.md");
  });

  it("honours monorepo `directory` subfield", () => {
    expect(
      deriveChangelogUrl({
        type: "git",
        url: "https://github.com/org/repo.git",
        directory: "packages/foo",
      }),
    ).toBe("https://github.com/org/repo/blob/main/packages/foo/CHANGELOG.md");
  });

  it("strips leading/trailing slashes from directory", () => {
    expect(
      deriveChangelogUrl({
        url: "https://github.com/org/repo.git",
        directory: "/packages/foo/",
      }),
    ).toBe("https://github.com/org/repo/blob/main/packages/foo/CHANGELOG.md");
  });

  it("parses git@github.com:org/repo.git ssh form", () => {
    expect(deriveChangelogUrl("git@github.com:org/repo.git")).toBe(
      "https://github.com/org/repo/blob/main/CHANGELOG.md",
    );
  });

  it("returns null for non-GitHub repo URLs", () => {
    expect(deriveChangelogUrl("https://gitlab.com/org/repo.git")).toBeNull();
    expect(deriveChangelogUrl({ url: "https://bitbucket.org/x/y" })).toBeNull();
  });

  it("returns null for missing / malformed input", () => {
    expect(deriveChangelogUrl(undefined)).toBeNull();
    expect(deriveChangelogUrl(null)).toBeNull();
    expect(deriveChangelogUrl({})).toBeNull();
    expect(deriveChangelogUrl({ url: "" })).toBeNull();
    expect(deriveChangelogUrl(42)).toBeNull();
  });
});
