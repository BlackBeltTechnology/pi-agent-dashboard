import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

/**
 * `accessGrants.promptEnabled` loader (change: add-access-grant-dialog, task 2.3).
 *
 * Prompting is opt-in: an absent key SHALL parse to disabled, so an existing
 * config that predates the feature never starts raising dialogs.
 */

let dir: string;
let origHome: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cfg-access-grants-"));
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

describe("accessGrants.promptEnabled loader", () => {
  it("an absent key parses to disabled", () => {
    write({});
    expect(loadConfig().accessGrants.promptEnabled).toBe(false);
  });

  it("an absent accessGrants group parses to disabled", () => {
    write({ port: 8000 });
    expect(loadConfig().accessGrants.promptEnabled).toBe(false);
  });

  it("an explicit true is honoured", () => {
    write({ accessGrants: { promptEnabled: true } });
    expect(loadConfig().accessGrants.promptEnabled).toBe(true);
  });

  it("an explicit false stays disabled", () => {
    write({ accessGrants: { promptEnabled: false } });
    expect(loadConfig().accessGrants.promptEnabled).toBe(false);
  });

  it("a non-boolean falls back to disabled", () => {
    write({ accessGrants: { promptEnabled: "yes" } });
    expect(loadConfig().accessGrants.promptEnabled).toBe(false);
  });

  it("a malformed group falls back to disabled", () => {
    write({ accessGrants: 42 });
    expect(loadConfig().accessGrants.promptEnabled).toBe(false);
  });
});
