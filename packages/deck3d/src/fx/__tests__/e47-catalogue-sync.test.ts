/**
 * E47 (task 10.47) — effects: Catalogue in sync (set equality).
 *
 * `reference/effects.md` is generated from the cards: the committed file is
 * byte-equal to `renderCatalogue()`, every registered id has exactly one
 * `## <id>` section, and the embedded cards hash matches the registry hash
 * (the documented drift detector: a stale doc fails).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogue, catalogueHash, renderCatalogue } from "../catalogue.js";
import { FX_IDS, REGISTRY } from "../index.js";

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
