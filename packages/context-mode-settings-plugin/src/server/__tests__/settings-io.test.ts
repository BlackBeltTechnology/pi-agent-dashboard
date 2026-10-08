/**
 * Atomic write. Folds X2 and the fixed-path guarantee.
 * See change: add-context-mode-settings-plugin.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSettingsPath, writeSettingsFile } from "../settings-io.js";

const failRename = vi.hoisted(() => ({ on: false }));
vi.mock("node:fs", async (orig) => {
  const actual = await orig<typeof import("node:fs")>();
  const renameSync = (a: string, b: string) => {
    if (failRename.on) throw new Error("EXDEV");
    return actual.renameSync(a, b);
  };
  return { ...actual, renameSync, default: { ...actual, renameSync } };
});

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cms-io-"));
});
afterEach(() => {
  failRename.on = false;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("settings-io", () => {
  it("resolves the fixed path under ~/.pi/context-mode", () => {
    expect(resolveSettingsPath("/h")).toBe(path.join("/h", ".pi", "context-mode", "settings.json"));
  });

  it("X2: rename failure leaves the original intact and no temp file", () => {
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, '{"fetch.strict":true}\n');
    failRename.on = true;
    expect(() => writeSettingsFile(file, { "search.windowMs": 5 })).toThrow();
    expect(fs.readFileSync(file, "utf-8")).toBe('{"fetch.strict":true}\n');
    expect(fs.readdirSync(dir)).toEqual(["settings.json"]);
  });
});
