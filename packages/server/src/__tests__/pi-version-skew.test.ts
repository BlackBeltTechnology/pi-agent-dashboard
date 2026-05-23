/**
 * Unit tests for the pi version-skew detection module.
 *
 * See change: unified-bootstrap-install \u00a79.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseVersion,
  compareVersions,
  isBelow,
  isAbove,
  readPiCompatibility,
  readCurrentPiVersion,
  computeCompatibility,
} from "../pi-version-skew.js";
import type { ToolRegistry, Resolution } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";

describe("pi-version-skew", () => {
  beforeEach(() => {
    // Cache (formerly `_resetVersionSkewCache`) removed under change:
    // eliminate-electron-runtime-install (task 3.6) along with
    // updateBootstrapCompatibility. Tests now exercise pure helpers only.
  });

  describe("parseVersion", () => {
    it("parses simple x.y.z", () => {
      expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
    });
    it("parses with v prefix", () => {
      expect(parseVersion("v0.6.7")).toEqual([0, 6, 7]);
    });
    it("ignores pre-release suffix", () => {
      expect(parseVersion("0.6.7-beta.1")).toEqual([0, 6, 7]);
    });
    it("ignores build metadata", () => {
      expect(parseVersion("0.6.7+abc")).toEqual([0, 6, 7]);
    });
    it("returns null for non-numeric", () => {
      expect(parseVersion("latest")).toBeNull();
      expect(parseVersion("")).toBeNull();
    });
  });

  describe("compareVersions", () => {
    it("equal versions", () => {
      expect(compareVersions("0.6.7", "0.6.7")).toBe(0);
    });
    it("lower major", () => {
      expect(compareVersions("0.9.9", "1.0.0")).toBe(-1);
    });
    it("higher major", () => {
      expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    });
    it("lower minor", () => {
      expect(compareVersions("0.5.7", "0.6.0")).toBe(-1);
    });
    it("lower patch", () => {
      expect(compareVersions("0.6.6", "0.6.7")).toBe(-1);
    });
    it("unparseable sorts as equal (conservative)", () => {
      expect(compareVersions("latest", "0.6.7")).toBe(0);
    });
  });

  describe("isBelow / isAbove", () => {
    it("isBelow", () => {
      expect(isBelow("0.5.0", "0.6.7")).toBe(true);
      expect(isBelow("0.6.7", "0.6.7")).toBe(false);
      expect(isBelow("0.7.0", "0.6.7")).toBe(false);
    });
    it("isAbove with .x wildcard", () => {
      expect(isAbove("0.10.0", "0.9.x")).toBe(true);
      expect(isAbove("0.9.5", "0.9.x")).toBe(false);
      expect(isAbove("0.9.99998", "0.9.x")).toBe(false);
    });
    it("isAbove with concrete version", () => {
      expect(isAbove("1.0.1", "1.0.0")).toBe(true);
      expect(isAbove("1.0.0", "1.0.0")).toBe(false);
    });
  });

  describe("readPiCompatibility", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-skew-"));
    });

    it("reads the field from a well-formed package.json", () => {
      const pkg = path.join(tmpDir, "package.json");
      fs.writeFileSync(
        pkg,
        JSON.stringify({ piCompatibility: { minimum: "1.0.0", recommended: "1.2.0", maximum: "2.x" } }),
      );
      expect(readPiCompatibility(pkg)).toEqual({
        minimum: "1.0.0",
        recommended: "1.2.0",
        maximum: "2.x",
      });
    });

    it("tolerates null maximum", () => {
      const pkg = path.join(tmpDir, "package.json");
      fs.writeFileSync(
        pkg,
        JSON.stringify({ piCompatibility: { minimum: "1.0.0", recommended: "1.2.0", maximum: null } }),
      );
      expect(readPiCompatibility(pkg).maximum).toBeNull();
    });

    it("falls back to defaults when field is missing", () => {
      const pkg = path.join(tmpDir, "package.json");
      fs.writeFileSync(pkg, JSON.stringify({ name: "something" }));
      expect(readPiCompatibility(pkg)).toEqual({
        minimum: "0.6.7",
        recommended: "0.6.7",
        maximum: null,
      });
    });

    it("falls back to defaults when file is unreadable", () => {
      expect(readPiCompatibility("/does/not/exist")).toEqual({
        minimum: "0.6.7",
        recommended: "0.6.7",
        maximum: null,
      });
    });
  });

  describe("computeCompatibility", () => {
    const range = { minimum: "0.6.7", recommended: "0.6.7", maximum: null };

    it("returns range unchanged when pi is not yet installed", () => {
      expect(computeCompatibility(range, undefined)).toEqual({ ...range, current: undefined });
    });

    it("flags upgradeRecommended when below minimum", () => {
      const out = computeCompatibility(range, "0.5.0");
      expect(out.current).toBe("0.5.0");
      expect(out.upgradeRecommended).toBe(true);
    });

    it("flags upgradeRecommended when below recommended (but >= minimum)", () => {
      const out = computeCompatibility(
        { minimum: "0.5.0", recommended: "0.6.7", maximum: null },
        "0.6.0",
      );
      expect(out.upgradeRecommended).toBe(true);
    });

    it("no upgrade flag when at or above recommended", () => {
      const out = computeCompatibility(range, "0.6.7");
      expect(out.upgradeRecommended).toBeUndefined();
      expect(out.upgradeDashboard).toBeUndefined();
    });

    it("flags upgradeDashboard when above maximum", () => {
      const out = computeCompatibility(
        { minimum: "0.6.7", recommended: "0.6.7", maximum: "0.9.x" },
        "0.10.0",
      );
      expect(out.upgradeDashboard).toBe(true);
    });
  });

  // See change: warn-pi-version-skew-in-cli.
  describe("readCurrentPiVersion (realpath symlinks)", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-skew-realpath-"));
    });

    function stubRegistry(resolvedPath: string): ToolRegistry {
      return {
        resolve: (name: string): Resolution => ({
          ok: true,
          name,
          path: resolvedPath,
          source: "system",
          tried: [],
          resolvedAt: Date.now(),
        }),
      } as unknown as ToolRegistry;
    }

    it("npm-global symlinked bin launcher resolves to the real package.json", () => {
      // Simulate ~/.nvm/.../bin/pi → ../lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js
      const nodeRoot = path.join(tmpDir, "node-install");
      const binDir = path.join(nodeRoot, "bin");
      const pkgDir = path.join(nodeRoot, "lib", "node_modules", "@earendil-works", "pi-coding-agent");
      const distDir = path.join(pkgDir, "dist");
      fs.mkdirSync(binDir, { recursive: true });
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(distDir, "cli.js"), "// stub");
      fs.writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.74.0" }),
      );
      // The bad path (what old code computed) must NOT exist.
      // That is: nodeRoot/package.json. We leave it absent.

      const binLink = path.join(binDir, "pi");
      // relative symlink matches npm's install layout.
      fs.symlinkSync(
        path.relative(binDir, path.join(distDir, "cli.js")),
        binLink,
      );

      const registry = stubRegistry(binLink);
      expect(readCurrentPiVersion(registry)).toBe("0.74.0");
    });

    it("non-symlinked path is a no-op under realpath", () => {
      const pkgDir = path.join(tmpDir, "pkg");
      const distDir = path.join(pkgDir, "dist");
      fs.mkdirSync(distDir, { recursive: true });
      const cli = path.join(distDir, "cli.js");
      fs.writeFileSync(cli, "// stub");
      fs.writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ name: "@mariozechner/pi-coding-agent", version: "0.69.0" }),
      );
      const registry = stubRegistry(cli);
      expect(readCurrentPiVersion(registry)).toBe("0.69.0");
    });

    it("dangling symlink returns undefined", () => {
      const link = path.join(tmpDir, "dangling-pi");
      fs.symlinkSync(path.join(tmpDir, "does-not-exist", "cli.js"), link);
      const registry = stubRegistry(link);
      expect(readCurrentPiVersion(registry)).toBeUndefined();
    });
  });
});
