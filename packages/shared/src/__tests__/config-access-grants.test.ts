import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

/**
 * `accessGrants.promptEnabled` loader (change: add-access-grant-dialog, task 2.3).
 *
 * Prompting is on by default (change: add-access-provisioning, D16): an absent
 * key parses to enabled, a non-boolean falls back to the default, and an
 * explicit boolean is kept as written (test-plan #E22).
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
  it.each([
    ["a config without accessGrants", {}, true],
    ["an absent accessGrants group", { port: 8000 }, true],
    ["an empty accessGrants group", { accessGrants: {} }, true],
    ["an explicit false", { accessGrants: { promptEnabled: false } }, false],
    ["an explicit true", { accessGrants: { promptEnabled: true } }, true],
    ["a non-boolean falls back to the default", { accessGrants: { promptEnabled: "yes" } }, true],
    ["a malformed group falls back to the default", { accessGrants: 42 }, true],
  ])("%s -> %s", (_label, config, expected) => {
    write(config);
    expect(loadConfig().accessGrants.promptEnabled).toBe(expected);
  });
});
