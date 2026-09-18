/**
 * R4 — prop self-containment must cover textures, not only geometry buffers.
 * A `.gltf` that references an external `images[].uri` would be hash-pinned and
 * embedded while the rendered HTML still depends on a missing side-car; it must
 * be refused by name. `data:` image URIs stay allowed.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type MockServer, startMockServer } from "../../__tests__/helpers/mock-http.js";
import { fetchProp } from "../fetch.js";
import type { PropCandidate } from "../search.js";

const EXTERNAL_IMAGE_URI = "tex/a.png";
const CACHE_FILE = "poly-pizza-robot.glb";

/** A non-GLB `.gltf` with a `data:` buffer and the given images array. */
function gltf(images: Array<{ uri: string }>): string {
  return JSON.stringify({
    asset: { version: "2.0" },
    buffers: [{ uri: "data:application/octet-stream;base64,AAAA", byteLength: 4 }],
    images,
  });
}

let download: MockServer;

beforeAll(async () => {
  download = await startMockServer({ body: gltf([{ uri: EXTERNAL_IMAGE_URI }]), contentType: "model/gltf+json" });
});
afterAll(async () => {
  await download.close();
});

function candidate(): PropCandidate {
  return {
    source: "poly-pizza",
    id: "robot",
    name: "Robot",
    tags: [],
    tris: 10,
    bytes: 128,
    licence: "CC0-1.0",
    author: "Test",
    downloadUrl: `${download.url}/robot.gltf`,
  };
}

describe("R4 .gltf with an external image URI", () => {
  it("fetchProp names the external image URI and writes no cache file", async () => {
    download.set({ body: gltf([{ uri: EXTERNAL_IMAGE_URI }]), contentType: "model/gltf+json" });
    const dir = mkdtempSync(join(tmpdir(), "deck3d-r4-"));
    await expect(fetchProp(candidate(), { destDir: dir })).rejects.toThrow(/tex\/a\.png/);
    await expect(fetchProp(candidate(), { destDir: dir })).rejects.toThrow(/self-containment/);
    expect(existsSync(join(dir, CACHE_FILE))).toBe(false);
  });

  it("a data: image URI is still accepted", async () => {
    download.set({ body: gltf([{ uri: "data:image/png;base64,AAAA" }]), contentType: "model/gltf+json" });
    const dir = mkdtempSync(join(tmpdir(), "deck3d-r4-ok-"));
    const result = await fetchProp(candidate(), { destDir: dir });
    expect(existsSync(result.path)).toBe(true);
  });
});
