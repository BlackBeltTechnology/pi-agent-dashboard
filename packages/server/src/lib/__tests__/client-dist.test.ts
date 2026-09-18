/**
 * Static-client resolution precedence — folds test-plan scenarios E10 and E11.
 *
 * Resolution is package-first; the workspace sibling is a fallback ONLY when
 * the package is unresolvable. A resolvable package whose `dist/` has no
 * `index.html` is API-only — never a silent workspace fallback.
 *
 * See change: add-served-build-coherence-and-hash-parity (design D3).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveStaticClientDir } from "../client-dist.js";

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "client-dist-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Create a directory that looks like a built client (`index.html` present). */
function makeClientBuild(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html>", "utf-8");
  return dir;
}

/** Create a resolvable web package whose dist/ may or may not be a build. */
function makeWebPackage(opts: { withBuild: boolean }): string {
  const pkgDir = tmpDir();
  fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: "@x/web" }), "utf-8");
  if (opts.withBuild) makeClientBuild(path.join(pkgDir, "dist"));
  else fs.mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
  return path.join(pkgDir, "package.json");
}

describe("resolveStaticClientDir (E10, E11)", () => {
  it("E10 prefers the installed package when both package and workspace builds exist", () => {
    const pkgJson = makeWebPackage({ withBuild: true });
    const workspace = makeClientBuild(path.join(tmpDir(), "client", "dist"));

    const resolved = resolveStaticClientDir({
      requireResolve: () => pkgJson,
      workspaceClientDir: workspace,
    });

    expect(resolved).toBe(path.join(path.dirname(pkgJson), "dist"));
  });

  it("E10 returns the package dir when only the package build exists", () => {
    const pkgJson = makeWebPackage({ withBuild: true });

    const resolved = resolveStaticClientDir({
      requireResolve: () => pkgJson,
      workspaceClientDir: path.join(tmpDir(), "missing", "dist"),
    });

    expect(resolved).toBe(path.join(path.dirname(pkgJson), "dist"));
  });

  it("E10 returns the workspace dir when the package is unresolvable", () => {
    const workspace = makeClientBuild(path.join(tmpDir(), "client", "dist"));

    const resolved = resolveStaticClientDir({
      requireResolve: () => {
        throw new Error("MODULE_NOT_FOUND");
      },
      workspaceClientDir: workspace,
    });

    expect(resolved).toBe(workspace);
  });

  it("E10 returns null when neither resolves", () => {
    const resolved = resolveStaticClientDir({
      requireResolve: () => {
        throw new Error("MODULE_NOT_FOUND");
      },
      workspaceClientDir: path.join(tmpDir(), "missing", "dist"),
    });

    expect(resolved).toBeNull();
  });

  it("E11 does NOT fall back to the workspace when a resolvable package has no index.html", () => {
    const pkgJson = makeWebPackage({ withBuild: false });
    const workspace = makeClientBuild(path.join(tmpDir(), "client", "dist"));

    const resolved = resolveStaticClientDir({
      requireResolve: () => pkgJson,
      workspaceClientDir: workspace,
    });

    expect(resolved).toBeNull();
  });
});
