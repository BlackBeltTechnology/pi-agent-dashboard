/**
 * X10 — self-containment: a `.gltf` that references an external buffer URI is
 * refused by name, so no HTML can later depend on a missing side-car file.
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
const EXTERNAL_URI = "bin/model.bin";
const GLTF = JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: EXTERNAL_URI, byteLength: 4 }] });

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
  download = await startMockServer({ body: GLTF, contentType: "model/gltf+json" });
  search = await startMockServer({
    contentType: "application/json",
    body: JSON.stringify({ results: [{ id: "robot", name: "Robot", Download: `${download.url}/robot.gltf`, Licence: "CC0-1.0" }] }),
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
    bytes: GLTF.length,
    licence: "CC0-1.0",
    author: "Test",
    downloadUrl: `${download.url}/robot.gltf`,
  };
}

describe("X10 .gltf with external URIs", () => {
  it("fetchProp names the external URI and writes no cache file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-x10u-"));
    await expect(fetchProp(candidate(), { destDir: dir })).rejects.toThrow(/bin\/model\.bin/);
    await expect(fetchProp(candidate(), { destDir: dir })).rejects.toThrow(/self-containment/);
    expect(existsSync(join(dir, CACHE_FILE))).toBe(false);
  });

  it("props fetch exits non-zero naming the external URI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-x10-"));
    const r = await runCli(["props", "fetch", "poly-pizza", "robot"], dir, {
      ...process.env,
      POLY_PIZZA_KEY: "k",
      POLY_PIZZA_ENDPOINT: `${search.url}/search`,
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(EXTERNAL_URI);
    expect(r.stderr).toContain("self-containment");
    expect(existsSync(join(dir, ".deck3d", "props", CACHE_FILE))).toBe(false);
  });
});
