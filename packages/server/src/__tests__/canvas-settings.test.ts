/**
 * Two-scope canvasTypes settings read/write (auto-canvas task 5.2).
 * Asserts the write preserves other settings keys, sanitizes unknown keys,
 * and the project scope round-trips through the effective merge.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readCanvasTypesScopes,
  writeCanvasTypesScope,
} from "../canvas/canvas-settings.js";

let projectCwd: string;

beforeEach(() => {
  projectCwd = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-settings-"));
});
afterEach(() => {
  fs.rmSync(projectCwd, { recursive: true, force: true });
});

describe("writeCanvasTypesScope (project)", () => {
  it("preserves other keys in the settings file", () => {
    const file = path.join(projectCwd, ".pi", "settings.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ packages: ["a"], dashboard: { other: true } }),
      "utf8",
    );

    writeCanvasTypesScope("project", projectCwd, { image: false });

    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(after.packages).toEqual(["a"]); // untouched
    expect(after.dashboard.other).toBe(true); // sibling key untouched
    expect(after.dashboard.canvasTypes).toEqual({ image: false });
  });

  it("drops unknown / non-boolean keys (sanitize)", () => {
    writeCanvasTypesScope("project", projectCwd, {
      image: false,
      bogus: true,
      html: "nope" as unknown as boolean,
    });
    const { project } = readCanvasTypesScopes(projectCwd);
    expect(project).toEqual({ image: false });
  });

  it("round-trips into the effective merge", () => {
    writeCanvasTypesScope("project", projectCwd, { pdf: false });
    const { effective } = readCanvasTypesScopes(projectCwd);
    expect(effective.pdf).toBe(false);
    expect(effective.markdown).toBe(true); // default preserved
  });

  it("creates the .pi dir + file when absent", () => {
    writeCanvasTypesScope("project", projectCwd, { html: false });
    expect(fs.existsSync(path.join(projectCwd, ".pi", "settings.json"))).toBe(true);
  });

  it("rejects project scope without a cwd", () => {
    expect(() => writeCanvasTypesScope("project", "", { html: false })).toThrow();
  });
});
