/**
 * Restore-record store: stale-record GC + malformed-file handling.
 * See change: addons-hub-feature-catalog (test-plan #E20, #X7).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteRestore,
  gcRestore,
  getRestore,
  readRestoreStore,
  restoreFilePath,
  setRestore,
  writeRestoreStore,
} from "../addons/addon-toggle-restore.js";

const HOME = path.join(os.tmpdir(), `addon-restore-test-${process.pid}`);
const SETTINGS = path.join(HOME, ".pi", "agent", "settings.json");
let originalHome: string | undefined;

beforeEach(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
  originalHome = process.env.HOME;
  process.env.HOME = HOME;
});
afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  fs.rmSync(HOME, { recursive: true, force: true });
});

describe("restore store", () => {
  it("round-trips a record atomically (no tmp left behind)", () => {
    const store = readRestoreStore();
    setRestore(store, { settingsPath: SETTINGS, identity: "npm:x", original: "npm:x", filtered: { source: "npm:x" } });
    writeRestoreStore(store);
    expect(getRestore(readRestoreStore(), SETTINGS, "npm:x")?.original).toBe("npm:x");
    expect(fs.readdirSync(path.dirname(restoreFilePath())).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    const again = readRestoreStore();
    deleteRestore(again, SETTINGS, "npm:x");
    expect(getRestore(again, SETTINGS, "npm:x")).toBeUndefined();
  });

  // test-plan #E20
  it("GC deletes records whose identity is no longer a global entry (uninstall / reset)", () => {
    const store = readRestoreStore();
    setRestore(store, { settingsPath: SETTINGS, identity: "npm:x", original: "npm:x", filtered: {} });
    setRestore(store, { settingsPath: SETTINGS, identity: "npm:keep", original: "npm:keep", filtered: {} });
    setRestore(store, { settingsPath: "/other/settings.json", identity: "npm:x", original: "npm:x", filtered: {} });
    writeRestoreStore(store);
    // `npm:x` uninstalled; replaced by a local checkout (different identity) behaves the same.
    const removed = gcRestore(SETTINGS, new Set(["npm:keep", "local:/repo/x"]));
    expect(removed).toBe(1);
    const after = readRestoreStore();
    expect(getRestore(after, SETTINGS, "npm:x")).toBeUndefined();
    expect(getRestore(after, SETTINGS, "npm:keep")).toBeDefined();
    expect(getRestore(after, "/other/settings.json", "npm:x")).toBeDefined();
  });

  it("GC without stale records does not rewrite the file", () => {
    const store = readRestoreStore();
    setRestore(store, { settingsPath: SETTINGS, identity: "npm:x", original: "npm:x", filtered: {} });
    writeRestoreStore(store);
    const mtime = fs.statSync(restoreFilePath()).mtimeMs;
    expect(gcRestore(SETTINGS, new Set(["npm:x"]))).toBe(0);
    expect(fs.statSync(restoreFilePath()).mtimeMs).toBe(mtime);
  });

  // test-plan #X7 (store half; the toggle half lives in addons-toggle-routes.test.ts)
  it("a malformed file reads as empty and warns without throwing", () => {
    fs.mkdirSync(path.dirname(restoreFilePath()), { recursive: true });
    fs.writeFileSync(restoreFilePath(), "not json");
    const warn = vi.fn();
    expect(readRestoreStore({ warn })).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
