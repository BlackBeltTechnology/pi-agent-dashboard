/**
 * E33 — `props fetch` prints the exact `overrides.props[]` entry (source, id,
 * licence, author, sha256, slide, role); pasting it into empty overrides
 * validates clean with no warning.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { glbOfSize, type MockServer, startMockServer } from "../../__tests__/helpers/mock-http.js";
import { validIR } from "../../ir/__tests__/fixtures.js";
import { validate } from "../../ir/validate.js";
import type { PropOverride } from "../../ir/types.js";
import { fetchProp } from "../fetch.js";
import { generateProp, type SpawnFn, textToImage } from "../generate.js";
import type { PropCandidate } from "../search.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const ENTRY_KEYS = ["source", "id", "licence", "author", "sha256", "slide", "role"];

function cli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

/** An IR whose only prop is `entry`, written beside the deck. */
function writeDeck(dir: string, entry: PropOverride): void {
  const ir = validIR();
  ir.overrides.props = [entry];
  writeFileSync(join(dir, "deck.json"), `${JSON.stringify(ir, null, 2)}\n`);
}

let server: MockServer;
beforeAll(async () => {
  server = await startMockServer({ body: glbOfSize(512), contentType: "model/gltf-binary" });
});
afterAll(async () => {
  await server.close();
});

function candidate(): PropCandidate {
  return {
    source: "poly-pizza",
    id: "robot",
    name: "Robot",
    tags: [],
    tris: 10,
    bytes: 512,
    licence: "CC0-1.0",
    author: "Test Author",
    downloadUrl: `${server.url}/robot.glb`,
  };
}

describe("E33 props fetch writes the entry", () => {
  it("prints the seven override fields from a vendored fetch and caches the model", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e33-"));
    const r = cli(["props", "fetch", "vendored", "robot", "--slide", "intro", "--role", "illustration"], dir);
    expect(r.status, r.stderr).toBe(0);
    const entry = JSON.parse(r.stdout) as PropOverride;
    expect(Object.keys(entry)).toEqual(ENTRY_KEYS);
    expect(entry).toMatchObject({
      source: "vendored",
      id: "robot",
      licence: "CC0-1.0",
      slide: "intro",
      role: "illustration",
    });
    expect(entry.author.length).toBeGreaterThan(0);
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(dir, ".deck3d", "props", "vendored-robot.glb"))).toBe(true);

    writeDeck(dir, entry);
    const validate = cli(["validate", "deck.json"], dir);
    expect(validate.status, validate.stderr).toBe(0);
    expect(validate.stdout).toContain("valid");
    expect(validate.stderr).not.toMatch(/^warn /m);
    const written = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")) as { overrides: { props: PropOverride[] } };
    expect(written.overrides.props[0]).toEqual(entry);
  });

  it("an entry built from a mock source validates clean with empty overrides", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e33m-"));
    const result = await fetchProp(candidate(), { destDir: join(dir, ".deck3d", "props") });
    const entry: PropOverride = {
      source: candidate().source,
      id: candidate().id,
      licence: candidate().licence,
      author: candidate().author,
      sha256: result.sha256,
      slide: "intro",
      role: "illustration",
    };
    expect(Object.keys(entry)).toEqual(ENTRY_KEYS);
    mkdirSync(join(dir, ".deck3d", "props"), { recursive: true });
    writeDeck(dir, entry);

    const validate = cli(["validate", "deck.json"], dir);
    expect(validate.status, validate.stderr).toBe(0);
    expect(validate.stdout).toContain("valid");
    expect(validate.stderr).not.toMatch(/^warn /m);
  });
});

/**
 * test-plan #X11 — the full `--prompt` path: text → cached PNG → cached GLB →
 * a pasteable entry that `validate` accepts. The image hop must not change the
 * provenance contract (`licence: generated`, real sha256).
 */
describe("X11 props generate --prompt end to end", () => {
  let t2i: MockServer;
  beforeAll(async () => {
    t2i = await startMockServer();
  });
  afterAll(async () => {
    await t2i.close();
  });

  it("caches both artefacts and yields an entry that validates", async () => {
    t2i.set({ status: 200, body: glbOfSize(1024), contentType: "image/png" });
    const destDir = join(mkdtempSync(join(tmpdir(), "deck3d-x11-")), ".deck3d", "props");

    const image = await textToImage({ prompt: "ship", name: "ship", destDir, url: `${t2i.url}/?p={prompt}` });
    expect(image).toBe(join(destDir, "generated-ship.png"));

    // The image→GLB hop is the existing Hunyuan path; stub its python step.
    const glb = join(mkdtempSync(join(tmpdir(), "deck3d-x11-out-")), "out.glb");
    writeFileSync(glb, glbOfSize(2048));
    const spawn: SpawnFn = () => ({ status: 0, stdout: `${glb}\n`, stderr: "" });

    const result = await generateProp({ fromImage: image, name: "ship", destDir, spawn });
    expect(existsSync(join(destDir, "generated-ship.glb"))).toBe(true);
    expect(result.entry).toMatchObject({ licence: "generated", restyle: "palette", source: "generated" });
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);

    const ir = validIR();
    ir.overrides.props = [{ ...result.entry, slide: "intro", role: "illustration" }];
    expect(validate(ir).errors).toEqual([]);
  }, 60_000);
});
