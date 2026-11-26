import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

/**
 * `sudoCredentialPrompt` config loader: default-on, clamp-and-default.
 * See change: add-sudo-credential-prompt (test-plan #S1, #S2, #S82).
 */

let dir: string;
let origHome: string;
let origUserProfile: string | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cfg-sudo-"));
  origHome = process.env.HOME!;
  origUserProfile = process.env.USERPROFILE;
  process.env.HOME = dir;
  // `os.homedir()` reads USERPROFILE on Windows.
  if (process.platform === "win32") process.env.USERPROFILE = dir;
});

afterEach(() => {
  process.env.HOME = origHome;
  if (origUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = origUserProfile;
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(value: unknown): void {
  fs.mkdirSync(path.join(dir, ".pi", "dashboard"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".pi", "dashboard", "config.json"), JSON.stringify(value));
}

describe("#S1 default on", () => {
  it("old install without the key resolves to the defaults", () => {
    write({});
    expect(loadConfig().sudoCredentialPrompt).toEqual({ enabled: true, timeoutMs: 120000, cacheMinutes: 5 });
  });

  it("{enabled:false} keeps the other keys defaulted", () => {
    write({ sudoCredentialPrompt: { enabled: false } });
    expect(loadConfig().sudoCredentialPrompt).toEqual({ enabled: false, timeoutMs: 120000, cacheMinutes: 5 });
  });
});

describe("#S2 cacheMinutes clamp", () => {
  const cases: Array<[unknown, number]> = [
    [-1, 0],
    [0, 0],
    [1, 1],
    [60, 60],
    [61, 60],
    [1.5, 1],
    ["abc", 5],
    [Number.NaN, 5],
    [null, 5],
  ];
  for (const [input, expected] of cases) {
    it(`${String(input)} → ${expected}`, () => {
      write({ sudoCredentialPrompt: { cacheMinutes: input } });
      expect(loadConfig().sudoCredentialPrompt.cacheMinutes).toBe(expected);
    });
  }
});

describe("#S82 timeoutMs clamp", () => {
  const cases: Array<[unknown, number]> = [
    [0, 5000],
    [4999, 5000],
    [5000, 5000],
    [120000, 120000],
    [600000, 600000],
    [600001, 600000],
    [1e9, 600000],
    ["abc", 120000],
    [Number.NaN, 120000],
  ];
  for (const [input, expected] of cases) {
    it(`${String(input)} → ${expected}`, () => {
      write({ sudoCredentialPrompt: { timeoutMs: input } });
      expect(loadConfig().sudoCredentialPrompt.timeoutMs).toBe(expected);
    });
  }
});
