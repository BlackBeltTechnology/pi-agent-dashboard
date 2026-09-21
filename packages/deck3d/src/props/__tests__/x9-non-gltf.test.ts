/**
 * X9 — a download that is not glTF/GLB is refused even when the server claims
 * `Content-Type: model/gltf-binary`, and no cache file is written.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type MockServer, startMockServer } from "../../__tests__/helpers/mock-http.js";
import { fetchProp } from "../fetch.js";
import type { PropCandidate } from "../search.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const CACHE_FILE = "poly-pizza-robot.glb";

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<CliRun> {
  return new Promise((resolve) => {
    const child = spawn(BIN, args, { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

let download: MockServer;
let search: MockServer;

beforeAll(async () => {
  download = await startMockServer({ body: "<html>", contentType: "model/gltf-binary" });
  search = await startMockServer({
    contentType: "application/json",
    body: JSON.stringify({ results: [{ id: "robot", name: "Robot", Download: `${download.url}/robot.glb`, Licence: "CC0-1.0" }] }),
  });
});
afterAll(async () => {
  await download.close();
  await search.close();
});

function candidate(): PropCandidate {
  return {
    source: "poly-pizza",
    id: "robot",
    name: "Robot",
    tags: [],
    tris: 10,
    bytes: 6,
    licence: "CC0-1.0",
    author: "Test",
    downloadUrl: `${download.url}/robot.glb`,
  };
}

describe("X9 non-glTF download", () => {
  it("fetchProp refuses the body and writes no cache file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-x9u-"));
    await expect(fetchProp(candidate(), { destDir: dir })).rejects.toThrow(/not a glTF\/GLB/);
    expect(existsSync(join(dir, CACHE_FILE))).toBe(false);
  });

  it("props fetch exits non-zero with the reason and writes no cache file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-x9-"));
    const r = await runCli(["props", "fetch", "poly-pizza", "robot"], dir, {
      ...process.env,
      POLY_PIZZA_KEY: "k",
      POLY_PIZZA_ENDPOINT: `${search.url}/search`,
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("not a glTF/GLB");
    expect(existsSync(join(dir, ".deck3d", "props", CACHE_FILE))).toBe(false);
  });
});
