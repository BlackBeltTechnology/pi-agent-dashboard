import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

function fx(args: string[]) {
  return spawnSync(BIN, ["fx", ...args], { encoding: "utf8" });
}

describe("deck3d fx (E45-adjacent)", () => {
  it("lists the catalogue", () => {
    const r = fx(["list"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("tokens");
    expect(r.stdout).toContain("starfield");
  });

  it("filters by kind and content tag", () => {
    const r = fx(["list", "--kind", "background", "--tag", "network"]);
    expect(r.status, r.stderr).toBe(0);
    const ids = r.stdout
      .trim()
      .split("\n")
      .map((l) => l.split("\t")[0]);
    expect(ids).toContain("grid-horizon");
    expect(ids).toContain("swarm");
    expect(ids.every((id) => id !== "bloom")).toBe(true);
  });

  it("emits parseable JSON", () => {
    const r = fx(["list", "--json"]);
    expect(r.status, r.stderr).toBe(0);
    const rows = JSON.parse(r.stdout);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.find((x: { id: string }) => x.id === "bloom").kind).toBe("post");
  });
});

/**
 * test-plan #E34 — `--topic` is how the LLM finds scenery for a slide's
 * subject. An unknown topic must fail loudly rather than print an empty list,
 * which would read as "the corpus has nothing for this".
 */
describe("E34 fx list --topic", () => {
  it("lists only the backgrounds carrying the topic", () => {
    const r = fx(["list", "--topic", "geo"]);
    expect(r.status, r.stderr).toBe(0);
    const ids = r.stdout.trim().split("\n").map((l) => l.split("\t")[0]);
    expect(ids).toContain("globe-arcs");
    expect(ids).not.toContain("neural-mesh");
  });

  it("rejects an unknown topic naming the vocabulary", () => {
    const r = fx(["list", "--topic", "finance"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("finance");
    for (const topic of ["geo", "ai", "process"]) expect(r.stderr).toContain(topic);
  });
});

/**
 * test-plan #E13/#E14/#E35 — the authoring loop: scaffold writes a working
 * pair and a paste-able entry, `fx hash` re-pins after an edit, and
 * `fx preview local:` renders the result.
 */
describe("E13/E14 fx scaffold and hash", () => {
  function emptyDeckDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e13-"));
    writeFileSync(join(dir, "deck.md"), "# Ai\n\n- one\n");
    expect(spawnSync(BIN, ["parse", "deck.md", "-o", "deck.json"], { cwd: dir, encoding: "utf8" }).status).toBe(0);
    return dir;
  }

  it("creates both files with a digest that matches, and an entry that validates", () => {
    const dir = emptyDeckDir();
    const r = spawnSync(BIN, ["fx", "scaffold", "neural-mesh", "--for", "ai"], { cwd: dir, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);

    const src = readFileSync(join(dir, "fx", "neural-mesh.js"), "utf8");
    expect(existsSync(join(dir, "fx", "neural-mesh.meta.json"))).toBe(true);
    const digest = createHash("sha256").update(src).digest("hex");
    expect(r.stdout).toContain(digest);

    // Paste the printed entry and the deck validates.
    const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
    deck.overrides.slides = { ai: { effects: [{ id: "local:neural-mesh", sha256: digest }] } };
    writeFileSync(join(dir, "deck.json"), JSON.stringify(deck, null, 2));
    const v = spawnSync(BIN, ["validate", "deck.json"], { cwd: dir, encoding: "utf8" });
    expect(v.status, v.stderr).toBe(0);
  });

  it("refuses to overwrite an existing effect, leaving the files untouched", () => {
    const dir = emptyDeckDir();
    expect(spawnSync(BIN, ["fx", "scaffold", "neural-mesh"], { cwd: dir, encoding: "utf8" }).status).toBe(0);
    const before = readFileSync(join(dir, "fx", "neural-mesh.js"), "utf8");

    const second = spawnSync(BIN, ["fx", "scaffold", "neural-mesh"], { cwd: dir, encoding: "utf8" });
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain("exists");
    expect(readFileSync(join(dir, "fx", "neural-mesh.js"), "utf8")).toBe(before);
  });

  it("reports a new digest after the module is edited", () => {
    const dir = emptyDeckDir();
    expect(spawnSync(BIN, ["fx", "scaffold", "neural-mesh"], { cwd: dir, encoding: "utf8" }).status).toBe(0);
    const first = spawnSync(BIN, ["fx", "hash", "neural-mesh"], { cwd: dir, encoding: "utf8" }).stdout.trim();
    expect(first).toMatch(/^[0-9a-f]{64}$/);

    appendFileSync(join(dir, "fx", "neural-mesh.js"), "// tweak\n");
    const second = spawnSync(BIN, ["fx", "hash", "neural-mesh"], { cwd: dir, encoding: "utf8" }).stdout.trim();
    expect(second).not.toBe(first);
    expect(second).toBe(createHash("sha256").update(readFileSync(join(dir, "fx", "neural-mesh.js"))).digest("hex"));
  });
});

/**
 * test-plan #E35 — `fx preview local:<name>` closes the authoring loop: an
 * agent must be able to LOOK at the module it just wrote before shipping it.
 */
describe.skipIf(!(await chromiumAvailable()))("E35 fx preview local: (chromium)", () => {
  it("renders a scaffolded module to a non-black PNG in the chosen palette", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e35-"));
    writeFileSync(join(dir, "deck.md"), "# Ai\n\n- one\n");
    expect(spawnSync(BIN, ["parse", "deck.md", "-o", "deck.json"], { cwd: dir, encoding: "utf8" }).status).toBe(0);
    expect(spawnSync(BIN, ["fx", "scaffold", "neural-mesh"], { cwd: dir, encoding: "utf8" }).status).toBe(0);

    const r = spawnSync(BIN, ["fx", "preview", "local:neural-mesh", "--palette", "ember", "-o", "p.png"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(r.status, r.stderr).toBe(0);
    const png = readFileSync(join(dir, "p.png"));
    expect(png.length).toBeGreaterThan(1024);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  }, 180_000);
});
