/**
 * `windowsBashSource` config parse boundaries: default `"bundled"`; anything
 * other than "bundled" | "host" falls back to the default at load time.
 *
 * See change: fix-windows-bundled-bash-exe (test-plan #E1, #E2).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

let tmpHome: string;
let realHome: string | undefined;
let realUserProfile: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "bash-src-cfg-"));
  realHome = process.env.HOME;
  realUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  if (process.platform === "win32") process.env.USERPROFILE = tmpHome;
});

afterEach(() => {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  if (realUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = realUserProfile;
  rmSync(tmpHome, { recursive: true, force: true });
});

function seed(config: Record<string, unknown>): void {
  const file = path.join(tmpHome, ".pi", "dashboard", "config.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config));
}

describe("windowsBashSource parse", () => {
  it("E1: absent key → effective 'bundled'", () => {
    seed({});
    expect(loadConfig().windowsBashSource).toBe("bundled");
  });

  it("E2: 'wsl', 42, null → 'bundled'; 'host' → 'host'", () => {
    for (const bad of ["wsl", 42, null]) {
      seed({ windowsBashSource: bad });
      expect(loadConfig().windowsBashSource).toBe("bundled");
    }
    seed({ windowsBashSource: "host" });
    expect(loadConfig().windowsBashSource).toBe("host");
    seed({ windowsBashSource: "bundled" });
    expect(loadConfig().windowsBashSource).toBe("bundled");
  });
});
