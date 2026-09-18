import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { glbOfSize, type MockServer, startMockServer } from "../../__tests__/helpers/mock-http.js";
import { fetchProp } from "../fetch.js";
import type { PropCandidate } from "../search.js";

let server: MockServer;
beforeAll(async () => {
  server = await startMockServer();
});
afterAll(async () => {
  await server.close();
});

function candidate(): PropCandidate {
  return {
    source: "poly-pizza",
    id: "robot",
    name: "Robot",
    tags: ["robot"],
    tris: 100,
    bytes: 10,
    licence: "CC0-1.0",
    author: "Test",
    downloadUrl: `${server.url}/robot.glb`,
  };
}

const cache = () => mkdtempSync(join(tmpdir(), "deck3d-props-"));

describe("fetchProp", () => {
  it("downloads a GLB, pins the hash, and is idempotent when unchanged", async () => {
    const dir = cache();
    server.set({ body: glbOfSize(64) });
    const first = await fetchProp(candidate(), { destDir: dir });
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(first.path)).toBe(true);
    const second = await fetchProp(candidate(), { destDir: dir });
    expect(second.sha256).toBe(first.sha256);
  });

  it("fails when the cached bytes differ (E30)", async () => {
    const dir = cache();
    server.set({ body: glbOfSize(64) });
    await fetchProp(candidate(), { destDir: dir });
    server.set({ body: glbOfSize(80) });
    await expect(fetchProp(candidate(), { destDir: dir })).rejects.toThrow(/cached hash/);
  });

  it("enforces the inclusive MiB cap (E31)", async () => {
    const dir = cache();
    server.set({ body: glbOfSize(8 * 1024 * 1024) });
    await expect(fetchProp(candidate(), { destDir: dir })).resolves.toBeTruthy();

    const dir2 = cache();
    server.set({ body: glbOfSize(8 * 1024 * 1024 + 1) });
    await expect(fetchProp(candidate(), { destDir: dir2 })).rejects.toThrow(/cap 8388608/);
    expect(existsSync(join(dir2, "poly-pizza-robot.glb"))).toBe(false);
  });

  it("refuses a non-glTF body even with a glb content-type (X9)", async () => {
    const dir = cache();
    server.set({ body: "<html>", contentType: "model/gltf-binary" });
    await expect(fetchProp(candidate(), { destDir: dir })).rejects.toThrow(/not a glTF\/GLB/);
  });

  it("refuses a .gltf with an external URI (X10)", async () => {
    const dir = cache();
    server.set({ body: JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "bin/model.bin" }] }) });
    await expect(fetchProp(candidate(), { destDir: dir })).rejects.toThrow(/bin\/model\.bin/);
  });

  it("reads a vendored prop from assets (no network)", async () => {
    const dir = cache();
    const vendored: PropCandidate = { ...candidate(), source: "vendored", id: "robot", downloadUrl: undefined };
    const result = await fetchProp(vendored, { destDir: dir });
    expect(readFileSync(result.path).subarray(0, 4).toString("latin1")).toBe("glTF");
  });
});
