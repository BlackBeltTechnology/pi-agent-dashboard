/**
 * Tests for the pure package-health classifier + boot-time log scan.
 * See change: add-package-health-cleanup.
 */
import { describe, expect, it, vi } from "vitest";
import {
  formatHealthSummaryLine,
  logPackageHealthAtBoot,
  type PackageHealthDeps,
  scanPackageHealth,
} from "../package-health-scanner.js";

/** Fake fs: `dirs` maps installedPath → package.json meta (null = dir without package.json). */
function fakeDeps(
  dirs: Record<string, { name?: string; version?: string } | null>,
): PackageHealthDeps {
  return {
    existsSync: (p) => p in dirs,
    readMeta: (p) => dirs[p] ?? {},
    statMtime: (p) => (p in dirs ? "2026-01-01T00:00:00.000Z" : undefined),
  };
}

describe("scanPackageHealth", () => {
  it("empty input → all-zero summary", () => {
    expect(scanPackageHealth([], fakeDeps({}))).toEqual({
      entries: [],
      summary: { ok: 0, staleNpm: 0, missingPath: 0, duplicateGroups: [] },
    });
  });

  it("all-ok input → no stale, missing or duplicates; fields populated", () => {
    const res = scanPackageHealth(
      [
        { source: "npm:a", installedPath: "/n/a" },
        { source: "/dev/b", installedPath: "/dev/b" },
      ],
      fakeDeps({ "/n/a": { name: "a", version: "1.0.0" }, "/dev/b": { name: "b", version: "2.0.0" } }),
    );
    expect(res.summary).toEqual({ ok: 2, staleNpm: 0, missingPath: 0, duplicateGroups: [] });
    expect(res.entries[0]).toMatchObject({
      source: "npm:a",
      status: "ok",
      resolvedPath: "/n/a",
      packageName: "a",
      version: "1.0.0",
      mtime: "2026-01-01T00:00:00.000Z",
    });
    expect(res.entries[0].duplicateGroupId).toBeUndefined();
  });

  it("npm source with no installedPath → stale-npm, no resolvedPath", () => {
    const res = scanPackageHealth([{ source: "npm:gone@1.2.3" }], fakeDeps({}));
    expect(res.entries[0].status).toBe("stale-npm");
    expect(res.entries[0].resolvedPath).toBeUndefined();
    expect(res.entries[0].reason).toBeTruthy();
    expect(res.summary.staleNpm).toBe(1);
  });

  it("npm source whose installedPath no longer exists → stale-npm", () => {
    const res = scanPackageHealth([{ source: "npm:gone", installedPath: "/n/gone" }], fakeDeps({}));
    expect(res.entries[0].status).toBe("stale-npm");
  });

  it.each([
    ["local abs path", "/old/place"],
    ["git url", "git:github.com/o/r"],
    ["https url", "https://github.com/o/r"],
  ])("%s with no install dir → missing-path", (_label, source) => {
    const res = scanPackageHealth([{ source }], fakeDeps({}));
    expect(res.entries[0].status).toBe("missing-path");
    expect(res.summary.missingPath).toBe(1);
  });

  it("existing dir without package.json stays ok (never suggest dropping a live path)", () => {
    const res = scanPackageHealth(
      [{ source: "/ext/dir", installedPath: "/ext/dir" }],
      fakeDeps({ "/ext/dir": null }),
    );
    expect(res.entries[0]).toMatchObject({ status: "ok", resolvedPath: "/ext/dir" });
    expect(res.entries[0].packageName).toBeUndefined();
  });

  it("4-copy duplicate (session 019e4411 case) groups under one deterministic id", () => {
    const meta = { name: "Pi-Dashboard-Extension", version: "1.0.0" };
    const res = scanPackageHealth(
      [
        { source: "/proj/ext", installedPath: "/proj/ext" },
        { source: "/Applications/app/ext", installedPath: "/Applications/app/ext" },
        { source: "/home/.pi-dashboard/ext", installedPath: "/home/.pi-dashboard/ext" },
        { source: "/cache/ext", installedPath: "/cache/ext" },
      ],
      fakeDeps({
        "/proj/ext": meta,
        "/Applications/app/ext": meta,
        "/home/.pi-dashboard/ext": meta,
        "/cache/ext": meta,
      }),
    );
    expect(res.entries.every((e) => e.status === "duplicate")).toBe(true);
    expect(new Set(res.entries.map((e) => e.duplicateGroupId))).toEqual(
      new Set(["dup:pi-dashboard-extension"]),
    );
    expect(res.summary.ok).toBe(0);
    expect(res.summary.duplicateGroups).toEqual([
      { id: "dup:pi-dashboard-extension", packageName: "Pi-Dashboard-Extension", count: 4 },
    ]);
  });

  it("mixed input produces correct per-status counts", () => {
    const res = scanPackageHealth(
      [
        { source: "npm:ok1", installedPath: "/n/ok1" },
        { source: "npm:stale" },
        { source: "/dead" },
        { source: "/x/dup", installedPath: "/x/dup" },
        { source: "/y/dup", installedPath: "/y/dup" },
      ],
      fakeDeps({
        "/n/ok1": { name: "ok1" },
        "/x/dup": { name: "dup" },
        "/y/dup": { name: "dup" },
      }),
    );
    expect(res.summary).toEqual({
      ok: 1,
      staleNpm: 1,
      missingPath: 1,
      duplicateGroups: [{ id: "dup:dup", packageName: "dup", count: 2 }],
    });
  });
});

describe("formatHealthSummaryLine", () => {
  it("renders the greppable single line with duplicate detail", () => {
    const line = formatHealthSummaryLine(13, {
      ok: 6,
      staleNpm: 4,
      missingPath: 2,
      duplicateGroups: [{ id: "dup:pi-dashboard-extension", packageName: "pi-dashboard-extension", count: 2 }],
    });
    expect(line).toBe(
      "[package-health] 13 entries: 6 ok, 4 stale-npm, 2 missing-path, 1 duplicate-group (pi-dashboard-extension ×2)",
    );
  });
});

describe("logPackageHealthAtBoot", () => {
  const log = () => ({ info: vi.fn(), warn: vi.fn() });

  it("emits nothing when every entry is ok", async () => {
    const l = log();
    await logPackageHealthAtBoot({
      listInstalled: () => [{ source: "npm:a", installedPath: "/n/a" }],
      deps: fakeDeps({ "/n/a": { name: "a" } }),
      log: l,
    });
    expect(l.info).not.toHaveBeenCalled();
    expect(l.warn).not.toHaveBeenCalled();
  });

  it("emits exactly one INFO line with counts when issues exist", async () => {
    const l = log();
    await logPackageHealthAtBoot({
      listInstalled: () => [{ source: "npm:a", installedPath: "/n/a" }, { source: "npm:stale" }, { source: "/dead" }],
      deps: fakeDeps({ "/n/a": { name: "a" } }),
      log: l,
    });
    expect(l.info).toHaveBeenCalledTimes(1);
    expect(l.info.mock.calls[0][0]).toMatch(
      /^\[package-health\] 3 entries: 1 ok, 1 stale-npm, 1 missing-path, 0 duplicate-group/,
    );
  });

  it("never throws: scanner failure is a WARN with the message only", async () => {
    const l = log();
    await expect(
      logPackageHealthAtBoot({
        listInstalled: () => {
          throw new Error("settings unreadable");
        },
        log: l,
      }),
    ).resolves.toBeUndefined();
    expect(l.warn).toHaveBeenCalledTimes(1);
    expect(l.warn.mock.calls[0].join(" ")).toContain("settings unreadable");
    expect(l.warn.mock.calls[0].some((a) => a instanceof Error)).toBe(false);
  });

  it("never throws on async rejection", async () => {
    const l = log();
    await expect(
      logPackageHealthAtBoot({ listInstalled: () => Promise.reject(new Error("boom")), log: l }),
    ).resolves.toBeUndefined();
    expect(l.warn).toHaveBeenCalledTimes(1);
  });
});
