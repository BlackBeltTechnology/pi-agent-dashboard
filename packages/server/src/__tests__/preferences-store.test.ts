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

  // ── PI_DASHBOARD_PIN_DIRS first-run seeding (docker-packaging) ──────────
  describe("PI_DASHBOARD_PIN_DIRS seeding", () => {
    let prevEnv: string | undefined;
    beforeEach(() => {
      prevEnv = process.env.PI_DASHBOARD_PIN_DIRS;
    });
    afterEach(() => {
      if (prevEnv === undefined) delete process.env.PI_DASHBOARD_PIN_DIRS;
      else process.env.PI_DASHBOARD_PIN_DIRS = prevEnv;
    });

    it("seeds pinned dirs from env on first run when none persisted", () => {
      process.env.PI_DASHBOARD_PIN_DIRS = [A_PATH, B_PATH].join(path.delimiter);
      const store = createPreferencesStore(filePath);
      expect(store.getPinnedDirectories()).toEqual([A_PATH, B_PATH]);
      vi.advanceTimersByTime(1000);
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(data.pinnedDirectories).toEqual([A_PATH, B_PATH]);
      expect(data.pinSeeded).toBe(true);
      store.dispose();
    });

    it("ignores env when pinned dirs already persisted (UI edits win)", () => {
      fs.writeFileSync(filePath, JSON.stringify({ pinnedDirectories: [X_PATH] }));
      process.env.PI_DASHBOARD_PIN_DIRS = [A_PATH, B_PATH].join(path.delimiter);
      const store = createPreferencesStore(filePath);
      expect(store.getPinnedDirectories()).toEqual([X_PATH]);
      store.dispose();
    });

    it("does not re-seed after the user unpinned everything (pinSeeded marker)", () => {
      fs.writeFileSync(filePath, JSON.stringify({ pinnedDirectories: [], pinSeeded: true }));
      process.env.PI_DASHBOARD_PIN_DIRS = [A_PATH].join(path.delimiter);
      const store = createPreferencesStore(filePath);
      expect(store.getPinnedDirectories()).toEqual([]);
      store.dispose();
    });

    it("is a no-op when env is unset", () => {
      const store = createPreferencesStore(filePath);
      expect(store.getPinnedDirectories()).toEqual([]);
      store.dispose();
    });
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

  // ── auto-init-worktree-on-spawn ─────────────────────────────────────────

  it("defaults autoInitWorktreeOnSpawn to false when key absent", () => {
    const store = createPreferencesStore(filePath);
    expect(store.getAutoInitWorktreeOnSpawn()).toBe(false);
    store.dispose();
  });

  it("reads autoInitWorktreeOnSpawn from an existing file", () => {
    fs.writeFileSync(filePath, JSON.stringify({ autoInitWorktreeOnSpawn: true }));
    const store = createPreferencesStore(filePath);
    expect(store.getAutoInitWorktreeOnSpawn()).toBe(true);
    store.dispose();
  });

  it("persists autoInitWorktreeOnSpawn to preferences.json", () => {
    const store = createPreferencesStore(filePath);
    store.setAutoInitWorktreeOnSpawn(true);
    store.flush();
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(data.autoInitWorktreeOnSpawn).toBe(true);
    store.dispose();
  });

  it("setAutoInitWorktreeOnSpawn(false) is a no-op when already false (no write)", () => {
    const store = createPreferencesStore(filePath);
    store.setAutoInitWorktreeOnSpawn(false);
    expect(fs.existsSync(filePath)).toBe(false);
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

  // ── folder-workspaces ──────────────────────────────────

  describe("workspaces", () => {
    it("defaults to empty workspaces[] when field absent", () => {
      fs.writeFileSync(filePath, JSON.stringify({
        pinnedDirectories: [A_PATH], sessionOrder: {},
      }));
      const store = createPreferencesStore(filePath);
      expect(store.getWorkspaces()).toEqual([]);
      store.dispose();
    });

    it("loads workspaces from disk preserving order, ids, name, collapsed, folders", () => {
      fs.writeFileSync(filePath, JSON.stringify({
        pinnedDirectories: [], sessionOrder: {},
        workspaces: [
          { id: "ws_1", name: "a", collapsed: false, folders: [A_PATH] },
          { id: "ws_2", name: "b", collapsed: true, folders: [] },
        ],
      }));
      const store = createPreferencesStore(filePath);
      const got = store.getWorkspaces();
      expect(got).toHaveLength(2);
      expect(got[0]).toMatchObject({ id: "ws_1", name: "a", collapsed: false, folders: [A_PATH] });
      expect(got[1]).toMatchObject({ id: "ws_2", name: "b", collapsed: true, folders: [] });
      store.dispose();
    });

    it("createWorkspace generates ws_<uuid> id and trims name; rejects empty", () => {
      const store = createPreferencesStore(filePath);
      expect(store.createWorkspace("")).toBeNull();
      expect(store.createWorkspace("   ")).toBeNull();
      const w = store.createWorkspace("  client-work  ");
      expect(w).not.toBeNull();
      expect(w!.id).toMatch(/^ws_[0-9a-f-]{36}$/);
      expect(w!.name).toBe("client-work");
      expect(w!.collapsed).toBe(false);
      expect(w!.folders).toEqual([]);
      store.dispose();
    });

    it("createWorkspace rejects names longer than 80 chars", () => {
      const store = createPreferencesStore(filePath);
      expect(store.createWorkspace("x".repeat(81))).toBeNull();
      expect(store.createWorkspace("x".repeat(80))).not.toBeNull();
      store.dispose();
    });

    it("allows duplicate workspace names", () => {
      const store = createPreferencesStore(filePath);
      const a = store.createWorkspace("scratch");
      const b = store.createWorkspace("scratch");
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a!.id).not.toBe(b!.id);
      expect(store.getWorkspaces()).toHaveLength(2);
      store.dispose();
    });

    it("renameWorkspace returns false on unknown id and on empty name", () => {
      const store = createPreferencesStore(filePath);
      const w = store.createWorkspace("a")!;
      expect(store.renameWorkspace("missing", "x")).toBe(false);
      expect(store.renameWorkspace(w.id, "")).toBe(false);
      expect(store.renameWorkspace(w.id, "a")).toBe(false); // same value, no-op
      expect(store.renameWorkspace(w.id, "b")).toBe(true);
      expect(store.getWorkspaces()[0].name).toBe("b");
      store.dispose();
    });

    it("deleteWorkspace removes record and leaves pinnedDirectories alone", () => {
      const store = createPreferencesStore(filePath);
      store.pinDirectory(A_PATH);
      const w = store.createWorkspace("w")!;
      store.addFolderToWorkspace(w.id, A_PATH);
      expect(store.deleteWorkspace("missing")).toBe(false);
      expect(store.deleteWorkspace(w.id)).toBe(true);
      expect(store.getWorkspaces()).toEqual([]);
      expect(store.getPinnedDirectories()).toEqual([A_PATH]);
      store.dispose();
    });

    it("setWorkspaceCollapsed toggles flag; no-op on same value or unknown id", () => {
      const store = createPreferencesStore(filePath);
      const w = store.createWorkspace("w")!;
      expect(store.setWorkspaceCollapsed("missing", true)).toBe(false);
      expect(store.setWorkspaceCollapsed(w.id, false)).toBe(false); // already false
      expect(store.setWorkspaceCollapsed(w.id, true)).toBe(true);
      expect(store.getWorkspaces()[0].collapsed).toBe(true);
      store.dispose();
    });

    it("addFolderToWorkspace appends and is idempotent on duplicate", () => {
      const store = createPreferencesStore(filePath);
      const w = store.createWorkspace("w")!;
      expect(store.addFolderToWorkspace(w.id, A_PATH)).toBe(true);
      expect(store.addFolderToWorkspace(w.id, A_PATH)).toBe(false); // idempotent
      expect(store.getWorkspaces()[0].folders).toEqual([A_PATH]);
      store.dispose();
    });

    it("single-membership: adding folder to workspace B detaches it from workspace A", () => {
      const store = createPreferencesStore(filePath);
      const a = store.createWorkspace("a")!;
      const b = store.createWorkspace("b")!;
      store.addFolderToWorkspace(a.id, A_PATH);
      store.addFolderToWorkspace(b.id, A_PATH);
      const ws = store.getWorkspaces();
      expect(ws.find((w) => w.id === a.id)!.folders).toEqual([]);
      expect(ws.find((w) => w.id === b.id)!.folders).toEqual([A_PATH]);
      store.dispose();
    });

    it("adding folder does NOT touch pinnedDirectories", () => {
      const store = createPreferencesStore(filePath);
      store.pinDirectory(A_PATH);
      const w = store.createWorkspace("w")!;
      store.addFolderToWorkspace(w.id, A_PATH);
      expect(store.getPinnedDirectories()).toEqual([A_PATH]);
      expect(store.getWorkspaces()[0].folders).toEqual([A_PATH]);
      store.dispose();
    });

    it("removeFolderFromWorkspace does NOT touch pinnedDirectories", () => {
      const store = createPreferencesStore(filePath);
      store.pinDirectory(A_PATH);
      const w = store.createWorkspace("w")!;
      store.addFolderToWorkspace(w.id, A_PATH);
      expect(store.removeFolderFromWorkspace(w.id, A_PATH)).toBe(true);
      expect(store.removeFolderFromWorkspace(w.id, A_PATH)).toBe(false); // not member
      expect(store.getPinnedDirectories()).toEqual([A_PATH]);
      expect(store.getWorkspaces()[0].folders).toEqual([]);
      store.dispose();
    });

    it("reorderWorkspaceFolders rejects mismatched set", () => {
      const store = createPreferencesStore(filePath);
      const w = store.createWorkspace("w")!;
      store.addFolderToWorkspace(w.id, A_PATH);
      store.addFolderToWorkspace(w.id, B_PATH);
      expect(store.reorderWorkspaceFolders(w.id, [A_PATH])).toBe(false); // missing B
      expect(store.reorderWorkspaceFolders(w.id, [A_PATH, B_PATH, X_PATH])).toBe(false); // extra
      expect(store.reorderWorkspaceFolders(w.id, [B_PATH, A_PATH])).toBe(true);
      expect(store.getWorkspaces()[0].folders).toEqual([B_PATH, A_PATH]);
      store.dispose();
    });

    it("reorderWorkspaces rejects mismatched id set", () => {
      const store = createPreferencesStore(filePath);
      const a = store.createWorkspace("a")!;
      const b = store.createWorkspace("b")!;
      expect(store.reorderWorkspaces([a.id])).toBe(false);
      expect(store.reorderWorkspaces([a.id, b.id, "ghost"])).toBe(false);
      expect(store.reorderWorkspaces([b.id, a.id])).toBe(true);
      expect(store.getWorkspaces().map((w) => w.id)).toEqual([b.id, a.id]);
      store.dispose();
    });

    it("workspaces persist round-trip through file with debounced write", () => {
      const store = createPreferencesStore(filePath);
      const w = store.createWorkspace("persisted")!;
      store.addFolderToWorkspace(w.id, A_PATH);
      store.setWorkspaceCollapsed(w.id, true);
      store.flush();
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(data.workspaces).toHaveLength(1);
      expect(data.workspaces[0]).toMatchObject({
        id: w.id, name: "persisted", collapsed: true, folders: [A_PATH],
      });
      store.dispose();
    });

    it("mutation triggers debounced save", () => {
      const store = createPreferencesStore(filePath);
      store.createWorkspace("x");
      expect(fs.existsSync(filePath)).toBe(false);
      vi.advanceTimersByTime(1000);
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(data.workspaces).toHaveLength(1);
      store.dispose();
    });

    it("getWorkspaces returns defensive clones — callers cannot mutate internal state", () => {
      const store = createPreferencesStore(filePath);
      const w = store.createWorkspace("w")!;
      store.addFolderToWorkspace(w.id, A_PATH);
      const snap = store.getWorkspaces();
      snap[0].folders.push("/poisoned");
      snap[0].name = "poisoned";
      const fresh = store.getWorkspaces();
      expect(fresh[0].folders).toEqual([A_PATH]);
      expect(fresh[0].name).toBe("w");
      store.dispose();
    });
  });

  describe("displayPrefs (configurable-chat-display)", () => {
    it("returns undefined when never seeded", () => {
      const store = createPreferencesStore(filePath);
      expect(store.getDisplayPrefs()).toBeUndefined();
      store.dispose();
    });

    it("setDisplayPrefs seeds and persists round-trip", () => {
      const store = createPreferencesStore(filePath);
      const merged = store.setDisplayPrefs({ debugTools: true, toolCalls: { bash: true } });
      expect(merged.debugTools).toBe(true);
      expect(merged.toolCalls.bash).toBe(true);
      store.flush();
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(data.displayPrefs.debugTools).toBe(true);
      expect(data.displayPrefs.toolCalls.bash).toBe(true);
      store.dispose();
    });

    it("PATCH-style merge preserves existing fields and deep-merges toolCalls", () => {
      const store = createPreferencesStore(filePath);
      store.setDisplayPrefs({
        tokenStatsBar: true,
        contextUsageBar: true,
        reasoning: false,
        toolResults: true,
        turnMetadata: true,
        debugTools: false,
        toolCalls: { read: true, bash: true, edit: true, agent: true, generic: true },
      });
      const merged = store.setDisplayPrefs({ debugTools: true, toolCalls: { bash: false } });
      expect(merged.debugTools).toBe(true);
      expect(merged.tokenStatsBar).toBe(true); // preserved
      expect(merged.toolCalls.bash).toBe(false); // merged
      expect(merged.toolCalls.read).toBe(true); // preserved
      store.dispose();
    });

    it("reloads displayPrefs from disk on construction", () => {
      const store1 = createPreferencesStore(filePath);
      store1.setDisplayPrefs({ debugTools: true });
      store1.flush();
      store1.dispose();
      const store2 = createPreferencesStore(filePath);
      expect(store2.getDisplayPrefs()?.debugTools).toBe(true);
      store2.dispose();
    });
  });

  describe("openspec update signatures", () => {
    it("returns undefined for unknown cwd", () => {
      const store = createPreferencesStore(filePath);
      expect(store.getOpenSpecUpdateSignature(A_PATH)).toBeUndefined();
      store.dispose();
    });

    it("sets and gets a per-cwd signature, persisting across reloads", () => {
      const store1 = createPreferencesStore(filePath);
      store1.setOpenSpecUpdateSignature(A_PATH, "sig-abc");
      store1.flush();
      store1.dispose();
      const store2 = createPreferencesStore(filePath);
      expect(store2.getOpenSpecUpdateSignature(A_PATH)).toBe("sig-abc");
      expect(store2.getOpenSpecUpdateSignature(B_PATH)).toBeUndefined();
      store2.dispose();
    });

    it("overwrites an existing signature", () => {
      const store = createPreferencesStore(filePath);
      store.setOpenSpecUpdateSignature(A_PATH, "sig-1");
      store.setOpenSpecUpdateSignature(A_PATH, "sig-2");
      expect(store.getOpenSpecUpdateSignature(A_PATH)).toBe("sig-2");
      store.dispose();
    });
  });

  // See change: enrich-model-selector-capabilities-favorites.
  describe("favorite models", () => {
    it("add/remove/dedupe and persist across reload", () => {
      const store = createPreferencesStore(filePath);
      store.addFavoriteModel("anthropic/claude-opus-4-7");
      store.addFavoriteModel("anthropic/claude-opus-4-7"); // dedupe no-op
      store.addFavoriteModel("proxy/cc/claude-opus-4-7");
      expect(store.getFavoriteModels()).toEqual([
        "anthropic/claude-opus-4-7",
        "proxy/cc/claude-opus-4-7",
      ]);
      store.removeFavoriteModel("anthropic/claude-opus-4-7");
      store.removeFavoriteModel("not-present"); // no-op
      expect(store.getFavoriteModels()).toEqual(["proxy/cc/claude-opus-4-7"]);
      vi.advanceTimersByTime(1100);
      store.dispose();

      const reloaded = createPreferencesStore(filePath);
      expect(reloaded.getFavoriteModels()).toEqual(["proxy/cc/claude-opus-4-7"]);
      reloaded.dispose();
    });

    it("defaults to [] for a legacy file with no favoriteModels key", () => {
      fs.writeFileSync(filePath, JSON.stringify({ pinnedDirectories: [], sessionOrder: {} }));
      const store = createPreferencesStore(filePath);
      expect(store.getFavoriteModels()).toEqual([]);
      store.dispose();
    });
  });
});
