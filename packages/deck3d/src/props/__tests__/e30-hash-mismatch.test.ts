/**
 * E30 — a cached GLB whose bytes changed after `fetch` is refused naming the
 * prop: `props fetch` (verify mode) fails, `render` fails and writes no HTML.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { glbOfSize, type MockServer, startMockServer } from "../../__tests__/helpers/mock-http.js";
import { validIR } from "../../ir/__tests__/fixtures.js";
import { fetchProp, sha256 } from "../fetch.js";
import type { PropCandidate } from "../search.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const CACHE_KEY = "vendored-robot.glb";

function cli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

let server: MockServer;
beforeAll(async () => {
  server = await startMockServer();
});
afterAll(async () => {
  await server.close();
});

function remoteCandidate(): PropCandidate {
  return {
    source: "poly-pizza",
    id: "robot",
    name: "Robot",
    tags: [],
    tris: 10,
    bytes: 64,
    licence: "CC0-1.0",
    author: "Test",
    downloadUrl: `${server.url}/robot.glb`,
  };
}

/** Deck whose prop is pinned to `bytes` while the cache holds tampered bytes. */
function tamperedDeck(): string {
  const dir = mkdtempSync(join(tmpdir(), "deck3d-e30-"));
  const original = glbOfSize(2048);
  const pinned = sha256(new Uint8Array(original));
  const ir = validIR();
  ir.overrides.props = [
    {
      source: "vendored",
      id: "robot",
      licence: "CC0-1.0",
      author: "deck3d corpus",
      sha256: pinned,
      slide: "intro",
      role: "illustration",
    },
  ];
  writeFileSync(join(dir, "deck.json"), `${JSON.stringify(ir, null, 2)}\n`);
  mkdirSync(join(dir, ".deck3d", "props"), { recursive: true });
  const tampered = Buffer.from(original);
  tampered[16] = tampered[16] ^ 0xff;
  writeFileSync(join(dir, ".deck3d", "props", CACHE_KEY), tampered);
  return dir;
}

describe("E30 hash mismatch", () => {
  it("fetchProp refuses a cached file that no longer matches (verify mode)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e30u-"));
    server.set({ body: glbOfSize(64) });
    await fetchProp(remoteCandidate(), { destDir: dir });
    server.set({ body: glbOfSize(80) });
    await expect(fetchProp(remoteCandidate(), { destDir: dir })).rejects.toThrow(/poly-pizza-robot: cached hash/);
  });

  it("props fetch exits non-zero naming the prop when the cache was tampered", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e30c-"));
    const first = cli(["props", "fetch", "vendored", "robot"], dir);
    expect(first.status, first.stderr).toBe(0);
    const cached = join(dir, ".deck3d", "props", CACHE_KEY);
    expect(existsSync(cached)).toBe(true);

    const bytes = readFileSync(cached);
    bytes[8] = bytes[8] ^ 0xff;
    writeFileSync(cached, bytes);

    const again = cli(["props", "fetch", "vendored", "robot"], dir);
    expect(again.status).not.toBe(0);
    expect(again.stderr).toContain("cached hash");
    expect(again.stderr).toContain("vendored-robot");
  });

  it("render exits non-zero naming the prop and writes no HTML", () => {
    const dir = tamperedDeck();
    const r = cli(["render", "deck.json", "-o", "deck.html"], dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("robot");
    expect(r.stderr).toContain("≠ pinned");
    expect(existsSync(join(dir, "deck.html"))).toBe(false);
  });
});
