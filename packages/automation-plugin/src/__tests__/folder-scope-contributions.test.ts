/**
 * Folder-scope contribution collector — boundary validation, warn-once-per-key,
 * dedup by resolved path, home-dir drop. Mirrors the `collectActionRegistry`
 * collector pattern (`action-registry.test.ts`).
 * See change: add-automation-folder-scope-contribution.
 */
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  FOLDER_SCOPE_CONTRIBUTION_PREFIX,
  collectFolderScopeBases,
} from "../server/folder-scope-contributions.js";

const entry = (key: string, value: unknown) => ({ key, value });

describe("collectFolderScopeBases", () => {
  it("exposes the contribution prefix", () => {
    expect(FOLDER_SCOPE_CONTRIBUTION_PREFIX).toBe("automation.folderscope.");
  });

  it("E1: collects a valid contribution, resolving the base", () => {
    const warn = vi.fn();
    const out = collectFolderScopeBases([entry("automation.folderscope.a", { base: "/repo" })], { warn });
    expect(out).toEqual([path.resolve("/repo")]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("E2: ignores every bad shape and warns once per bad key", () => {
    const warn = vi.fn();
    const entries = [
      entry("automation.folderscope.empty", { base: "" }),
      entry("automation.folderscope.ws", { base: "  " }),
      entry("automation.folderscope.num", { base: 42 }),
      entry("automation.folderscope.arr", ["x"]),
      entry("automation.folderscope.null", null),
      entry("automation.folderscope.nobase", {}),
    ];
    const out = collectFolderScopeBases(entries, { warn });
    expect(out).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(entries.length);
  });

  it("E3: isolates invalid entries while collecting the valid survivors", () => {
    const warn = vi.fn();
    const out = collectFolderScopeBases(
      [
        entry("automation.folderscope.k1", { base: "/a" }),
        entry("automation.folderscope.k2", { base: "" }),
        entry("automation.folderscope.k3", { base: "/b" }),
      ],
      { warn },
    );
    expect(out.sort()).toEqual([path.resolve("/a"), path.resolve("/b")].sort());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("automation.folderscope.k2");
  });

  it("E4: dedups by resolved path (trailing slash is the same base)", () => {
    const warn = vi.fn();
    const out = collectFolderScopeBases(
      [
        entry("automation.folderscope.a", { base: "/a" }),
        entry("automation.folderscope.b", { base: "/a/" }),
      ],
      { warn },
    );
    expect(out).toEqual([path.resolve("/a")]);
  });

  it("rejects a relative `base` (spec requires absolute; `.` would resolve against server cwd)", () => {
    const warn = vi.fn();
    const out = collectFolderScopeBases(
      [
        entry("automation.folderscope.dot", { base: "." }),
        entry("automation.folderscope.rel", { base: "sub/dir" }),
        entry("automation.folderscope.abs", { base: "/repo" }),
      ],
      { warn },
    );
    expect(out).toEqual([path.resolve("/repo")]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("E5: guards a path.resolve throw — no throw propagates, warned once", () => {
    const warn = vi.fn();
    const realResolve = path.resolve;
    const spy = vi.spyOn(path, "resolve").mockImplementation(((...args: string[]) => {
      if (args.some((a) => typeof a === "string" && a.includes("\u0000"))) {
        throw new TypeError("path must be a string without null bytes");
      }
      return realResolve(...args);
    }) as typeof path.resolve);
    try {
      let out: string[] = [];
      expect(() => {
        out = collectFolderScopeBases([entry("automation.folderscope.bad", { base: "/\u0000bad" })], { warn });
      }).not.toThrow();
      expect(out).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("E6: warns at most once per key across repeated reads (shared warnedKeys)", () => {
    const warn = vi.fn();
    const warnedKeys = new Set<string>();
    const entries = [entry("automation.folderscope.badkey", {})];
    for (let i = 0; i < 3; i++) collectFolderScopeBases(entries, { warn, warnedKeys });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("automation.folderscope.badkey");
  });

  it("rejects non-plain objects (Date/Map/class instance) even with a valid `base`", () => {
    const warn = vi.fn();
    class RepoRef {
      base = "/repo";
    }
    const map = new Map<string, string>();
    map.set("base", "/repo");
    const out = collectFolderScopeBases(
      [
        entry("automation.folderscope.cls", new RepoRef()),
        entry("automation.folderscope.date", Object.assign(new Date(), { base: "/repo" })),
        entry("automation.folderscope.map", map),
        entry("automation.folderscope.nullproto", Object.assign(Object.create(null), { base: "/ok" })),
      ],
      { warn },
    );
    // Date/Map/class instances rejected; a null-prototype plain-data object is accepted.
    expect(out).toEqual([path.resolve("/ok")]);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("isolates a hostile throwing `base` getter (fail-open) without aborting valid survivors", () => {
    const warn = vi.fn();
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, "base", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    let out: string[] = [];
    expect(() => {
      out = collectFolderScopeBases(
        [
          entry("automation.folderscope.hostile", hostile),
          entry("automation.folderscope.good", { base: "/repo" }),
        ],
        { warn },
      );
    }).not.toThrow();
    expect(out).toEqual([path.resolve("/repo")]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("automation.folderscope.hostile");
  });

  it("E7: drops a contributed base equal to the resolved home dir", () => {
    const warn = vi.fn();
    const home = path.resolve("/home/user");
    const out = collectFolderScopeBases(
      [
        entry("automation.folderscope.home", { base: home }),
        entry("automation.folderscope.repo", { base: "/repo" }),
      ],
      { warn, homeDir: home },
    );
    expect(out).toEqual([path.resolve("/repo")]);
  });

  it("drops a contributed base equal to home even when home is passed unresolved", () => {
    const warn = vi.fn();
    const out = collectFolderScopeBases([entry("automation.folderscope.home", { base: "/home/user/" })], {
      warn,
      homeDir: "/home/user",
    });
    expect(out).toEqual([]);
  });
});
