/**
 * Unit tests for bundle-extract.ts
 * All tests use an in-memory fake ExtractFs — no real filesystem.
 */
import { describe, it, expect } from "vitest";
import {
  needsExtraction,
  migrateConfigs,
  extractBundle,
  SURVIVE_EXTRACT_DIRS,
  VERSION_MARKER_FILENAME,
  type ExtractFs,
} from "../bundle-extract.js";

// ── Fake in-memory ExtractFs ──────────────────────────────────────────────────

type FakeFile = { type: "file"; content: string } | { type: "dir" };

function buildFakeFs(initial: Record<string, FakeFile | string> = {}): {
  fs: Required<ExtractFs>;
  files: Map<string, FakeFile>;
  removed: string[];
  copied: Array<{ src: string; dst: string }>;
} {
  const files = new Map<string, FakeFile>();

  // Populate from initial
  for (const [p, v] of Object.entries(initial)) {
    if (typeof v === "string") {
      files.set(p, { type: "file", content: v });
    } else {
      files.set(p, v);
    }
  }

  const removed: string[] = [];
  const copied: Array<{ src: string; dst: string }> = [];

  const fs: Required<ExtractFs> = {
    existsSync: (p) => files.has(p),
    readFileSync: (p, _enc) => {
      const f = files.get(p);
      if (!f || f.type !== "file") throw Object.assign(new Error("ENOENT: " + p), { code: "ENOENT" });
      return f.content;
    },
    writeFileSync: (p, data) => {
      files.set(p, { type: "file", content: data });
    },
    mkdirSync: (p, _opts) => {
      files.set(p, { type: "dir" });
    },
    readdirSync: (p) => {
      const results: string[] = [];
      for (const key of files.keys()) {
        const parentDir = key.replace(/[/\\][^/\\]+$/, "");
        if (parentDir === p && key !== p) {
          const name = key.slice(p.length + 1);
          if (!name.includes("/") && !name.includes("\\")) {
            results.push(name);
          }
        }
      }
      return results;
    },
    renameSync: (src, dst) => {
      const f = files.get(src);
      if (!f) throw Object.assign(new Error("ENOENT: " + src), { code: "ENOENT" });
      files.delete(src);
      files.set(dst, f);
    },
    rmSync: (p, _opts) => {
      removed.push(p);
      for (const key of [...files.keys()]) {
        if (key === p || key.startsWith(p + "/") || key.startsWith(p + "\\")) {
          files.delete(key);
        }
      }
    },
    statSync: (p) => {
      const f = files.get(p);
      if (!f) throw Object.assign(new Error("ENOENT: " + p), { code: "ENOENT" });
      return { isDirectory: () => f.type === "dir" };
    },
    cpSync: (src, dst, _opts) => {
      copied.push({ src, dst });
      // Simulate copying — mark dest as populated
      files.set(dst, { type: "dir" });
    },
  };

  return { fs, files, removed, copied };
}

// ── migrateConfigs ────────────────────────────────────────────────────────────

describe("migrateConfigs", () => {
  it("matches *config* pattern and moves the file", () => {
    const managedDir = "/managed";
    const migrateDir = "/migrate/ts";
    const { fs, files } = buildFakeFs({
      [managedDir]: { type: "dir" },
      [`${managedDir}/my-config.json`]: { type: "file", content: "{}" },
      [`${managedDir}/unrelated.txt`]: { type: "file", content: "x" },
    });
    const moved = migrateConfigs(managedDir, migrateDir, fs);
    expect(moved).toEqual(["my-config.json"]);
    expect(files.has(`${managedDir}/my-config.json`)).toBe(false);
    expect(files.has(`${migrateDir}/my-config.json`)).toBe(true);
    expect(files.has(`${managedDir}/unrelated.txt`)).toBe(true);
  });

  it("matches mode.json", () => {
    const managedDir = "/managed";
    const { fs, files } = buildFakeFs({
      [managedDir]: { type: "dir" },
      [`${managedDir}/mode.json`]: { type: "file", content: "{}" },
    });
    const moved = migrateConfigs(managedDir, "/migrate", fs);
    expect(moved).toContain("mode.json");
    expect(files.has(`${managedDir}/mode.json`)).toBe(false);
  });

  it("matches recommended-wizard.json", () => {
    const managedDir = "/managed";
    const { fs, files } = buildFakeFs({
      [managedDir]: { type: "dir" },
      [`${managedDir}/recommended-wizard.json`]: { type: "file", content: "{}" },
    });
    const moved = migrateConfigs(managedDir, "/migrate", fs);
    expect(moved).toContain("recommended-wizard.json");
    expect(files.has(`${managedDir}/recommended-wizard.json`)).toBe(false);
  });

  it("matches api-key.json", () => {
    const managedDir = "/managed";
    const { fs, files } = buildFakeFs({
      [managedDir]: { type: "dir" },
      [`${managedDir}/api-key.json`]: { type: "file", content: "{}" },
    });
    const moved = migrateConfigs(managedDir, "/migrate", fs);
    expect(moved).toContain("api-key.json");
  });

  it("missing source dir → no-op, no error", () => {
    const { fs } = buildFakeFs({});
    const moved = migrateConfigs("/nonexistent", "/migrate", fs);
    expect(moved).toEqual([]);
  });

  it("no matching files → returns [] without creating migrateDir", () => {
    const managedDir = "/managed";
    const { fs, files } = buildFakeFs({
      [managedDir]: { type: "dir" },
      [`${managedDir}/server.log`]: { type: "file", content: "" },
    });
    const moved = migrateConfigs(managedDir, "/migrate", fs);
    expect(moved).toEqual([]);
    expect(files.has("/migrate")).toBe(false);
  });
});

// ── needsExtraction ───────────────────────────────────────────────────────────

describe("needsExtraction", () => {
  it("version match → returns false", () => {
    const { fs } = buildFakeFs({
      "/managed": { type: "dir" },
      [`/managed/${VERSION_MARKER_FILENAME}`]: { type: "file", content: "1.2.3" },
    });
    expect(needsExtraction("/managed", "1.2.3", fs)).toBe(false);
  });

  it("version mismatch → returns true", () => {
    const { fs } = buildFakeFs({
      "/managed": { type: "dir" },
      [`/managed/${VERSION_MARKER_FILENAME}`]: { type: "file", content: "1.2.2" },
    });
    expect(needsExtraction("/managed", "1.2.3", fs)).toBe(true);
  });

  it("no .version file → returns true", () => {
    const { fs } = buildFakeFs({
      "/managed": { type: "dir" },
    });
    expect(needsExtraction("/managed", "1.2.3", fs)).toBe(true);
  });

  it("managed dir does not exist → returns true", () => {
    const { fs } = buildFakeFs({});
    expect(needsExtraction("/managed", "1.2.3", fs)).toBe(true);
  });

  it("trims whitespace in marker content", () => {
    const { fs } = buildFakeFs({
      "/managed": { type: "dir" },
      [`/managed/${VERSION_MARKER_FILENAME}`]: { type: "file", content: "  1.2.3\n" },
    });
    expect(needsExtraction("/managed", "1.2.3", fs)).toBe(false);
  });
});

// ── extractBundle ─────────────────────────────────────────────────────────────

describe("extractBundle", () => {
  it("survive-extract whitelist: node/, node-pending/, node-old/ are NOT removed during wipe", () => {
    const managedDir = "/managed";
    const sourceDir = "/source";
    const { fs, removed } = buildFakeFs({
      [managedDir]: { type: "dir" },
      [`${managedDir}/node`]: { type: "dir" },
      [`${managedDir}/node-pending`]: { type: "dir" },
      [`${managedDir}/node-old`]: { type: "dir" },
      [`${managedDir}/some-stale-file.txt`]: { type: "file", content: "" },
      [sourceDir]: { type: "dir" },
    });
    extractBundle(managedDir, sourceDir, "1.0.0", undefined, fs);

    // Node dirs must NOT be in removed list
    for (const d of SURVIVE_EXTRACT_DIRS) {
      expect(removed).not.toContain(`${managedDir}/${d}`);
    }
  });

  it("stray non-whitelisted entry IS removed during wipe", () => {
    const managedDir = "/managed";
    const sourceDir = "/source";
    const { fs, removed } = buildFakeFs({
      [managedDir]: { type: "dir" },
      [`${managedDir}/stray-dir`]: { type: "dir" },
      [`${managedDir}/old-file.txt`]: { type: "file", content: "" },
      [sourceDir]: { type: "dir" },
    });
    extractBundle(managedDir, sourceDir, "1.0.0", undefined, fs);
    expect(removed).toContain(`${managedDir}/stray-dir`);
    expect(removed).toContain(`${managedDir}/old-file.txt`);
  });

  it("missing sourceDir throws error", () => {
    const managedDir = "/managed";
    const { fs } = buildFakeFs({
      [managedDir]: { type: "dir" },
    });
    expect(() =>
      extractBundle(managedDir, "/nonexistent-source", "1.0.0", undefined, fs),
    ).toThrow("Bundle source directory not found: /nonexistent-source");
  });

  it("writes version marker after successful extraction", () => {
    const managedDir = "/managed";
    const sourceDir = "/source";
    const { fs, files } = buildFakeFs({
      [managedDir]: { type: "dir" },
      [sourceDir]: { type: "dir" },
    });
    extractBundle(managedDir, sourceDir, "2.0.0", undefined, fs);
    const marker = files.get(`${managedDir}/${VERSION_MARKER_FILENAME}`);
    expect(marker).toBeDefined();
    expect((marker as any).content).toBe("2.0.0");
  });

  it("migrate step runs before wipe when migrateDir is provided", () => {
    const managedDir = "/managed";
    const sourceDir = "/source";
    const migrateDir = "/migrate/ts";
    const { fs, files } = buildFakeFs({
      [managedDir]: { type: "dir" },
      [`${managedDir}/mode.json`]: { type: "file", content: '{"mode":"standalone"}' },
      [sourceDir]: { type: "dir" },
    });
    extractBundle(managedDir, sourceDir, "1.0.0", migrateDir, fs);
    // mode.json must have been migrated (moved to migrateDir)
    expect(files.has(`${migrateDir}/mode.json`)).toBe(true);
    expect(files.has(`${managedDir}/mode.json`)).toBe(false);
  });
});
