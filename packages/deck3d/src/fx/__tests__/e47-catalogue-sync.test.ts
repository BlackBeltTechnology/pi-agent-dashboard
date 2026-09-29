/**
 * E47 (task 10.47) — effects: Catalogue in sync (set equality).
 *
 * `reference/effects.md` is generated from the cards: the committed file is
 * byte-equal to `renderCatalogue()`, every registered id has exactly one
 * `## <id>` section, and the embedded cards hash matches the registry hash
 * (the documented drift detector: a stale doc fails).
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogue, catalogueHash, renderCatalogue } from "../catalogue.js";
import { FX_IDS, REGISTRY } from "../index.js";
import { promoteLocalEffect } from "../scaffold.js";

const COMMITTED = readFileSync(new URL("../../../.pi/skills/deck3d/reference/effects.md", import.meta.url), "utf8");

describe("E47 the committed catalogue is in sync with the cards", () => {
  it("regenerates the committed reference/effects.md byte-for-byte", () => {
    expect(renderCatalogue()).toBe(COMMITTED);
  });

  it("lists every registered id exactly once", () => {
    for (const id of FX_IDS) {
      const sections = COMMITTED.split("\n").filter((line) => line === `## ${id}`);
      expect(sections, id).toHaveLength(1);
    }
    const headings = COMMITTED.split("\n").filter((line) => line.startsWith("## ")).length;
    expect(headings).toBe(FX_IDS.length);
  });

  it("embeds the current cards hash", () => {
    const hash = catalogueHash();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(COMMITTED).toContain(`Cards hash: \`${hash}\``);
  });

  it("exposes one sorted catalogue row per card", () => {
    const rows = catalogue();
    expect(rows.map((r) => r.id)).toEqual([...FX_IDS].sort((a, b) => a.localeCompare(b)));
    for (const row of rows) {
      const card = REGISTRY[row.id].card;
      expect(row.kind).toBe(card.kind);
      expect(row.cost).toBe(card.cost);
      expect(row.modes).toBe(card.modes);
      expect(row.licence).toBe(card.licence);
    }
  });
});

/**
 * test-plan #E15/#X14 — `fx promote` is the only path from per-deck code into
 * the shipped corpus. Both provenance flags are mandatory (a local card carries
 * `source: "local"`, which the corpus rejects), and a module that fails the
 * corpus gate must leave nothing behind.
 */
describe("E15/X14 fx promote", () => {
  const SRC = "export default function (ctx, params) { return { object: new ctx.THREE.Group(), dispose: function () {} }; }\n";

  function localPair(src = SRC): { deckDir: string; corpusDir: string } {
    const deckDir = mkdtempSync(join(tmpdir(), "deck3d-e15-"));
    const corpusDir = mkdtempSync(join(tmpdir(), "deck3d-e15-corpus-"));
    mkdirSync(join(deckDir, "fx"), { recursive: true });
    writeFileSync(join(deckDir, "fx", "x.js"), src);
    writeFileSync(
      join(deckDir, "fx", "x.meta.json"),
      JSON.stringify({
        id: "x",
        kind: "background",
        tags: { mood: ["m"], content: ["c"] },
        cost: 1,
        modes: "both",
        params: {},
        conflicts: [],
        source: "local",
        licence: "MIT",
      }),
    );
    return { deckDir, corpusDir };
  }

  const stillLocal = (deckDir: string) => existsSync(join(deckDir, "fx", "x.js"));

  it.each([
    ["no flags", {}, "--source"],
    ["source only", { source: "https://example.com/x" }, "--licence"],
    ["licence only", { licence: "MIT" }, "--source"],
    ["non-permissive licence", { source: "https://example.com/x", licence: "GPL-3.0" }, "not permissive"],
  ])("rejects %s, moving nothing", (_name, flags, needle) => {
    const { deckDir, corpusDir } = localPair();
    const r = promoteLocalEffect(deckDir, "x", { ...flags, corpusDir, verify: () => ({ ok: true, detail: "" }) });
    expect(r.ok).toBe(false);
    expect(r.message).toContain(needle);
    expect(stillLocal(deckDir)).toBe(true);
    expect(readdirSync(corpusDir)).toEqual([]);
  });

  it("moves the pair into the corpus with the given provenance", () => {
    const { deckDir, corpusDir } = localPair();
    const r = promoteLocalEffect(deckDir, "x", {
      source: "https://threejs.org/examples/",
      licence: "MIT",
      corpusDir,
      verify: () => ({ ok: true, detail: "" }),
    });
    expect(r.ok, r.message).toBe(true);
    expect(readdirSync(corpusDir).sort()).toEqual(["x.meta.json", "x.ts"]);
    const card = JSON.parse(readFileSync(join(corpusDir, "x.meta.json"), "utf8"));
    expect(card.source).toBe("https://threejs.org/examples/");
    expect(card.licence).toBe("MIT");
    expect(stillLocal(deckDir)).toBe(false);
  });

  it("rolls back when the corpus gate rejects the module (X14)", () => {
    const { deckDir, corpusDir } = localPair();
    const r = promoteLocalEffect(deckDir, "x", {
      source: "https://threejs.org/examples/",
      licence: "MIT",
      corpusDir,
      verify: () => ({ ok: false, detail: "constructor threw" }),
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("constructor threw");
    expect(readdirSync(corpusDir)).toEqual([]);
    expect(stillLocal(deckDir)).toBe(true);
  });
});
