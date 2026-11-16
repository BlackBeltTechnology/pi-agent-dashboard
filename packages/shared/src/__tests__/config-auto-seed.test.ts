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
let origHome: string | undefined;
let origUserProfile: string | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cfg-auto-seed-"));
  origHome = process.env.HOME;
  origUserProfile = process.env.USERPROFILE;
  // os.homedir() reads USERPROFILE on Windows, HOME elsewhere — isolate both.
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
});

afterEach(() => {
  restoreEnv("HOME", origHome);
  restoreEnv("USERPROFILE", origUserProfile);
  fs.rmSync(dir, { recursive: true, force: true });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

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
