/**
 * X8 — `props generate` is a pure fallback: with `python3` (or
 * `gradio_client`) missing it exits non-zero with the install hint and writes
 * nothing into the prop cache.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateProp, type SpawnFn } from "../generate.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

describe("X8 generate fallback unavailable", () => {
  it("reports the install hint when gradio_client is missing (injected spawn)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-x8u-"));
    const spawn: SpawnFn = () => ({
      status: 1,
      stdout: "",
      stderr: "ModuleNotFoundError: No module named 'gradio_client'",
    });
    await expect(generateProp({ fromImage: "x.png", name: "y", destDir: dir, spawn })).rejects.toThrow(
      /pip install gradio_client/,
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  it("reports the install hint when python3 cannot be spawned at all", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-x8u2-"));
    const spawn: SpawnFn = () => ({ status: null, stdout: "", stderr: "", error: new Error("spawnSync python3 ENOENT") });
    const promise = generateProp({ fromImage: "x.png", name: "y", destDir: dir, spawn });
    await expect(promise).rejects.toThrow(/pip install gradio_client/);
    await expect(promise).rejects.toThrow(/python3 is unavailable/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("props generate exits non-zero with the hint and writes no cache file", () => {
    // A PATH holding `node` (for the launcher shebang) but no `python3`.
    const binPath = mkdtempSync(join(tmpdir(), "deck3d-x8path-"));
    symlinkSync(process.execPath, join(binPath, "node"));
    const dir = mkdtempSync(join(tmpdir(), "deck3d-x8-"));
    const r = spawnSync(BIN, ["props", "generate", "--from-image", "x.png", "--name", "y"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: binPath },
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("pip install gradio_client");
    expect(readdirSync(dir)).toEqual([]);
  });
});
