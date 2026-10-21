/**
 * test-plan E24 / E25 / X1: the Windows git-bundle step ships `usr/bin/bash.exe`
 * as a byte copy of dugite-native's `usr/bin/sh.exe` (pi's getShellConfig only
 * resolves a file named bash.exe).
 *
 * See change: fix-windows-bundled-bash-exe.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module, no type declarations by design.
import { ensureBundledBashExe } from "../../scripts/lib/ensure-bundled-bash-exe.mjs";

let gitDir: string;
let usrBin: string;

beforeEach(() => {
  gitDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundled-bash-"));
  usrBin = path.join(gitDir, "usr", "bin");
});
afterEach(() => fs.rmSync(gitDir, { recursive: true, force: true }));

describe("ensureBundledBashExe", () => {
  it("E24: copies sh.exe to bash.exe byte-for-byte, keeps sh.exe, second call is a no-op", () => {
    fs.mkdirSync(usrBin, { recursive: true });
    const bytes = randomBytes(4096);
    fs.writeFileSync(path.join(usrBin, "sh.exe"), bytes);

    ensureBundledBashExe(gitDir);

    expect(fs.readFileSync(path.join(usrBin, "bash.exe")).equals(bytes)).toBe(true);
    expect(fs.readFileSync(path.join(usrBin, "sh.exe")).equals(bytes)).toBe(true);

    const before = fs.statSync(path.join(usrBin, "bash.exe")).mtimeMs;
    ensureBundledBashExe(gitDir);
    expect(fs.statSync(path.join(usrBin, "bash.exe")).mtimeMs).toBe(before);
    expect(fs.readFileSync(path.join(usrBin, "bash.exe")).equals(bytes)).toBe(true);
  });

  it("E25: an existing distinct bash.exe is left untouched", () => {
    fs.mkdirSync(usrBin, { recursive: true });
    const shBytes = randomBytes(1024);
    const bashBytes = randomBytes(2048);
    fs.writeFileSync(path.join(usrBin, "sh.exe"), shBytes);
    fs.writeFileSync(path.join(usrBin, "bash.exe"), bashBytes);

    ensureBundledBashExe(gitDir);

    expect(fs.readFileSync(path.join(usrBin, "bash.exe")).equals(bashBytes)).toBe(true);
  });

  it("X1: missing sh.exe throws naming sh.exe and creates no bash.exe (with or without bash.exe)", () => {
    fs.mkdirSync(usrBin, { recursive: true });
    expect(() => ensureBundledBashExe(gitDir)).toThrow(/sh\.exe/);
    expect(fs.existsSync(path.join(usrBin, "bash.exe"))).toBe(false);

    // Even when bash.exe is already present, a missing sh.exe is a build failure
    // (a dugite-native layout change must surface, not be masked).
    fs.writeFileSync(path.join(usrBin, "bash.exe"), "x");
    expect(() => ensureBundledBashExe(gitDir)).toThrow(/sh\.exe/);
  });
});
