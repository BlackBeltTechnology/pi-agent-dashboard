/**
 * X8 — `props generate` is a pure fallback: with `python3` (or
 * `gradio_client`) missing it exits non-zero with the install hint and writes
 * nothing into the prop cache.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { glbOfSize, type MockServer, startMockServer } from "../../__tests__/helpers/mock-http.js";
import { generateProp, type SpawnFn, textToImage } from "../generate.js";

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

/**
 * test-plan #X10/#X12 — `--prompt` only adds a hop in front of the existing
 * image path, so both failure modes must stay non-destructive: an endpoint
 * error and a missing interpreter each leave the prop cache untouched.
 *
 * Driven in-process: `spawnSync` on the CLI would block the very event loop
 * serving the mock endpoint.
 */
describe("X10/X12 props generate --prompt failure modes", () => {
  let server: MockServer;
  beforeAll(async () => {
    server = await startMockServer();
  });
  afterAll(async () => {
    await server.close();
  });

  it("names the endpoint and writes nothing when the service errors (X10)", async () => {
    server.set({ status: 500, body: "nope" });
    const destDir = join(mkdtempSync(join(tmpdir(), "deck3d-x10-")), ".deck3d", "props");

    await expect(
      textToImage({ prompt: "ship", name: "ship", destDir, url: `${server.url}/?p={prompt}` }),
    ).rejects.toThrow(/500/);
    expect(existsSync(join(destDir, "generated-ship.png"))).toBe(false);
    expect(existsSync(join(destDir, "generated-ship.glb"))).toBe(false);
  }, 60_000);

  it("caches the image, then reports the install hint when python3 is absent (X12)", async () => {
    server.set({ status: 200, body: glbOfSize(2048), contentType: "image/png" });
    const destDir = join(mkdtempSync(join(tmpdir(), "deck3d-x12-")), ".deck3d", "props");

    const image = await textToImage({ prompt: "ship", name: "ship", destDir, url: `${server.url}/?p={prompt}` });
    expect(existsSync(image)).toBe(true);

    const spawn: SpawnFn = () => ({ status: null, stdout: "", stderr: "", error: new Error("spawn python3 ENOENT") });
    await expect(generateProp({ fromImage: image, name: "ship", destDir, spawn })).rejects.toThrow(/python3/);
    expect(existsSync(join(destDir, "generated-ship.glb"))).toBe(false);
  }, 60_000);
});
