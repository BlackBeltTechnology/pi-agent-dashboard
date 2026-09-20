/**
 * E31 — the size cap is **inclusive**: exactly 8,388,608 bytes is accepted and
 * cached; 8,388,609 bytes is refused naming the actual size and the cap, with
 * no cache file written.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeLocalDeck, runCli as runDeckCli } from "../../__tests__/helpers/local-fx.js";
import { glbOfSize, type MockServer, startMockServer } from "../../__tests__/helpers/mock-http.js";
import { fetchProp } from "../fetch.js";
import type { PropCandidate } from "../search.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const CAP = 8 * 1024 * 1024;
const CACHE_FILE = "poly-pizza-robot.glb";

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Async spawn — the in-process mock server must keep serving while the CLI runs. */
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
  download = await startMockServer();
  search = await startMockServer();
  search.set({
    contentType: "application/json",
    body: JSON.stringify({ results: [{ id: "robot", name: "Robot", Download: `${download.url}/robot.glb` }] }),
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
    bytes: CAP,
    licence: "CC0-1.0",
    author: "Test",
    downloadUrl: `${download.url}/robot.glb`,
  };
}

function cliEnv(): NodeJS.ProcessEnv {
  return { ...process.env, POLY_PIZZA_KEY: "k", POLY_PIZZA_ENDPOINT: `${search.url}/search` };
}

describe("E31 oversized model (inclusive MiB cap)", () => {
  it("fetchProp accepts exactly the cap and writes the cache file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e31u-"));
    download.set({ body: glbOfSize(CAP) });
    const result = await fetchProp(candidate(), { destDir: dir });
    expect(result.bytes).toBe(CAP);
    expect(existsSync(result.path)).toBe(true);
    expect(existsSync(join(dir, CACHE_FILE))).toBe(true);
  });

  it("fetchProp refuses cap + 1 byte naming actual size and cap, writing nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e31u2-"));
    download.set({ body: glbOfSize(CAP + 1) });
    await expect(fetchProp(candidate(), { destDir: dir })).rejects.toThrow(
      new RegExp(`${CAP + 1} bytes > cap ${CAP}`),
    );
    expect(existsSync(join(dir, CACHE_FILE))).toBe(false);
  });

  it("props fetch accepts the cap-sized model", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e31a-"));
    download.set({ body: glbOfSize(CAP) });
    const r = await runCli(["props", "fetch", "poly-pizza", "robot"], dir, cliEnv());
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ source: "poly-pizza", id: "robot" });
    expect(existsSync(join(dir, ".deck3d", "props", CACHE_FILE))).toBe(true);
  });

  it("props fetch refuses cap + 1 byte with size and cap on stderr, no cache file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e31b-"));
    download.set({ body: glbOfSize(CAP + 1) });
    const r = await runCli(["props", "fetch", "poly-pizza", "robot"], dir, cliEnv());
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(String(CAP + 1));
    expect(r.stderr).toContain(String(CAP));
    expect(existsSync(join(dir, ".deck3d", "props", CACHE_FILE))).toBe(false);
  }, 30_000);
});

/**
 * test-plan #E2 — the 64 KiB local-effect cap. Module bytes land in every
 * rendered deck, so the boundary is enforced exactly, not approximately.
 */
describe("E2 local effect size cap", () => {
  /** A valid module padded with a trailing comment to hit `bytes` exactly. */
  function moduleOfSize(bytes: number): string {
    const head = "export default function (ctx, params) { return { dispose: function () {} }; }\n//";
    return head + "x".repeat(bytes - head.length - 1) + "\n";
  }

  it.each([
    [65_536, true],
    [65_537, false],
  ])("a %i byte module is accepted=%s", (bytes, accepted) => {
    const src = moduleOfSize(bytes);
    expect(Buffer.byteLength(src)).toBe(bytes);
    const { dir } = makeLocalDeck({ effects: [{ name: "big", src }] }, "deck3d-e2-");
    const r = runDeckCli(["validate", "deck.json"], dir);
    if (accepted) {
      expect(r.status, r.stderr).toBe(0);
    } else {
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("fx/big.js");
      expect(r.stderr).toContain("64 KiB");
    }
  });
});
