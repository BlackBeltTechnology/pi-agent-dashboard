/**
 * Tests for packages/shared/src/platform/npm.ts — Recipe argv + parse.
 * Live npm calls are out of scope (npm may or may not be on PATH in CI).
 *
 * See change: platform-command-executor.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  NPM_ROOT_GLOBAL,
  NPM_OUTDATED,
  NPM_OUTDATED_GLOBAL,
  NPM_INSTALL,
  NPM_INSTALL_GLOBAL,
  NPM_VIEW_VERSION,
  NPM_RECIPES,
  _resetNpmRootCache,
} from "../platform/npm.js";

beforeEach(() => {
  _resetNpmRootCache();
});

describe("NPM_ROOT_GLOBAL", () => {
  it("produces `npm root -g`", () => {
    expect(NPM_ROOT_GLOBAL.argv({})).toEqual(["npm", "root", "-g"]);
  });

  it("trims stdout", () => {
    expect(NPM_ROOT_GLOBAL.parse("/usr/lib/node_modules\n", {})).toBe("/usr/lib/node_modules");
  });
});

describe("NPM_OUTDATED", () => {
  it("project-wide form", () => {
    expect(NPM_OUTDATED.argv({})).toEqual(["npm", "outdated", "--json"]);
  });

  it("scoped to a single package", () => {
    expect(NPM_OUTDATED.argv({ pkg: "pi-web-access" })).toEqual([
      "npm", "outdated", "pi-web-access", "--json",
    ]);
  });

  it("parses JSON stdout", () => {
    const json = '{"pi-flows":{"current":"1.0.0","wanted":"1.1.0"}}';
    expect(NPM_OUTDATED.parse(json, {})).toEqual({
      "pi-flows": { current: "1.0.0", wanted: "1.1.0" },
    });
  });

  it("returns null for empty or malformed stdout", () => {
    expect(NPM_OUTDATED.parse("", {})).toBeNull();
    expect(NPM_OUTDATED.parse("not json", {})).toBeNull();
  });

  it("tolerates exit code 1 (npm exits 1 when updates exist)", () => {
    expect(NPM_OUTDATED.tolerate).toContain(1);
  });
});

describe("NPM_OUTDATED_GLOBAL", () => {
  it("includes `-g` flag", () => {
    expect(NPM_OUTDATED_GLOBAL.argv({})).toEqual(["npm", "outdated", "-g", "--json"]);
  });

  it("scoped form", () => {
    expect(NPM_OUTDATED_GLOBAL.argv({ pkg: "typescript" })).toEqual([
      "npm", "outdated", "-g", "typescript", "--json",
    ]);
  });

  it("tolerates exit 1", () => {
    expect(NPM_OUTDATED_GLOBAL.tolerate).toContain(1);
  });
});

describe("NPM_INSTALL", () => {
  it("installs latest when version omitted", () => {
    expect(NPM_INSTALL.argv({ pkg: "pi-flows" })).toEqual(["npm", "install", "pi-flows"]);
  });

  it("installs pinned version", () => {
    expect(NPM_INSTALL.argv({ pkg: "pi-flows", version: "1.2.3" })).toEqual([
      "npm", "install", "pi-flows@1.2.3",
    ]);
  });

  it("has a long timeout for install", () => {
    expect(NPM_INSTALL.timeout).toBeGreaterThanOrEqual(60_000);
  });
});

describe("NPM_INSTALL_GLOBAL", () => {
  it("includes `-g` flag with version", () => {
    expect(NPM_INSTALL_GLOBAL.argv({ pkg: "typescript", version: "5.0.0" })).toEqual([
      "npm", "install", "-g", "typescript@5.0.0",
    ]);
  });

  it("omits version suffix when not given", () => {
    expect(NPM_INSTALL_GLOBAL.argv({ pkg: "typescript" })).toEqual([
      "npm", "install", "-g", "typescript",
    ]);
  });
});

describe("NPM_VIEW_VERSION", () => {
  it("produces `npm view <pkg> version`", () => {
    expect(NPM_VIEW_VERSION.argv({ pkg: "@blackbelt-technology/pi-agent-dashboard" })).toEqual([
      "npm", "view", "@blackbelt-technology/pi-agent-dashboard", "version",
    ]);
  });

  it("trims the version string", () => {
    expect(NPM_VIEW_VERSION.parse("1.2.3\n", { pkg: "x" })).toBe("1.2.3");
  });
});

describe("NPM_RECIPES registry", () => {
  it("enumerates all 6 recipes", () => {
    expect(Object.keys(NPM_RECIPES).sort()).toEqual([
      "NPM_INSTALL",
      "NPM_INSTALL_GLOBAL",
      "NPM_OUTDATED",
      "NPM_OUTDATED_GLOBAL",
      "NPM_ROOT_GLOBAL",
      "NPM_VIEW_VERSION",
    ]);
  });

  it("every recipe has argv and parse functions", () => {
    for (const [name, recipe] of Object.entries(NPM_RECIPES)) {
      expect(typeof recipe.argv, `${name}.argv`).toBe("function");
      expect(typeof recipe.parse, `${name}.parse`).toBe("function");
    }
  });
});
