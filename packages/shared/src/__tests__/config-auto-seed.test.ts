import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

/**
 * `autoSeedProjects` loader: boolean-guarded, default true.
 * See change: auto-seed-project-defaults.
 */

let dir: string;
let origHome: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cfg-auto-seed-"));
  origHome = process.env.HOME!;
  process.env.HOME = dir;
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(value: unknown): void {
  fs.mkdirSync(path.join(dir, ".pi", "dashboard"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".pi", "dashboard", "config.json"), JSON.stringify(value));
}

describe("autoSeedProjects loader", () => {
  it("absent defaults to true", () => {
    write({});
    expect(loadConfig().autoSeedProjects).toBe(true);
  });

  it("explicit booleans are kept", () => {
    write({ autoSeedProjects: false });
    expect(loadConfig().autoSeedProjects).toBe(false);
    write({ autoSeedProjects: true });
    expect(loadConfig().autoSeedProjects).toBe(true);
  });

  it("a non-boolean falls back to the default (a hand-edited \"false\" string is not truthy-enabled by accident)", () => {
    write({ autoSeedProjects: "false" });
    expect(loadConfig().autoSeedProjects).toBe(true);
    write({ autoSeedProjects: 0 });
    expect(loadConfig().autoSeedProjects).toBe(true);
  });
});
