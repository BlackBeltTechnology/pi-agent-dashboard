import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { scanOpenSpecArchive } from "../openspec/openspec-archive.js";

describe("scanOpenSpecArchive", () => {
  let tmpDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "archive-test-"));
    archiveDir = path.join(tmpDir, "openspec", "changes", "archive");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when archive directory does not exist", async () => {
    const result = await scanOpenSpecArchive(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns empty array when archive directory is empty", async () => {
    await fs.mkdir(archiveDir, { recursive: true });
    const result = await scanOpenSpecArchive(tmpDir);
    expect(result).toEqual([]);
  });

  it("detects all artifacts for a fully-populated entry", async () => {
    const entryDir = path.join(archiveDir, "2026-03-27-my-feature");
    await fs.mkdir(path.join(entryDir, "specs"), { recursive: true });
    await fs.writeFile(path.join(entryDir, "proposal.md"), "# Proposal");
    await fs.writeFile(path.join(entryDir, "design.md"), "# Design");
    await fs.writeFile(path.join(entryDir, "tasks.md"), "# Tasks");

    const result = await scanOpenSpecArchive(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("2026-03-27-my-feature");
    expect(result[0].date).toBe("2026-03-27");
    const ids = result[0].artifacts.map((a) => a.id).sort();
    expect(ids).toEqual(["design", "proposal", "specs", "tasks"]);
  });

  it("detects partial artifacts", async () => {
    const entryDir = path.join(archiveDir, "2026-03-22-partial");
    await fs.mkdir(entryDir, { recursive: true });
    await fs.writeFile(path.join(entryDir, "proposal.md"), "# Proposal");

    const result = await scanOpenSpecArchive(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].artifacts).toEqual([{ id: "proposal", status: "done" }]);
  });

  it("skips entries without date prefix", async () => {
    const entryDir = path.join(archiveDir, "no-date-prefix");
    await fs.mkdir(entryDir, { recursive: true });
    await fs.writeFile(path.join(entryDir, "proposal.md"), "# Proposal");

    const result = await scanOpenSpecArchive(tmpDir);
    expect(result).toEqual([]);
  });

  it("sorts entries newest-first", async () => {
    for (const name of ["2026-03-22-old", "2026-04-01-new", "2026-03-28-mid"]) {
      const dir = path.join(archiveDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "proposal.md"), "# P");
    }

    const result = await scanOpenSpecArchive(tmpDir);
    expect(result.map((e) => e.name)).toEqual([
      "2026-04-01-new",
      "2026-03-28-mid",
      "2026-03-22-old",
    ]);
  });

  it("skips files (non-directories) in archive dir", async () => {
    await fs.mkdir(archiveDir, { recursive: true });
    await fs.writeFile(path.join(archiveDir, "2026-01-01-not-a-dir"), "file");

    const result = await scanOpenSpecArchive(tmpDir);
    expect(result).toEqual([]);
  });
});
