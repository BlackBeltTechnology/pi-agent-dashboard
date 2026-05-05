import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mergeInstallableList, readInstallableList, writeInstallableList } from "../installable-list.js";
import type { InstallableList } from "../installable-list.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── mergeInstallableList tests ──────────────────────────────────────────────

describe("mergeInstallableList", () => {
  it("keep-user-pin: user version wins when it differs from bundled", () => {
    const existing: InstallableList = {
      version: "1",
      packages: [{ name: "tsx", version: "^4.0.0", required: true, kind: "npm" }],
    };
    const bundled: InstallableList = {
      version: "2",
      packages: [{ name: "tsx", version: "^5.0.0", required: true, kind: "npm" }],
    };
    const { list, warnings } = mergeInstallableList(existing, bundled);
    const found = list.packages.find((p) => p.name === "tsx");
    expect(found?.version).toBe("^4.0.0");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("tsx");
    expect(warnings[0]).toContain("^4.0.0");
    expect(warnings[0]).toContain("^5.0.0");
  });

  it("drop-pin-warn: package in existing but not in bundled gets deprecated=true + warning", () => {
    const existing: InstallableList = {
      version: "1",
      packages: [{ name: "old-tool", version: "^1.0.0", required: false, kind: "npm" }],
    };
    const bundled: InstallableList = { version: "2", packages: [] };
    const { list, warnings } = mergeInstallableList(existing, bundled);
    const found = list.packages.find((p) => p.name === "old-tool");
    expect(found?.deprecated).toBe(true);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("old-tool");
  });

  it("add-new-required: new required package from bundled is added as-is", () => {
    const existing: InstallableList = { version: "1", packages: [] };
    const bundled: InstallableList = {
      version: "2",
      packages: [{ name: "pi", version: "*", required: true, kind: "npm" }],
    };
    const { list, warnings } = mergeInstallableList(existing, bundled);
    const found = list.packages.find((p) => p.name === "pi");
    expect(found).toBeDefined();
    expect(found?.required).toBe(true);
    expect(found?.defaultOff).toBeFalsy();
    expect(warnings).toHaveLength(0);
  });

  it("add-new-optional: new optional package from bundled is added with defaultOff=true", () => {
    const existing: InstallableList = { version: "1", packages: [] };
    const bundled: InstallableList = {
      version: "2",
      packages: [{ name: "openspec", version: "*", required: false, kind: "npm" }],
    };
    const { list, warnings } = mergeInstallableList(existing, bundled);
    const found = list.packages.find((p) => p.name === "openspec");
    expect(found).toBeDefined();
    expect(found?.defaultOff).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it("version marker in result comes from bundled", () => {
    const existing: InstallableList = { version: "1", packages: [] };
    const bundled: InstallableList = { version: "42", packages: [] };
    const { list } = mergeInstallableList(existing, bundled);
    expect(list.version).toBe("42");
  });
});

// ── readInstallableList tests ───────────────────────────────────────────────
// Use a real temp directory (HOME is already ephemeral in the test runner).

describe("readInstallableList", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "installable-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns null when file is absent", async () => {
    const result = await readInstallableList(tmpDir);
    expect(result).toBeNull();
  });

  it("drops entries with invalid kind and warns", async () => {
    const list: InstallableList = {
      version: "1",
      packages: [
        { name: "good-pkg", version: "*", required: true, kind: "npm" },
        { name: "bad-pkg", version: "*", required: true, kind: "unknown-kind" as any },
      ],
    };
    // Write via writeInstallableList (bypasses the drop-invalid-kind guard).
    const filePath = path.join(tmpDir, "installable.json");
    fs.writeFileSync(filePath, JSON.stringify(list), "utf-8");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await readInstallableList(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.packages.map((p) => p.name)).toEqual(["good-pkg"]);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain("bad-pkg");
  });

  it("reads a valid file and returns the list", async () => {
    const list: InstallableList = {
      version: "3",
      packages: [{ name: "tsx", version: "^5.0.0", required: true, kind: "npm" }],
    };
    await writeInstallableList(list, tmpDir);
    const result = await readInstallableList(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.version).toBe("3");
    expect(result!.packages).toHaveLength(1);
    expect(result!.packages[0]!.name).toBe("tsx");
  });
});
