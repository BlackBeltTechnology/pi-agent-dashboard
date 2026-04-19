import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createPreferencesStore } from "../preferences-store.js";

// Mock resolve-path to be a no-op (no symlink resolution in tests)
vi.mock("../resolve-path.js", () => ({
  safeRealpathSync: (p: string) => p,
}));

// Canonical host-platform absolute paths. Using raw POSIX strings like
// `/a` would normalize to `B:\a` on Windows (path.win32.resolve prepends
// the current drive), breaking assertions. These constants produce paths
// that survive `normalizePath` unchanged on their host platform.
const A_PATH = path.resolve(os.tmpdir(), "pref-a");
const B_PATH = path.resolve(os.tmpdir(), "pref-b");
const X_PATH = path.resolve(os.tmpdir(), "pref-x");

describe("preferences-store", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pref-store-test-"));
    filePath = path.join(tmpDir, "preferences.json");
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should start with empty defaults when file missing", () => {
    const store = createPreferencesStore(filePath);
    expect(store.getPinnedDirectories()).toEqual([]);
    expect(store.getSessionOrder()).toEqual({});
    store.dispose();
  });

  it("should load existing preferences", () => {
    fs.writeFileSync(filePath, JSON.stringify({
      pinnedDirectories: [A_PATH, B_PATH],
      sessionOrder: { [A_PATH]: ["s1", "s2"] },
    }));
    const store = createPreferencesStore(filePath);
    expect(store.getPinnedDirectories()).toEqual([A_PATH, B_PATH]);
    expect(store.getSessionOrder()).toEqual({ [A_PATH]: ["s1", "s2"] });
    store.dispose();
  });

  it("should pin and unpin directories", () => {
    const store = createPreferencesStore(filePath);
    store.pinDirectory("/a");
    store.pinDirectory("/b");
    expect(store.getPinnedDirectories()).toEqual(["/a", "/b"]);
    store.unpinDirectory("/a");
    expect(store.getPinnedDirectories()).toEqual(["/b"]);
    store.dispose();
  });

  it("should not duplicate pinned directories", () => {
    const store = createPreferencesStore(filePath);
    store.pinDirectory("/a");
    store.pinDirectory("/a");
    expect(store.getPinnedDirectories()).toEqual(["/a"]);
    store.dispose();
  });

  it("should reorder pinned directories", () => {
    const store = createPreferencesStore(filePath);
    store.pinDirectory("/a");
    store.pinDirectory("/b");
    store.reorderPinnedDirs(["/b", "/a"]);
    expect(store.getPinnedDirectories()).toEqual(["/b", "/a"]);
    store.dispose();
  });

  it("should set and get session order", () => {
    const store = createPreferencesStore(filePath);
    store.setSessionOrder({ "/x": ["s1", "s2"] });
    expect(store.getSessionOrder()).toEqual({ "/x": ["s1", "s2"] });
    store.dispose();
  });

  it("should debounce writes", () => {
    const store = createPreferencesStore(filePath);
    store.pinDirectory("/a");
    store.pinDirectory("/b");
    // Not written yet
    expect(fs.existsSync(filePath)).toBe(false);
    vi.advanceTimersByTime(1000);
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(data.pinnedDirectories).toEqual(["/a", "/b"]);
    store.dispose();
  });

  it("should flush pending writes", () => {
    const store = createPreferencesStore(filePath);
    store.pinDirectory("/a");
    store.flush();
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(data.pinnedDirectories).toEqual(["/a"]);
    store.dispose();
  });

  // ── Normalize-on-load migration (platform-path-normalization) ───────────

  it("normalizes drifty pinned paths on load", () => {
    // Seed a file with the kinds of drift that existed pre-normalization:
    // trailing separators, `.` / `..` segments, duplicate separators. The
    // store should collapse them to canonical form on first read.
    fs.writeFileSync(filePath, JSON.stringify({
      pinnedDirectories: [
        process.platform === "win32"
          ? "C:\\Users\\me\\Dev\\"         // trailing separator
          : "/Users/me/Dev/",
        process.platform === "win32"
          ? "C:\\Users\\me\\Dev\\.\\BB"    // `.` segment
          : "/Users/me/Dev/./BB",
      ],
      sessionOrder: {},
    }));
    const store = createPreferencesStore(filePath);
    const pinned = store.getPinnedDirectories();
    expect(pinned).toHaveLength(2);
    // Expect canonical forms (trailing separator stripped, `.` resolved).
    if (process.platform === "win32") {
      expect(pinned[0]).toBe("C:\\Users\\me\\Dev");
      expect(pinned[1]).toBe("C:\\Users\\me\\Dev\\BB");
    } else {
      expect(pinned[0]).toBe("/Users/me/Dev");
      expect(pinned[1]).toBe("/Users/me/Dev/BB");
    }
    store.dispose();
  });

  it("deduplicates entries that collapse to the same canonical form", () => {
    // Two different-looking entries that normalize to the same path must
    // become one stored entry.
    const entries = process.platform === "win32"
      ? ["C:\\Users\\me", "C:\\Users\\me\\", "C:/Users/me"]
      : ["/Users/me", "/Users/me/", "/Users/./me"];
    fs.writeFileSync(filePath, JSON.stringify({
      pinnedDirectories: entries,
      sessionOrder: {},
    }));
    const store = createPreferencesStore(filePath);
    expect(store.getPinnedDirectories()).toHaveLength(1);
    store.dispose();
  });

  it("persists the normalized form back to disk on first debounce", () => {
    fs.writeFileSync(filePath, JSON.stringify({
      pinnedDirectories: [
        process.platform === "win32" ? "C:\\Users\\me\\" : "/Users/me/",
      ],
      sessionOrder: {},
    }));
    const store = createPreferencesStore(filePath);
    vi.advanceTimersByTime(1000);
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const expected = process.platform === "win32" ? "C:\\Users\\me" : "/Users/me";
    expect(data.pinnedDirectories).toEqual([expected]);
    store.dispose();
  });

  it("should not contain hiddenSessions in output", () => {
    const store = createPreferencesStore(filePath);
    store.pinDirectory("/a");
    store.flush();
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(data.hiddenSessions).toBeUndefined();
    store.dispose();
  });
});
